# Knowledge Enhancement Design

## Overview
This document outlines the architecture and design to enhance the AI assistant's knowledge across three main pillars:
1. **Personal Memory:** Long-term retention of user facts and preferences.
2. **Codebase Understanding:** Semantic search of the local codebase using embeddings.
3. **External Web Knowledge:** Live access to web searches and external data.

## 1. Architecture & Storage (Local Vector DB)
To support both **Personal Memory** and **Codebase Understanding**, we will replace the current simple `memory.json` and keyword-based file matching with a local **Vector Database**. 

**Approach:** 
We will use a lightweight local vector database solution (such as SQLite with vector extensions, or a lightweight ChromaDB node package).
- **Why:** This keeps all data 100% local, free, and private, avoiding reliance on external cloud storage. It provides the ability to perform semantic similarity searches (finding meaning, not just exact words).
- **Data Flow:** When a fact is learned or code is indexed, we will use Gemini's embedding model (`text-embedding-004`) to convert the text into a vector, and store it in the database. When the user asks a question, the assistant will embed the question and search the local DB for the most relevant personal facts and code snippets.

## 2. Codebase Ingestion & Tool Calling
**Codebase & Memory Updates:**
- **Code Indexing:** A background/periodic indexing process will parse tracked files in the workspace, chunk them appropriately, and update the vector database with their embeddings.
- **Memory Extraction:** The assistant will periodically analyze the conversation history. If it detects a new fact or preference, it will extract it and save it to the vector database automatically.

**External Web Knowledge (Tool Calling):**
- We will upgrade the `buildAccurateReply` pipeline to utilize **Gemini Function Calling (Tools)**.
- The assistant will be equipped with external tools, such as `google_search` (via a free SERP API or built-in grounding) and `fetch_webpage`.
- When a user asks about something outside the assistant's training or local files (e.g., current events or up-to-date documentation), the assistant will autonomously decide to call the search tool, read the results, and construct the final answer.
