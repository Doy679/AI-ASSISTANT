const fs = require('fs/promises');
const path = require('path');
const OpenAI = require("openai");
require('dotenv').config();

const VECTORS_FILE = path.join(__dirname, 'vectors.json');
let db = { collections: {} };
let openai;

/**
 * Initializes the OpenAI client.
 */
function getOpenAIClient() {
    if (!openai) {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY is not defined in environment variables');
        }
        openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return openai;
}

/**
 * Custom embedding generation using OpenAI's text-embedding-3-small model.
 */
async function generateEmbeddings(texts) {
    const client = getOpenAIClient();
    try {
        const response = await client.embeddings.create({
            model: "text-embedding-3-small",
            input: texts,
            encoding_format: "float",
        });
        return response.data.map(item => item.embedding);
    } catch (error) {
        console.error('Error generating OpenAI embeddings:', error);
        throw error;
    }
}

/**
 * Similarity calculation (Dot Product).
 * text-embedding-3-small embeddings are normalized, so dot product is equivalent to cosine similarity.
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
        if (doc.embedding.length !== queryVector.length) {
            return { ...doc, score: -1 }; // Skip incompatible embeddings
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
        distances: [topResults.map(r => 1 - r.score)] // Convert similarity to distance
    };
}

module.exports = { initDB, addDocument, queryDocuments };
