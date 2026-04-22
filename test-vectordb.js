/**
 * Mocking dependencies to run the test without a real ChromaDB server or Gemini API key.
 */

// Mocking chromadb
const mockChromaClient = {
  heartbeat: async () => 123456789,
  getOrCreateCollection: async () => ({
    add: async () => {},
    query: async () => ({
      ids: [['id1']],
      metadatas: [[{ source: 'test' }]],
      documents: [['Hello world']]
    })
  })
};

require.cache[require.resolve('chromadb')] = {
  exports: {
    ChromaClient: function() {
      return mockChromaClient;
    }
  }
};

// Mocking @google/generative-ai
require.cache[require.resolve('@google/generative-ai')] = {
  exports: {
    GoogleGenerativeAI: function() {
      return {
        getGenerativeModel: () => ({
          batchEmbedContents: async () => ({
            embeddings: [{ values: [0.1, 0.2] }]
          })
        })
      };
    }
  }
};

// Set dummy environment variables if not present
if (!process.env.GEMINI_API_KEY) {
  process.env.GEMINI_API_KEY = 'dummy-key';
}

const { initDB, addDocument, queryDocuments } = require('./vectordb');

async function test() {
  console.log('Testing Vector DB Client (Mocked)...');
  try {
    const client = await initDB();
    console.log('✅ DB Initialized');

    const collectionName = 'test_collection';
    await addDocument(collectionName, 'Hello world', { source: 'test' }, 'id1');
    console.log('✅ Document Added');

    const results = await queryDocuments(collectionName, 'Hello', 1);
    console.log('✅ Query Results:', JSON.stringify(results, null, 2));

    if (results && results.ids && results.ids[0].includes('id1')) {
      console.log('✅ Test Passed');
    } else {
      console.error('❌ Test Failed: Expected document not found in results');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Test Error:', error);
    process.exit(1);
  }
}

test();
