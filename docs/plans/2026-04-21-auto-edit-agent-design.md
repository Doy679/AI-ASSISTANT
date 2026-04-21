# Design: Ron AI Auto-Edit Agent

## Overview
An autonomous engineering agent that allows Boss Ron to request code modifications via Telegram. The agent reads local files, generates full-file rewrites using Gemini 1.5 Pro, validates the code via linting, and applies changes in a safe Git branch.

## Architecture
- **Command Engine:** Telegram Bot API.
- **AI Engine:** Gemini 1.5 Pro (High Context).
- **Execution:** Local Node.js environment with `simple-git` and `fs`.
- **Safety:** Hardcoded `WORKSPACE_ROOT` sandbox and `npm run lint` pre-validation.

## Lifecycle (The "Safe-Edit" Flow)
1. **Request:** `/edit [path] [instruction]` received.
2. **Sandbox:** Validate path against `WORKSPACE_ROOT`.
3. **Context:** Read full file content.
4. **Branching:** Create a new git branch `ai-fix/[timestamp]`.
5. **Generation:** Gemini produces a full-file rewrite.
6. **Validation:** Run `npm run lint`.
7. **Finalization:** 
   - On Success: Commit changes and notify Boss.
   - On Failure: Revert to `main` and report errors.

## Security Constraints
- No write access outside of `WORKSPACE_ROOT`.
- Mandatory "State Guard" (refuses edit if workspace is dirty).
- Atomic overwrites only (no partial injections).
