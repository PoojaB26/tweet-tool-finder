# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tweet Tool Finder is a Chrome Extension that scans X/Twitter feeds, classifies tweets about developer tools/hacks/productivity tips using Claude Haiku, and displays results in a sidebar overlay with search and export.

## Architecture

Single component — the Chrome Extension (root directory):

- **Content script** (`js/content.js`) — injected on x.com/twitter.com home feed and search pages. Creates the sidebar UI, observes the feed via MutationObserver, filters and queues tweets for classification, handles search/export/clear.
- **Background service worker** (`js/background.js`) — handles all message routing, Anthropic API calls, and Chrome storage reads/writes.

### Data Flow

- Content script extracts tweets from DOM (home/search pages only) → dedupes, filters short tweets and ignored handles → queues survivors
- Background script calls Anthropic API with Claude Haiku → returns classification result
- Classified tweets stored in Chrome local storage (max 200)

### Chrome Extension Message Types

All inter-component communication uses `chrome.runtime.sendMessage` with these types: `CLASSIFY_TWEET`, `GET_SETTINGS`, `SAVE_SETTINGS`, `SETTINGS_UPDATED`, `GET_FOUND_TWEETS`, `SAVE_FOUND_TWEET`, `INCREMENT_SCANNED`, `GET_DAILY_COUNT`, `CLEAR_TWEETS`.

## Build Commands

### Chrome Extension
No build step — plain JS. Load unpacked at `chrome://extensions/` pointing to the repo root.

## Key Constants

- **Daily API limit**: 1000 tweets per day (tracked in Chrome storage by date key)
- **Max concurrent API calls**: 2
- **Max stored tweets**: 200 (in Chrome storage)
- **Classification model**: `claude-haiku-4-5-20251001`
- **Tweet min length**: 50 chars (shorter tweets skipped)
- **Confidence threshold**: 0.6 (below this, tweets are discarded)

## Extension Structure

- `manifest.json` — Manifest V3, content script runs on x.com/twitter.com at `document_idle`
- `js/content.js` — IIFE that creates sidebar UI, observes feed via MutationObserver, queues tweets for classification, handles keyword search (`searchQuery` state), export, and clear
- `js/background.js` — Service worker handling all message routing and Anthropic API calls
- `js/popup.js` — Settings popup logic (API key, toggles, ignored handles)
- `css/sidebar.css` — Sidebar styling; all classes prefixed with `ttf-` to avoid conflicts with X's styles
- `popup.html` — Settings popup with inline styles
