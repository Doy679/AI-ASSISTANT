require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Health check endpoint for Render/Pinger
app.get('/', (req, res) => res.send('Ron AI Assistant is active and running!'));
app.listen(port, () => console.log(`Web server listening on port ${port}`));

const schedule = require('node-schedule');
const simpleGit = require('simple-git');
const vectordb = require('./vectordb');

const token = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const geminiKey = process.env.GEMINI_API_KEY;
const openaiKey = process.env.OPENAI_API_KEY;
const workspaceRoot = path.resolve(process.env.WORKSPACE_ROOT || '/home/gonzales/Desktop/RON AI ASSISTANT');
const memoryPath = path.join(__dirname, 'memory.json');
const botName = process.env.ASSISTANT_NAME || 'Ron AI';
const bossChatId = process.env.BOSS_CHAT_ID || '6029811516';

if (!token) {
    throw new Error('Missing TELEGRAM_TOKEN or TELEGRAM_BOT_TOKEN in environment.');
}

const genAI = geminiKey ? new GoogleGenerativeAI(geminiKey) : null;
const openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;
const bot = new TelegramBot(token, { polling: true });

const MAX_HISTORY_MESSAGES = 12;
const MAX_MEMORY_ENTRIES = 30;
const MAX_RESPONSE_CHARS = 3500;

const MODEL_CATALOG = {
    openai: 'gpt-4o',
    openai_mini: 'gpt-4o-mini',
    gemini: 'gemini-2.0-flash',
    gemini_fallback: 'gemini-flash-latest'
};

const reminders = [
    { time: '0 7 * * *', msg: '🌅 Good Morning Boss! Exercise and bath time.' },
    { time: '0 12 * * *', msg: '🍽️ Lunch time, Boss!' },
    { time: '0 15 * * *', msg: '🙏 Prayer time reminder.' },
    { time: '0 18 * * *', msg: '🏠 Home safely, Boss!' },
    { time: '0 20 * * *', msg: '🥗 Dinner time!' },
    { time: '0 22 * * *', msg: '🌙 Sleep well, Boss.' }
];

const FRONTEND_CHEAT_SHEET = [
    "🚀 **MY FRONT-END TECH STACK: INTERVIEW CHEAT SHEET**\n\n**1. THE CORE FOUNDATION**\n• **HTML & CSS**: The essential building blocks of the web. HTML provides the semantic structure and meaning of the content, while CSS handles the initial visual presentation, layouts, and responsive behavior.",
    "🚀 **MY FRONT-END TECH STACK: INTERVIEW CHEAT SHEET**\n\n**2. THE CORE FRAMEWORKS (Logic & Structure)**\n• **React**: My primary JavaScript library for building dynamic, interactive user interfaces. It allows me to create reusable UI components, making my codebase modular, easier to debug, and simpler to maintain as the project grows.\n• **Next.js**: A powerful React framework I use for production-ready applications. It provides built-in features like server-side rendering (SSR) and static site generation (SSG), which drastically improve website performance and SEO.",
    "🚀 **MY FRONT-END TECH STACK: INTERVIEW CHEAT SHEET**\n\n**3. THE STYLING ARSENAL (Design & Efficiency)**\n• **Tailwind CSS**: My go-to utility-first CSS framework. It lets me rapidly build custom, sleek, and highly responsive designs directly within my markup.\n• **DaisyUI**: A component library plugin for Tailwind CSS. Speed of pre-built component classes combined with deep customization.\n• **Bootstrap**: A classic, robust component-based framework for quickly scaffolding standard layouts.",
    "🚀 **MY FRONT-END TECH STACK: INTERVIEW CHEAT SHEET**\n\n**4. THE ANIMATION ENGINE (Motion & Interaction)**\n• **Framer Motion**: My preferred library for React. Fluid, physics-based animations and smooth page transitions.\n• **GSAP**: The industry standard for complex web animation. Timeline-based sequencing and complex scroll-triggered animations.",
    "🚀 **MY FRONT-END TECH STACK: INTERVIEW CHEAT SHEET**\n\n**5. SUPPORTING TOOLS (Workflow & Deployment)**\n• **Git & GitHub**: Version control system to track changes and host repositories.\n• **Node.js**: The runtime environment for local development and package management.\n• **Webpack**: Module bundler for optimizing assets for the browser.\n• **VS Code**: My primary IDE and command center for efficient Linux development.",
    "🚀 **MY FRONT-END TECH STACK: SUMMARY**\n\n\"I build my core applications using **React and Next.js** for strong performance. For styling, I use **Tailwind CSS and DaisyUI** to rapidly create modern interfaces, falling back on **Bootstrap** when needed. I bring the UI to life using **Framer Motion** for React transitions and **GSAP** for complex timelines, all built on a foundation of **HTML and CSS**. To support this, I use **VS Code** as my main editor, managing dependencies with **Node.js**, understanding asset bundling with **Webpack**, and maintaining strict version control with **Git and GitHub.**\""
];

