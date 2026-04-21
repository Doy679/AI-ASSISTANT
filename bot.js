require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const schedule = require('node-schedule');
const simpleGit = require('simple-git');
const path = require('path');

const token = process.env.TELEGRAM_TOKEN;
const geminiKey = process.env.GEMINI_API_KEY;
const workspaceRoot = path.resolve(process.env.WORKSPACE_ROOT || '/home/gonzales/Desktop/RON AI ASSISTANT');
const genAI = new GoogleGenerativeAI(geminiKey);

const BOSS_CHAT_ID = "6029811516";
const bot = new TelegramBot(token, { polling: true });

// THE POWERFUL MULTI-BRAIN LIST
const MODELS = ["gemini-1.5-flash", "gemini-2.0-flash", "gemini-1.5-pro"];

const RON_BRAIN = `
BOSS: Ron Gonzales (Lead Frontend Engineer).
MANDATE: High-intelligence AI partner. Deep technical knowledge. Professional and loyal. Call him Boss.
`;

async function askAI(userText) {
    // This will try every model in our list until one works
    for (const modelName of MODELS) {
        try {
            console.log(`Trying brain: ${modelName}`);
            const model = genAI.getGenerativeModel({ model: modelName, systemInstruction: RON_BRAIN });
            const result = await model.generateContent(userText);
            return result.response.text();
        } catch (e) {
            console.log(`Brain ${modelName} is busy... trying next.`);
            continue; 
        }
    }
    return "Boss, all my AI cores are under heavy load. Please try again in a few seconds!";
}

async function checkGithubStreak() {
    const git = simpleGit(path.join(workspaceRoot, 'my-ai-assistant'));
    try {
        const logs = await git.log(['--since="00:00:00"']);
        return logs.total > 0;
    } catch (e) { return false; }
}

// AUTO-SCHEDULES
const reminders = [
    { time: '0 7 * * *', msg: "🌅 Good Morning Boss! Exercise and bath time." },
    { time: '0 12 * * *', msg: "🍽️ Lunch time, Boss!" },
    { time: '0 15 * * *', msg: "🙏 Prayer time reminder." },
    { time: '0 18 * * *', msg: "🏠 Home safely, Boss!" },
    { time: '0 20 * * *', msg: "🥗 Dinner time!" },
    { time: '0 22 * * *', msg: "🌙 Sleep well, Boss." }
];

reminders.forEach(r => schedule.scheduleJob(r.time, () => bot.sendMessage(BOSS_CHAT_ID, r.msg)));

// 8:30 PM Streak Check
schedule.scheduleJob('30 20 * * *', async () => {
    const pushed = await checkGithubStreak();
    if (!pushed) {
        bot.sendMessage(BOSS_CHAT_ID, "🚨 **BOSS! URGENT STREAK ALERT!** 🚨\nNo commits today. Push NOW! 💻🔥", { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(BOSS_CHAT_ID, "✅ **Streak Safe!** You've pushed today, Boss.");
    }
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userText = msg.text ? msg.text.trim() : "";
    if (!userText || userText.startsWith('/')) return;

    if (userText.toLowerCase().includes("streak") || userText.toLowerCase().includes("did i push")) {
        const pushed = await checkGithubStreak();
        return bot.sendMessage(chatId, pushed ? "✅ Streak Safe!" : "⚠️ Streak at Risk!");
    }

    bot.sendChatAction(chatId, 'typing');
    const response = await askAI(userText);
    bot.sendMessage(chatId, response);
});

console.log("💎 Ron AI Multi-Brain Edition is ONLINE.");
