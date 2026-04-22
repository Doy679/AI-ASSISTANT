const assert = require('assert');
const path = require('path');

// Mock simple-git
require.cache[require.resolve('simple-git')] = {
    exports: function() {
        return {
            raw: async (args) => {
                if (args[0] === 'ls-files') {
                    return 'file1.js\nfile2.js';
                }
                return '';
            }
        };
    }
};

// Mock fs
const mockFs = {
    readFileSync: (filePath) => `Content of ${path.basename(filePath)}`,
    existsSync: () => true
};
require.cache[require.resolve('fs')] = {
    exports: mockFs
};

// Mock vectordb
const mockVectorDB = {
    addDocument: async (collection, text, metadata, id) => {
        console.log(`Adding to ${collection}: ${id}`);
        mockVectorDB.added.push({ collection, text, metadata, id });
    },
    added: []
};

require.cache[require.resolve('./vectordb')] = {
    exports: mockVectorDB
};

async function runTest() {
    console.log('Testing Codebase Indexer...');
    try {
        const { indexCodebase } = require('./code-indexer');
        
        await indexCodebase();

        console.log('Added documents:', mockVectorDB.added.length);
        assert.strictEqual(mockVectorDB.added.length, 2, 'Should have added 2 documents');
        assert.strictEqual(mockVectorDB.added[0].id, 'file1.js', 'First doc ID should be file1.js');
        assert.strictEqual(mockVectorDB.added[1].id, 'file2.js', 'Second doc ID should be file2.js');

        console.log('✅ Test Passed');
    } catch (error) {
        console.error('❌ Test Failed:', error.message);
        process.exit(1);
    }
}

runTest();
