const fs = require('fs/promises');
const path = require('path');
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const VECTORS_FILE = path.join(__dirname, 'vectors.json');
let db = { collections: {} };
let genAI;
let embeddingModel;

/**
 * Custom embedding generation using Gemini's gemini-embedding-001 model (Free Tier).
 */
async function generateEmbeddings(texts) {
    if (!genAI) {
        if (!process.env.GEMINI_API_KEY) {
            throw new Error('GEMINI_API_KEY is not defined in environment variables');
        }
        genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
    }

    try {
        const result = await embeddingModel.batchEmbedContents({
            requests: texts.map((text) => ({
                content: { role: "user", parts: [{ text }] },
            })),
        });
        return result.embeddings.map((e) => e.values);
    } catch (error) {
        console.error('Error generating Gemini embeddings:', error);
        throw error;
    }
}

/**
 * Similarity calculation (Dot Product).
 * gemini-embedding-001 embeddings are normalized, so dot product is equivalent to cosine similarity.
 */
function dotProduct(vecA, vecB) {
    let product = 0;
    for (let i = 0; i < vecA.length; i++) {
        product += vecA[i] * vecB[i];
    }
    return product;
}

/**
 * Initializes the local JSON Vector DB.
 */
async function initDB() {
    try {
        const data = await fs.readFile(VECTORS_FILE, 'utf8');
        db = JSON.parse(data);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('Error loading vectors.json:', error);
        }
        db = { collections: {} };
    }
    return db;
}

/**
 * Saves the DB to disk.
 */
async function saveDB() {
    await fs.writeFile(VECTORS_FILE, JSON.stringify(db, null, 2), 'utf8');
}

/**
 * Adds a document to a collection.
 */
async function addDocument(collectionName, text, metadata, id) {
    if (!db.collections[collectionName]) {
        db.collections[collectionName] = [];
    }

    const embeddings = await generateEmbeddings([text]);
    const embedding = embeddings[0];

    // Update or add
    const index = db.collections[collectionName].findIndex(doc => doc.id === id);
    const newDoc = { id, text, metadata, embedding };

    if (index !== -1) {
        db.collections[collectionName][index] = newDoc;
    } else {
        db.collections[collectionName].push(newDoc);
    }

    await saveDB();
}

/**
 * Queries documents from a collection.
 */
async function queryDocuments(collectionName, queryText, nResults = 5) {
    if (!db.collections[collectionName] || db.collections[collectionName].length === 0) {
        return { ids: [[]], metadatas: [[]], documents: [[]], distances: [[]] };
    }

    const queryEmbeddings = await generateEmbeddings([queryText]);
    const queryVector = queryEmbeddings[0];

    const results = db.collections[collectionName].map(doc => {
        // Handle dimension mismatch if old embeddings exist
        if (!doc.embedding || doc.embedding.length !== queryVector.length) {
            return { ...doc, score: -1 }; 
        }
        const score = dotProduct(queryVector, doc.embedding);
        return { ...doc, score };
    });

    // Sort by descending similarity
    results.sort((a, b) => b.score - a.score);

    const topResults = results.slice(0, nResults);

    return {
        ids: [topResults.map(r => r.id)],
        metadatas: [topResults.map(r => r.metadata)],
        documents: [topResults.map(r => r.text)],
        distances: [topResults.map(r => 1 - r.score)] 
    };
}

module.exports = { initDB, addDocument, queryDocuments };