async function sendDailyLearningReminder() {
    const statePath = path.join(__dirname, 'learning_state.json');
    let state = { lastIndex: 0 };
    try {
        const data = await fs.readFile(statePath, 'utf8');
        state = JSON.parse(data);
    } catch (e) {}

    const index = state.lastIndex % FRONTEND_CHEAT_SHEET.length;
    const msg = FRONTEND_CHEAT_SHEET[index];
    
    await bot.sendMessage(bossChatId, `📚 **DAILY SKILL LEARNING**\n\n${msg}`, { parse_mode: 'Markdown' });
    
    state.lastIndex = index + 1;
    await fs.writeFile(statePath, JSON.stringify(state, null, 2));
}

// Schedule learning reminder for 9:00 AM daily
schedule.scheduleJob('0 9 * * *', sendDailyLearningReminder);

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
    return MODEL_CATALOG.gemini_fallback; // Default to Gemini 1.5 Flash (most stable free tier)
}

const lastGroundingByChat = new Map();

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

async function generateWithOpenAI(modelName, prompt, history = []) {
    if (!openai) throw new Error('OpenAI client not initialized');

    const messages = [
        { role: 'system', content: CORE_SYSTEM_PROMPT },
        ...history.map(h => ({ 
            role: h.role === 'assistant' ? 'assistant' : 'user', 
            content: h.text 
        })),
        { role: 'user', content: prompt }
    ];

    const response = await openai.chat.completions.create({
        model: modelName,
        messages: messages,
        temperature: 0.3,
        max_tokens: 900
    });

    return normalizeText(response.choices[0]?.message?.content);
}

async function generateWithGemini(modelName, prompt) {
    if (!genAI) throw new Error('Gemini client not initialized');

    const model = genAI.getGenerativeModel({
        model: modelName,
        tools: [{ googleSearch: {} }]
    });

    const result = await model.generateContent({
        contents: [
            { role: 'user', parts: [{ text: CORE_SYSTEM_PROMPT }] },
            { role: 'model', parts: [{ text: "Understood. I will act as your professional engineering and productivity partner." }] },
            { role: 'user', parts: [{ text: prompt }] }
        ],
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
    
    let groundingBlock = "No specific context available (search temporarily unavailable).";
    try {
        // Use Vector DB for codebase and memory grounding
        const codebaseQuery = await vectordb.queryDocuments('codebase', userText, 3);
        const memoryQuery = await vectordb.queryDocuments('memory', userText, 3);
        
        const codebaseChunks = codebaseQuery.documents[0] || [];
        const memoryChunks = memoryQuery.documents[0] || [];
        
        groundingBlock = `
--- CODEBASE CONTEXT ---
${codebaseChunks.length ? codebaseChunks.join('\n\n---\n\n') : 'No specific codebase context found.'}

--- MEMORY CONTEXT ---
${memoryChunks.length ? memoryChunks.join('\n\n---\n\n') : 'No specific memory context found.'}
`.trim();

        // Store for /sources command
        lastGroundingByChat.set(String(chatId), {
            summary: `Vector DB: ${codebaseChunks.length} codebase, ${memoryChunks.length} memory chunks`,
            files: codebaseChunks.map((chunk, i) => ({
                path: codebaseQuery.metadatas[0][i]?.path || 'codebase-chunk',
                score: 100,
                snippet: chunk
            }))
        });
    } catch (searchError) {
        console.error('Vector DB search failed, proceeding without grounding:', searchError.message);
    }

    const answerPrompt = `
Recent conversation:
${historyBlock}

Latest user request:
${userText}

Project & Memory Grounding:
${groundingBlock}

Task:
Provide the best direct response to the latest user request.
Use recent history only if it materially helps.
If details are missing and guessing would reduce accuracy, ask one concise clarifying question.
If grounding context is provided, treat it as the primary source of truth for project-specific claims.
`.trim();

    let draft = '';
    const fallbacks = [
        { type: 'gemini', model: MODEL_CATALOG.gemini_fallback }, // Gemini 1.5 Flash (Free)
        { type: 'gemini', model: MODEL_CATALOG.gemini },          // Gemini 2.0 Flash (Free)
        { type: 'openai', model: MODEL_CATALOG.openai_mini },    // OpenAI Mini (Paid)
        { type: 'openai', model: MODEL_CATALOG.openai }          // OpenAI GPT-4o (Paid)
    ];

    for (const fb of fallbacks) {
        try {
            console.log(`Generating draft with ${fb.model} (${fb.type})`);
            if (fb.type === 'openai' && openai) {
                draft = await generateWithOpenAI(fb.model, answerPrompt, history);
            } else if (fb.type === 'gemini' && genAI) {
                draft = await generateWithGemini(fb.model, answerPrompt);
            }
            if (draft) break;
        } catch (error) {
            console.error(`${fb.type} model ${fb.model} failed:`, error.message);
        }
    }

    if (!draft) {
        return 'Boss, I am currently experiencing connection issues with both AI engines. Please wait a moment and try again.';
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
        const repoRoot = __dirname;
        const git = simpleGit(repoRoot);
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
module.exports = { buildAccurateReply, generateWithOpenAI, generateWithGemini, sendDailyLearningReminder };
