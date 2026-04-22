const { ChromaClient } = require('chromadb');
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

let client;
let embeddingFunction;

/**
 * Custom embedding function using Gemini's text-embedding-004 model.
 */
class GeminiEmbeddingFunction {
    constructor(apiKey) {
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = this.genAI.getGenerativeModel({ model: "text-embedding-004" });
    }

    async generate(texts) {
        try {
            const result = await this.model.batchEmbedContents({
                requests: texts.map((text) => ({
                    content: { role: "user", parts: [{ text }] },
                })),
            });
            return result.embeddings.map((e) => e.values);
        } catch (error) {
            console.error('Error generating embeddings:', error);
            throw error;
        }
    }
}

/**
 * Initializes the Vector DB client and embedding function.
 */
async function initDB() {
    const host = process.env.CHROMA_HOST || "http://localhost";
    const port = parseInt(process.env.CHROMA_PORT || "8000");
    
    client = new ChromaClient({
        host: host,
        port: port
    });

    if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY is not defined in environment variables');
    }

    embeddingFunction = new GeminiEmbeddingFunction(process.env.GEMINI_API_KEY);

    // Heartbeat to verify connection
    try {
        await client.heartbeat();
    } catch (error) {
        console.warn('⚠️ Could not connect to ChromaDB server. Ensure it is running at', host + ':' + port);
        // We don't throw here to allow the test to fail specifically on operations if needed, 
        // but it's good to know.
    }

    return client;
}

/**
 * Adds a document to a collection.
 */
async function addDocument(collectionName, text, metadata, id) {
    if (!client) await initDB();
    
    const collection = await client.getOrCreateCollection({
        name: collectionName,
        embeddingFunction: embeddingFunction
    });

    await collection.add({
        ids: [id],
        metadatas: [metadata],
        documents: [text]
    });
}

/**
 * Queries documents from a collection.
 */
async function queryDocuments(collectionName, queryText, nResults = 5) {
    if (!client) await initDB();

    const collection = await client.getOrCreateCollection({
        name: collectionName,
        embeddingFunction: embeddingFunction
    });

    return await collection.query({
        queryTexts: [queryText],
        nResults: nResults
    });
}

module.exports = { initDB, addDocument, queryDocuments };
