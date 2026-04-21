require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const schedule = require('node-schedule');
const simpleGit = require('simple-git');

const token = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const geminiKey = process.env.GEMINI_API_KEY;
const workspaceRoot = path.resolve(process.env.WORKSPACE_ROOT || '/home/gonzales/Desktop/RON AI ASSISTANT');
const memoryPath = path.join(__dirname, 'memory.json');
const botName = process.env.ASSISTANT_NAME || 'Ron AI';
const bossChatId = process.env.BOSS_CHAT_ID || '6029811516';

if (!token) {
    throw new Error('Missing TELEGRAM_TOKEN or TELEGRAM_BOT_TOKEN in environment.');
}

if (!geminiKey) {
    throw new Error('Missing GEMINI_API_KEY in environment.');
}

const genAI = new GoogleGenerativeAI(geminiKey);
const bot = new TelegramBot(token, { polling: true });

const MAX_HISTORY_MESSAGES = 12;
const MAX_MEMORY_ENTRIES = 30;
const MAX_RESPONSE_CHARS = 3500;
const MAX_GROUNDED_FILES = 4;
const MAX_FILE_BYTES = 120000;
const GROUNDING_LINES_PER_MATCH = 2;

const MODEL_CATALOG = {
    fast: 'gemini-2.0-flash',
    balanced: 'gemini-2.0-flash',
    deep: 'gemini-2.0-flash'
};

const repoRoot = __dirname;
const git = simpleGit(repoRoot);
const lastGroundingByChat = new Map();
let trackedFilesCache = null;

const STOPWORDS = new Set([
    'the', 'and', 'for', 'are', 'with', 'that', 'this', 'from', 'have', 'what', 'when', 'where', 'which',
    'would', 'could', 'should', 'about', 'your', 'ours', 'mine', 'their', 'there', 'here', 'into', 'make',
    'more', 'just', 'lets', 'let', 'than', 'then', 'them', 'they', 'been', 'being', 'will', 'want', 'need',
    'does', 'did', 'dont', 'how', 'why', 'who', 'our', 'you', 'can', 'not', 'but', 'too', 'its', 'it', 'a',
    'an', 'of', 'to', 'in', 'on', 'is', 'be', 'as', 'at', 'or', 'if', 'we', 'us', 'i'
]);

const reminders = [
    { time: '0 7 * * *', msg: '🌅 Good Morning Boss! Exercise and bath time.' },
    { time: '0 12 * * *', msg: '🍽️ Lunch time, Boss!' },
    { time: '0 15 * * *', msg: '🙏 Prayer time reminder.' },
    { time: '0 18 * * *', msg: '🏠 Home safely, Boss!' },
    { time: '0 20 * * *', msg: '🥗 Dinner time!' },
    { time: '0 22 * * *', msg: '🌙 Sleep well, Boss.' }
];

const CORE_SYSTEM_PROMPT = `
You are ${botName}, the high-accuracy AI assistant for Ron Gonzales.
Role:
- Professional engineering and productivity partner.
- Address the user as Boss when appropriate, but do not overuse it.

Accuracy rules:
- Prioritize factual correctness over sounding confident.
- Never invent files, commands, events, decisions, or prior conversation details.
- If the request is ambiguous or lacks required facts, ask one concise clarifying question instead of guessing.
- If you are uncertain, say what is known and what is uncertain.
- Do not claim that you verified something unless the chat context explicitly includes that evidence.
- Keep answers practical, direct, and concise.

Behavior rules:
- Use recent chat context only when it is relevant.
- If the user asks for code help, give actionable technical guidance.
- If the user asks for a plan, provide a short concrete plan.
- Avoid filler, hype, and dramatic language.
`.trim();

function truncate(text, limit) {
    if (!text) return '';
    return text.length <= limit ? text : `${text.slice(0, limit - 3)}...`;
}

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function isComplexQuery(text) {
    const lowered = text.toLowerCase();
    return [
        'debug',
        'refactor',
        'architecture',
        'design',
        'analyze',
        'analysis',
        'accurate',
        'strategy',
        'compare',
        'code',
        'error',
        'bug',
        'fix',
        'implement'
    ].some(keyword => lowered.includes(keyword)) || text.length > 280;
}

