require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function listModels() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  try {
    const models = await genAI.getGenerativeModel({ model: "gemini-pro" }); // placeholder
    console.log("Checking available models...");
    // We use the base URL to list models
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
    const data = await response.json();
    console.log("Available models for your key:");
    data.models.forEach(m => console.log(`- ${m.name}`));
  } catch (e) {
    console.error("Error listing models:", e);
  }
}

listModels();
