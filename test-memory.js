const assert = require('assert');

// Mocking @google/generative-ai
require.cache[require.resolve('@google/generative-ai')] = {
  exports: {
    GoogleGenerativeAI: function() {
      return {
        getGenerativeModel: () => ({
          generateContent: async () => ({
            response: {
              text: () => '["The user prefers using SQLite.", "The user lives in San Francisco."]'
            }
          })
        })
      };
    }
  }
};

// Mocking vectordb.js
let addedDocuments = [];
require.cache[require.resolve('./vectordb')] = {
  exports: {
    addDocument: async (collectionName, text, metadata, id) => {
      addedDocuments.push({ collectionName, text, metadata, id });
    }
  }
};

// Set dummy environment variables if not present
if (!process.env.GEMINI_API_KEY) {
  process.env.GEMINI_API_KEY = 'dummy-key';
}

async function runTest() {
  console.log('Testing Personal Memory Extraction...');
  
  try {
    const { extractAndStoreMemory } = require('./memory-extractor');
    
    const mockHistory = [
      { role: 'user', text: 'I prefer using SQLite for my projects.' },
      { role: 'assistant', text: 'Got it, Boss. SQLite is a great choice.' },
      { role: 'user', text: 'By the way, I live in San Francisco.' }
    ];
    
    await extractAndStoreMemory('test-chat-id', mockHistory);
    
    console.log('Added Documents:', JSON.stringify(addedDocuments, null, 2));
    
    assert.strictEqual(addedDocuments.length, 2, 'Should have extracted 2 facts');
    assert.ok(addedDocuments.some(doc => doc.text.includes('SQLite')), 'Should contain SQLite fact');
    assert.ok(addedDocuments.some(doc => doc.text.includes('San Francisco')), 'Should contain San Francisco fact');
    assert.strictEqual(addedDocuments[0].collectionName, 'memory', 'Should be saved to "memory" collection');
    
    console.log('✅ Test Passed');
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
      console.error('❌ Test Failed: memory-extractor.js not found (Expected for Step 1)');
    } else {
      console.error('❌ Test Error:', error);
    }
    process.exit(1);
  }
}

runTest();