function isQuickReply(text) {
    const lowered = text.toLowerCase();
    return text.length < 80 && [
        'hi',
        'hello',
        'yo',
        'thanks',
        'thank you',
        'ok',
        'nice',
        'cool'
    ].includes(lowered);
}

function pickPrimaryModel(userText) {
    if (isComplexQuery(userText)) {
        return MODEL_CATALOG.deep;
    }

    if (isQuickReply(userText)) {
        return MODEL_CATALOG.fast;
    }

    return MODEL_CATALOG.balanced;
}

function tokenizeQuery(text) {
    return normalizeText(text)
        .toLowerCase()
        .split(/[^a-z0-9._/-]+/)
        .map(token => token.trim())
        .filter(token => token.length >= 3 && !STOPWORDS.has(token));
}

function looksProjectSpecific(text) {
    const lowered = text.toLowerCase();
    if (/[/.][a-z0-9]/i.test(text)) return true;
    return [
        'bot',
        'assistant',
        'project',
        'repo',
        'repository',
        'code',
        'script',
        'file',
        'files',
        'readme',
        'memory',
        'command',
        'prompt',
        'model',
        'telegram',
        'gemini',
        'node',
        'package',
        'bug',
        'fix',
        'feature',
        'implement',
        'refactor'
    ].some(keyword => lowered.includes(keyword));
}

async function getTrackedFiles() {
    if (trackedFilesCache) return trackedFilesCache;

    try {
        const raw = await git.raw(['ls-files']);
        trackedFilesCache = raw
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .filter(file => !file.startsWith('node_modules/'));
        return trackedFilesCache;
    } catch (error) {
        console.error('Failed to list tracked files:', error.message);
        trackedFilesCache = [];
        return trackedFilesCache;
    }
}

async function safeReadRepoFile(relativePath) {
    const absolutePath = path.join(repoRoot, relativePath);

    try {
        const stats = await fs.stat(absolutePath);
        if (!stats.isFile() || stats.size > MAX_FILE_BYTES) {
            return null;
        }

        return await fs.readFile(absolutePath, 'utf8');
    } catch (error) {
        return null;
    }
}

function scoreFileMatch(relativePath, content, keywords) {
    const loweredPath = relativePath.toLowerCase();
    const loweredContent = content.toLowerCase();
    let score = 0;
    let matchCount = 0;

    for (const keyword of keywords) {
        if (loweredPath.includes(keyword)) {
            score += 8;
            matchCount += 1;
        }

        const pattern = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        const matches = loweredContent.match(pattern);
        if (matches) {
            const weighted = Math.min(matches.length, 6);
            score += weighted * 3;
            matchCount += weighted;
        }
    }

    return { score, matchCount };
}

function extractSnippet(relativePath, content, keywords) {
    const lines = content.split('\n');
    const ranges = [];

    lines.forEach((line, index) => {
        const loweredLine = line.toLowerCase();
        if (keywords.some(keyword => loweredLine.includes(keyword))) {
            const start = Math.max(0, index - GROUNDING_LINES_PER_MATCH);
            const end = Math.min(lines.length - 1, index + GROUNDING_LINES_PER_MATCH);
            ranges.push([start, end]);
        }
    });

    if (!ranges.length) {
        const fallback = lines.slice(0, Math.min(lines.length, 12));
        return `FILE: ${relativePath}\n${fallback.map((line, index) => `${index + 1}: ${line}`).join('\n')}`;
    }

    const merged = [];
    for (const [start, end] of ranges.slice(0, 4)) {
        const last = merged[merged.length - 1];
        if (last && start <= last[1] + 1) {
            last[1] = Math.max(last[1], end);
        } else {
            merged.push([start, end]);
        }
    }

    const snippetParts = merged.slice(0, 2).map(([start, end]) => {
        const chunk = lines
            .slice(start, end + 1)
            .map((line, offset) => `${start + offset + 1}: ${line}`)
            .join('\n');
        return chunk;
    });

    return `FILE: ${relativePath}\n${snippetParts.join('\n...\n')}`;
}

