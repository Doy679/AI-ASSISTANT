const fs = require('fs');
const path = require('path');
const simpleGit = require('simple-git');
const { addDocument } = require('./vectordb');

const git = simpleGit();

/**
 * Chunks text into smaller pieces.
 * For now, a simple implementation that splits by lines.
 * In a real scenario, we might want to use more sophisticated chunking.
 */
function chunkText(text, maxLines = 50) {
    const lines = text.split('\n');
    const chunks = [];
    for (let i = 0; i < lines.length; i += maxLines) {
        chunks.push(lines.slice(i, i + maxLines).join('\n'));
    }
    return chunks;
}

/**
 * Indexes the codebase by reading git-tracked files and adding them to the vector DB.
 */
async function indexCodebase() {
    console.log('Indexing codebase...');
    try {
        // Get all tracked files
        const rawFiles = await git.raw(['ls-files']);
        const files = rawFiles.split('\n').filter(f => f.trim() !== '' && !f.endsWith('package-lock.json'));

        for (const file of files) {
            const filePath = path.join(process.cwd(), file);
            if (!fs.existsSync(filePath)) continue;

            const content = fs.readFileSync(filePath, 'utf-8');
            const chunks = chunkText(content);

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                const id = chunks.length === 1 ? file : `${file}#chunk${i}`;
                const metadata = {
                    path: file,
                    chunkIndex: i,
                    totalChunks: chunks.length
                };

                await addDocument('codebase', chunk, metadata, id);
            }
        }
        console.log(`Indexed ${files.length} files.`);
    } catch (error) {
        console.error('Error indexing codebase:', error);
        throw error;
    }
}

module.exports = { indexCodebase, chunkText };
