const assert = require('assert');
const path = require('path');

// Mock dependencies before requiring bot.js
const mockVectordb = {
  queryDocuments: async (collection, text, n) => {
    console.log(`[MOCK] queryDocuments called for ${collection} with query: "${text}"`);
    return {
      documents: [['mocked context from ' + collection]],
      metadatas: [[{ path: 'test/path.js' }]]
    };
  }
};

// We will use this to track if the mock was called
let queryDocumentsCalled = {
  codebase: false,
  memory: false
};

const originalQueryDocuments = mockVectordb.queryDocuments;
mockVectordb.queryDocuments = async (collection, text, n) => {
  if (collection === 'codebase') queryDocumentsCalled.codebase = true;
  if (collection === 'memory') queryDocumentsCalled.memory = true;
  return originalQueryDocuments(collection, text, n);
};

require.cache[require.resolve('./vectordb')] = {
  exports: mockVectordb
};

// Mock Telegram Bot
require.cache[require.resolve('node-telegram-bot-api')] = {
  exports: function() {
    return {
      onText: () => {},
      on: () => {},
      sendMessage: async () => {},
      sendChatAction: async () => {},
      stopPolling: async () => {}
    };
  }
};

// Mock Google Generative AI
let toolsConfigured = false;
require.cache[require.resolve('@google/generative-ai')] = {
  exports: {
    GoogleGenerativeAI: function() {
      return {
        getGenerativeModel: (config) => {
          console.log('[MOCK] getGenerativeModel config:', JSON.stringify(config, null, 2));
          if (config.tools && config.tools.some(t => t.googleSearch)) {
            toolsConfigured = true;
          }
          return {
            generateContent: async () => ({
              response: {
                text: () => 'Mocked response'
              }
            })
          };
        }
      };
    }
  }
};

// Mock fs and other things if necessary, but bot.js mostly uses them inside functions
// Set dummy env vars
process.env.TELEGRAM_TOKEN = 'dummy';
process.env.GEMINI_API_KEY = 'dummy';

// Now require bot.js - we need to make sure buildAccurateReply is accessible
// Since it's not exported, we might need to modify bot.js to export it or 
// use a trick to get it. For now, let's see if we can just implement the test
// as if it was exported and then we'll fix bot.js.

async function runTest() {
  console.log('Running test-bot-tools.js...');
  
  try {
    // We expect bot.js to be modified to export its functions for testing
    // Or we can just read the file and eval it in a context if we're desperate,
    // but better to just add exports to bot.js.
    
    // For the "failing test" part, if I try to require it and call a non-existent export, it fails.
    const bot = require('./bot.js');
    
    if (typeof bot.buildAccurateReply !== 'function') {
      console.log('❌ buildAccurateReply is not exported from bot.js');
      // This is part of why it fails initially
    } else {
      await bot.buildAccurateReply('123', 'How does the indexer work?');
      
      console.log('Verification:');
      console.log('- queryDocuments (codebase) called:', queryDocumentsCalled.codebase);
      console.log('- queryDocuments (memory) called:', queryDocumentsCalled.memory);
      console.log('- Google Search tool configured:', toolsConfigured);

      if (queryDocumentsCalled.codebase && queryDocumentsCalled.memory && toolsConfigured) {
        console.log('✅ Test Passed!');
        process.exit(0);
      } else {
        console.log('❌ Test Failed: Missing required integrations');
        process.exit(1);
      }
    }
  } catch (error) {
    console.error('❌ Test execution error:', error);
    process.exit(1);
  }
}

runTest();