async function gatherGroundingContext(userText) {
    if (!looksProjectSpecific(userText) || isQuickReply(userText)) {
        return { summary: 'No local project grounding used.', files: [] };
    }

    const keywords = tokenizeQuery(userText).slice(0, 8);
    if (!keywords.length) {
        return { summary: 'No local project grounding used.', files: [] };
    }

    const trackedFiles = await getTrackedFiles();
    const candidates = [];

    for (const relativePath of trackedFiles) {
        const content = await safeReadRepoFile(relativePath);
        if (!content) continue;

        const { score, matchCount } = scoreFileMatch(relativePath, content, keywords);
        if (score <= 0) continue;

        candidates.push({
            relativePath,
            score,
            matchCount,
            snippet: extractSnippet(relativePath, content, keywords)
        });
    }

    candidates.sort((a, b) => b.score - a.score || b.matchCount - a.matchCount || a.relativePath.localeCompare(b.relativePath));
    const topMatches = candidates.slice(0, MAX_GROUNDED_FILES);

    if (!topMatches.length) {
        return { summary: 'No relevant local project files matched this request.', files: [] };
    }

    const summary = topMatches
        .map(match => `${match.relativePath} (score ${match.score})`)
        .join(', ');

    return {
        summary,
        files: topMatches.map(match => ({
            path: match.relativePath,
            score: match.score,
            snippet: match.snippet
        }))
    };
}

async function readMemory() {
    try {
        const raw = await fs.readFile(memoryPath, 'utf8');
        const data = JSON.parse(raw);
        return data && typeof data === 'object' ? data : {};
    } catch (error) {
        if (error.code === 'ENOENT') {
            return {};
        }
        console.error('Failed to read memory:', error);
        return {};
    }
}

async function writeMemory(memory) {
    const payload = JSON.stringify(memory, null, 2);
    await fs.writeFile(memoryPath, payload, 'utf8');
}

async function appendMemory(chatId, role, text) {
    const safeText = normalizeText(text);
    if (!safeText) return;

    const memory = await readMemory();
    const key = String(chatId);
    const entries = Array.isArray(memory[key]) ? memory[key] : [];

    entries.push({
        role,
        text: safeText,
        timestamp: Date.now()
    });

    memory[key] = entries.slice(-MAX_MEMORY_ENTRIES);
    await writeMemory(memory);
}

async function clearMemory(chatId) {
    const memory = await readMemory();
    delete memory[String(chatId)];
    await writeMemory(memory);
}

async function getRecentHistory(chatId) {
    const memory = await readMemory();
    const entries = Array.isArray(memory[String(chatId)]) ? memory[String(chatId)] : [];
    return entries.slice(-MAX_HISTORY_MESSAGES);
}

function formatHistory(entries) {
    if (!entries.length) {
        return 'No recent conversation history.';
    }

    return entries
        .map(entry => `${entry.role.toUpperCase()}: ${truncate(entry.text, 500)}`)
        .join('\n');
}

async function generateWithModel(modelName, prompt) {
    const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: CORE_SYSTEM_PROMPT
    });

    const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.3,
            topP: 0.9,
            topK: 32,
            maxOutputTokens: 900
        }
    });

    const text = result?.response?.text?.();
    return normalizeText(text);
}

async function buildAccurateReply(chatId, userText) {
    const history = await getRecentHistory(chatId);
    const historyBlock = formatHistory(history);
    const primaryModel = pickPrimaryModel(userText);
    const grounding = await gatherGroundingContext(userText);
    lastGroundingByChat.set(String(chatId), grounding);
    const groundingBlock = grounding.files.length
        ? grounding.files.map(file => file.snippet).join('\n\n---\n\n')
        : grounding.summary;

    const answerPrompt = `
Recent conversation:
${historyBlock}

Latest user request:
${userText}

Local project grounding:
${groundingBlock}

Task:
Provide the best direct response to the latest user request.
Use recent history only if it materially helps.
If details are missing and guessing would reduce accuracy, ask one concise clarifying question.
If local project grounding is provided, treat it as the primary source of truth for project-specific claims.
Do not claim that a file contains something unless it appears in the grounding.
`.trim();

    let draft = '';
    const modelFallbacks = [primaryModel, MODEL_CATALOG.balanced, MODEL_CATALOG.fast, MODEL_CATALOG.deep]
        .filter((name, index, list) => list.indexOf(name) === index);

    for (const modelName of modelFallbacks) {
        try {
            console.log(`Generating draft with ${modelName}`);
            draft = await generateWithModel(modelName, answerPrompt);
            if (draft) break;
        } catch (error) {
            console.error(`Model ${modelName} failed:`, error.message);
        }
    }

    if (!draft) {
        return 'Boss, I could not produce a reliable answer right now. Please try again in a moment.';
    }

    return truncate(draft, MAX_RESPONSE_CHARS);
}

