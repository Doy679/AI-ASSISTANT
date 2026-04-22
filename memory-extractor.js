const { GoogleGenerativeAI } = require('@google/generative-ai');
const { addDocument } = require('./vectordb');
const crypto = require('crypto');
require('dotenv').config();

const geminiKey = process.env.GEMINI_API_KEY;
if (!geminiKey && process.env.NODE_ENV !== 'test') {
    throw new Error('Missing GEMINI_API_KEY in environment.');
}

const genAI = new GoogleGenerativeAI(geminiKey || 'dummy-key');

const EXTRACTION_PROMPT = `
You are a memory extraction module. Your task is to analyze the conversation history between a User and an AI Assistant and extract any personal facts, preferences, or rules the User has stated.

Examples of facts to extract:
- "The user prefers using SQLite for projects."
- "The user lives in San Francisco."
- "The user wants the assistant to be concise."
- "The user is allergic to peanuts."

Rules:
1. Extract ONLY facts, preferences, or rules explicitly stated or strongly implied by the User.
2. Return the results as a JSON array of strings.
3. If no new facts are found, return an empty array [].
4. Do not include conversation filler or assistant responses in the facts.
5. Each fact should be a standalone, clear sentence.
6. DO NOT include any markdown formatting like \`\`\`json in your output. Just the raw JSON array.

Conversation History:
{{history}}
`;

/**
 * Extracts personal facts from history and stores them in the vector DB.
 * @param {string} chatId - The chat ID context.
 * @param {Array} history - Array of {role, text} objects.
 */
async function extractAndStoreMemory(chatId, history) {
    if (!history || history.length === 0) return;

    const formattedHistory = history
        .map(entry => `${entry.role.toUpperCase()}: ${entry.text}`)
        .join('\n');

    const prompt = EXTRACTION_PROMPT.replace('{{history}}', formattedHistory);

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(prompt);
        const responseText = result.response.text().trim();
        
        // Clean potential markdown if Gemini ignored instructions
        const cleanText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        
        let facts = [];
        try {
            facts = JSON.parse(cleanText);
        } catch (e) {
            console.error('Failed to parse Gemini response as JSON:', cleanText);
            return;
        }

        if (!Array.isArray(facts)) {
            console.warn('Gemini did not return an array of facts:', facts);
            return;
        }

        for (const fact of facts) {
            const id = crypto.createHash('md5').update(`${chatId}-${fact}-${Date.now()}`).digest('hex');
            const metadata = {
                chatId: String(chatId),
                source: 'chat_memory',
                timestamp: Date.now()
            };
            
            console.log(`Storing fact: "${fact}"`);
            await addDocument('memory', fact, metadata, id);
        }
    } catch (error) {
        console.error('Error during memory extraction:', error);
    }
}

module.exports = { extractAndStoreMemory };
