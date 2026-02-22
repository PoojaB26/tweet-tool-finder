# ⚡ Tweet Tool Finder

A Chrome extension that scans your X/Twitter feed, collects tweets about useful **developer tools**, **coding hacks**, and **productivity tips** — classified automatically using Claude Haiku.

## Prerequisites

- **Anthropic API key** — get one at [console.anthropic.com](https://console.anthropic.com)
- **Chrome** (or Chromium-based browser)

## How It Works

The extension injects a content script on x.com **home feed and search pages only**. It uses a `MutationObserver` to detect new `article[data-testid="tweet"]` elements as they appear in the DOM while you scroll — no polling, no page reloads needed.

For each new tweet it finds the permalink via the `<time>` element's parent `<a>` tag (used as a unique ID), pulls visible text from `[data-testid="tweetText"]` using `.textContent`, and extracts the author name, handle, and avatar.

Before any API call, tweets are filtered: already-seen IDs are skipped (deduped for the session), tweets under 50 characters are dropped, and ignored handles are excluded. Survivors are queued and classified by **Claude Haiku** (`claude-haiku-4-5-20251001`) with at most 2 concurrent calls. The model determines:

- Whether the tweet is **useful** (actionable tool/technique, not marketing or vague content)
- A **category**: `tool` (specific software/library), `hack` (coding trick or shortcut), or `productivity` (workflow tip)
- A **tool name** and **one-line summary**
- A **confidence score** (0–1)

Tweets under 50 characters, or with a confidence score below 0.6, are discarded. Matched tweets are stored in Chrome local storage and shown in a sidebar overlay.

## Quick Start

1. Open `chrome://extensions/` → enable **Developer mode**
2. Click **Load unpacked** → select this folder
3. Click the extension icon → enter your **Anthropic API key** → Save
4. Go to [x.com](https://x.com) and scroll — the sidebar will fill up automatically
5. The extension only runs while you're actively browsing — no background scanning when X isn't open.

## Extension Features

### Popup Settings

Click the extension icon to access:

- **API key** — stored in Chrome local storage only
- **Auto-scan** — automatically classify tweets as you scroll (on by default)
- **Pause scanning** — temporarily stop all classification
- **Show sidebar** — toggle the sidebar panel on X
- **Ignore handles** — skip tweets from specific accounts (e.g. `@ads_account`)
- **Stats** — scanned count, found count, and daily API usage

### Sidebar Panel

The sidebar overlay on X shows classified tweets with:

- **Filter tabs** — All, Tools, Hacks, Productivity
- **Search** — keyword search across tool names, summaries, tweet text, and authors
- **Tweet cards** — click to open the original tweet on X, or click ✕ to remove
- **Copy for LLM** — copies a structured JSON context to clipboard (paste into any LLM)
- **JSON export** — download all found tweets as a JSON file
- **Clear** — remove all saved tweets


## Privacy

- All data stored locally in Chrome storage only
- No local servers or external data exposure
- Only outbound call is to the Anthropic API for tweet classification

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Sidebar not appearing | Make sure "Show sidebar" is enabled in popup settings, and you're on x.com or twitter.com |
| Tweets not being classified | Check that "Pause scanning" is off and "Auto-scan" is on in popup settings |
| "Set API key in extension popup" | Click the extension icon and enter your Anthropic API key |
| Daily limit reached | Wait until midnight for the counter to reset |