async function checkGithubStreak() {
    const git = simpleGit(path.join(workspaceRoot, 'my-ai-assistant'));
    try {
        const logs = await git.log(['--since=00:00:00']);
        return logs.total > 0;
    } catch (error) {
        console.error('Git streak check failed:', error.message);
        return false;
    }
}

reminders.forEach(reminder => {
    schedule.scheduleJob(reminder.time, () => bot.sendMessage(bossChatId, reminder.msg));
});

schedule.scheduleJob('30 20 * * *', async () => {
    const pushed = await checkGithubStreak();
    if (!pushed) {
        bot.sendMessage(
            bossChatId,
            '🚨 **BOSS! URGENT STREAK ALERT!** 🚨\nNo commits today. Push NOW! 💻🔥',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    bot.sendMessage(bossChatId, "✅ **Streak Safe!** You've pushed today, Boss.");
});

bot.onText(/^\/start$/, async msg => {
    const chatId = msg.chat.id;
    const intro = `${botName} is online.\n\nI now keep short recent memory, ground project-specific answers against local repo files when relevant, prefer accuracy over guessing, and ask for clarification when the request is underspecified.`;
    await bot.sendMessage(chatId, intro);
});

bot.onText(/^\/clear$/, async msg => {
    const chatId = msg.chat.id;
    await clearMemory(chatId);
    await bot.sendMessage(chatId, 'Recent conversation memory cleared for this chat.');
});

bot.onText(/^\/memory$/, async msg => {
    const chatId = msg.chat.id;
    const history = await getRecentHistory(chatId);
    if (!history.length) {
        await bot.sendMessage(chatId, 'No recent memory stored for this chat.');
        return;
    }

    const preview = history
        .map(entry => `${entry.role}: ${truncate(entry.text, 180)}`)
        .join('\n\n');

    await bot.sendMessage(chatId, truncate(preview, MAX_RESPONSE_CHARS));
});

bot.onText(/^\/sources$/, async msg => {
    const chatId = String(msg.chat.id);
    const grounding = lastGroundingByChat.get(chatId);

    if (!grounding || !grounding.files.length) {
        await bot.sendMessage(msg.chat.id, 'No grounded local sources were used for the latest reply.');
        return;
    }

    const message = grounding.files
        .map(file => `${file.path} (score ${file.score})`)
        .join('\n');

    await bot.sendMessage(msg.chat.id, truncate(message, MAX_RESPONSE_CHARS));
});

async function autoPushUpdate() {
    try {
        const heartbeatFile = path.join(repoRoot, 'heartbeat.txt');
        const timestamp = new Date().toISOString();
        await fs.writeFile(heartbeatFile, `Last heartbeat: ${timestamp}\n`, 'utf8');
        
        await git.add('heartbeat.txt');
        await git.commit(`🔧 Streak Protection: Heartbeat ${timestamp}`);
        await git.push('origin', 'main');
        
        console.log(`Successfully pushed heartbeat at ${timestamp}`);
        return true;
    } catch (error) {
        console.error('Auto-push failed:', error.message);
        return false;
    }
}

bot.onText(/^\/streak_save$/, async msg => {
    const chatId = msg.chat.id;
    if (String(chatId) !== bossChatId) {
        return bot.sendMessage(chatId, "Sorry, only Boss can trigger emergency pushes.");
    }
    
    await bot.sendMessage(chatId, "🚀 Starting emergency streak-save push...");
    const success = await autoPushUpdate();
    
    if (success) {
        await bot.sendMessage(chatId, "✅ **Streak Saved!** Timestamp pushed to GitHub.");
    } else {
        await bot.sendMessage(chatId, "❌ **Push Failed.** Check the logs for details.");
    }
});

schedule.scheduleJob('0 21 * * *', async () => {
    const pushed = await checkGithubStreak();
    if (!pushed) {
        console.log('No activity detected today. Running emergency push...');
        const success = await autoPushUpdate();
        if (success) {
            bot.sendMessage(bossChatId, "🤖 **Auto-Streak Protection Active:** No activity was seen, so I pushed a timestamp for you! Your streak is safe. 🛡️");
        } else {
            bot.sendMessage(bossChatId, "⚠️ **CRITICAL:** Tried to auto-save your streak but the push failed!");
        }
    }
});

async function getGithubStats(username) {
    try {
        const token = process.env.GITHUB_TOKEN;
        const headers = {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Ron-AI-Assistant'
        };
        if (token) {
            headers['Authorization'] = `token ${token}`;
        }

        const response = await fetch(`https://api.github.com/users/${username}/events`, { headers });
        if (!response.ok) {
            console.error(`GitHub API returned ${response.status}: ${response.statusText}`);
            return null;
        }
        const events = await response.json();
        const today = new Date().toISOString().split('T')[0];
        
        // Filter for PushEvents and CreateEvents (for new repos/branches) today
        const todayEvents = events.filter(e => e.created_at.startsWith(today));
        const pushEvents = todayEvents.filter(e => e.type === 'PushEvent');
        
        let commitCount = 0;
        pushEvents.forEach(e => {
            commitCount += (e.payload && e.payload.commits) ? e.payload.commits.length : 0;
        });

        return {
            pushCount: pushEvents.length,
            commitCount: commitCount,
            totalEvents: todayEvents.length
        };
    } catch (error) {
        console.error('GitHub fetch failed:', error.message);
        return null;
    }
}

bot.on('message', async msg => {
    const chatId = msg.chat.id;
    const userText = normalizeText(msg.text);
    if (!userText || userText.startsWith('/')) return;

    // Handle GitHub stats request
    const githubMatch = userText.match(/(?:github|push|contributions).*?\b([a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38})\b/i);
    const isAskingStats = /(^|\b)(stats|contributions|how many push|pushed today)(\b|$)/i.test(userText);
    
    if (githubMatch || isAskingStats) {
        const username = githubMatch ? githubMatch[1] : (process.env.GITHUB_USERNAME || 'Doy679');
        if (username && !/^(stats|contributions|how|many|push|pushed|today)$/i.test(username)) {
            await bot.sendChatAction(chatId, 'typing');
            const stats = await getGithubStats(username);
            
            if (stats) {
                const response = `📊 **GitHub Stats for ${username} (Today)**\n\n` +
                                `- Pushes: ${stats.pushCount}\n` +
                                `- Total Commits: ${stats.commitCount}\n` +
                                `- Other Activities: ${stats.totalEvents - stats.pushCount}\n\n` +
                                (stats.commitCount > 0 ? '🔥 You are on fire, Boss!' : '⚠️ No commits seen on GitHub today yet.');
                
                await appendMemory(chatId, 'user', userText);
                await appendMemory(chatId, 'assistant', response);
                await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
                return;
            }
        }
    }

    if (/(^|\b)(streak|did i push)(\b|$)/i.test(userText)) {
        const pushed = await checkGithubStreak();
        await appendMemory(chatId, 'user', userText);
        const response = pushed ? '✅ Streak Safe!' : '⚠️ Streak at Risk!';
        await appendMemory(chatId, 'assistant', response);
        await bot.sendMessage(chatId, response);
        return;
    }

    await appendMemory(chatId, 'user', userText);

    try {
        await bot.sendChatAction(chatId, 'typing');
        const response = await buildAccurateReply(chatId, userText);
        await appendMemory(chatId, 'assistant', response);
        await bot.sendMessage(chatId, response);
    } catch (error) {
        console.error('Reply generation failed:', error);
        const fallback = 'Boss, I hit an internal error while preparing that answer. Please try again.';
        await appendMemory(chatId, 'assistant', fallback);
        await bot.sendMessage(chatId, fallback);
    }
});

bot.on('polling_error', error => {
    if (error.response && error.response.body) {
        const { error_code, description } = error.response.body;
        console.error(`Telegram polling error: ${error_code} - ${description}`);

        if (error_code === 401) {
            console.error('CRITICAL: Telegram token is invalid (401 Unauthorized). Please check your .env file.');
            process.exit(1);
        }

        if (error_code === 409) {
            console.error('CRITICAL: Conflict detected (409 Conflict). Another instance might be running.');
            process.exit(1);
        }
    } else {
        console.error('Telegram polling error:', error.message || error);
    }
});

console.log(`${botName} is online.`);
