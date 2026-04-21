require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const schedule = require('node-schedule');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const token = process.env.TELEGRAM_TOKEN;
const geminiKey = process.env.GEMINI_API_KEY;

if (!token || !geminiKey || geminiKey === 'YOUR_GEMINI_API_KEY_HERE') {
    console.error("Error: Please set TELEGRAM_TOKEN and GEMINI_API_KEY in .env file");
    process.exit(1);
}

// Initialize Gemini
const genAI = new GoogleGenerativeAI(geminiKey);
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    systemInstruction: "You are Ron Assistant AI, the personal assistant for Rondether 'Ron' Gonzales. Ron is a Frontend Engineer from Mandaue City, Philippines, skilled in React, Next.js, and GSAP. You should be professional, helpful, and recognize him as 'Sir Ron'. If he asks to be reminded of something, suggest a reminder. If he asks a question, answer it using your knowledge of web development and his projects like Brisasolei."
});

const bot = new TelegramBot(token, { polling: true });

console.log("Ron Assistant AI is LIVE and thinking...");

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userText = msg.text;

    if (!userText || userText.startsWith('/')) {
        if (userText === '/start') {
            bot.sendMessage(chatId, "Hello Sir Ron! I am now connected to my Gemini brain. Ask me anything, or tell me to remind you of a task!");
        }
        return;
    }

    try {
        // Use Gemini to decide if this is a reminder or a question
        const prompt = `The user says: "${userText}". 
        If this is a request for a reminder (e.g., "Remind me to...", "Schedule..."), output ONLY the task name. 
        If it is a general question, output the answer. 
        If it's a reminder, start your response with "REMINDER: "`;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        if (responseText.startsWith("REMINDER:")) {
            const task = responseText.replace("REMINDER:", "").trim();
            bot.sendMessage(chatId, `Got it, Sir Ron! I've scheduled a reminder for: "${task}" in 1 minute.`);
            
            const runTime = new Date(Date.now() + 60000); 
            schedule.scheduleJob(runTime, function() {
                bot.sendMessage(chatId, `🚨 **REMINDER FOR SIR RON!** 🚨\n\nTask: ${task}\n\nTime to get back to building great things! 💻`, { parse_mode: 'Markdown' });
            });
        } else {
            // It's a general question
            bot.sendMessage(chatId, responseText);
        }
    } catch (error) {
        console.error("AI Error:", error);
        bot.sendMessage(chatId, "Sorry Sir Ron, my brain hit a snag. Is the Gemini API key correct?");
    }
});
