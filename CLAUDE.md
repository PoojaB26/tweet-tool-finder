# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tweet Tool Finder is a Chrome Extension + MCP server that scans X/Twitter feeds, classifies tweets about developer tools/hacks/productivity tips using Claude Haiku, and exposes them via MCP for natural language querying from Claude Desktop or Claude Code.

## Architecture

Three components communicate in a pipeline:

1. **Chrome Extension** (root directory) — Content script injected on x.com/twitter.com that extracts tweets from the DOM, classifies them via Anthropic API (through the background service worker), and displays results in a sidebar overlay.

2. **MCP Server** (`mcp-server/`) — TypeScript Node.js server that runs two transports simultaneously:
   - **stdio MCP transport** — exposes 4 tools (`search_tools`, `list_all_tools`, `get_stats`, `recommend_tool`) for Claude to query saved tweets
   - **HTTP sync server** on `127.0.0.1:7849` — receives tweet data from the Chrome extension via POST `/tweets`

3. **Local data store** — `~/.tweet-tool-finder/tools.json` is the shared JSON file both the HTTP sync endpoint writes to and MCP tools read from.

### Data Flow

- Content script (`js/content.js`) extracts tweets from DOM → sends to background script for classification
- Background script (`js/background.js`) calls Anthropic API with Claude Haiku → returns classification result
- Classified tweets are stored in Chrome storage AND synced to MCP server via HTTP POST
- MCP server persists tweets to `~/.tweet-tool-finder/tools.json`
- Claude Desktop/Code queries saved tweets through MCP stdio tools

### Chrome Extension Message Types

All inter-component communication uses `chrome.runtime.sendMessage` with these types: `CLASSIFY_TWEET`, `GET_SETTINGS`, `SAVE_SETTINGS`, `SETTINGS_UPDATED`, `GET_FOUND_TWEETS`, `SAVE_FOUND_TWEET`, `INCREMENT_SCANNED`, `GET_DAILY_COUNT`, `CLEAR_TWEETS`, `MCP_SYNC`, `MCP_PING`.

## Build Commands

### MCP Server
```bash
cd mcp-server
npm install          # install dependencies
npm run build        # compile TypeScript (tsc) → build/
npm run start        # run the MCP server (stdio + HTTP sync)
npm run sync         # run standalone HTTP sync server only (build/sync-server.js)
npm run dev          # build + start in one step
```

### Chrome Extension
No build step — plain JS. Load unpacked at `chrome://extensions/` pointing to the repo root.

## Key Constants

- **Sync port**: `7849` (HTTP, localhost only)
- **Daily API limit**: 1000 tweets per day (tracked in Chrome storage by date key)
- **Max concurrent API calls**: 2
- **Max stored tweets**: 200 (in Chrome storage)
- **Classification model**: `claude-haiku-4-5-20251001`
- **Tweet min length**: 50 chars (shorter tweets skipped)
- **Confidence threshold**: 0.6 (below this, tweets are discarded)

## Extension Structure

- `manifest.json` — Manifest V3, content script runs on x.com/twitter.com at `document_idle`
- `js/content.js` — IIFE that creates sidebar UI, observes feed via MutationObserver, queues tweets for classification
- `js/background.js` — Service worker handling all message routing and Anthropic API calls
- `js/popup.js` — Settings popup logic (API key, toggles, ignored handles)
- `css/sidebar.css` — Sidebar styling; all classes prefixed with `ttf-` to avoid conflicts with X's styles
- `popup.html` — Settings popup with inline styles

## MCP Server Structure

- `mcp-server/src/index.ts` — Main entry: MCP server setup + HTTP sync server + all 4 MCP tools
- `mcp-server/src/sync-server.ts` — Standalone sync server (same HTTP endpoints, no MCP)
- TypeScript compiled to `mcp-server/build/` via `tsc`, targeting ES2022 with Node16 module resolution
