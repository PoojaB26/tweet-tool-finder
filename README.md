# ⚡ Tweet Tool Finder

A Chrome extension + MCP server that scans your X/Twitter feed, collects tweets about useful **developer tools**, **coding hacks**, and **productivity tips** — and lets you query them from Claude via MCP.

## Prerequisites

- **Node.js** (v18+ recommended)
- **Anthropic API key** — get one at [console.anthropic.com](https://console.anthropic.com)
- **Chrome** (or Chromium-based browser)

## Architecture

```
┌──────────────────┐       ┌──────────────────┐       ┌──────────────┐
│  Chrome Extension │──────▶│  MCP Server      │◀──────│  Claude Chat │
│  (scans X feed)   │ HTTP  │  (local Node.js) │ stdio │  / Claude    │
│                   │ sync  │  ~/.tweet-tool-   │       │    Code      │
│  Sidebar panel    │       │  finder/tools.json│       │              │
└──────────────────┘       └──────────────────┘       └──────────────┘
```

- **Chrome extension** scans your feed, classifies tweets with Claude Haiku, shows matches in a sidebar
- **MCP server** stores all found tweets in a local JSON file and exposes search/query tools
- **Claude Desktop or Claude Code** connects to the MCP server — ask "is there a tool for X?" naturally

## Quick Start

### 1. Install Chrome Extension

1. Open `chrome://extensions/` → enable **Developer mode**
2. Click **Load unpacked** → select this folder (the root, not mcp-server)
3. Click the extension icon → enter your **Anthropic API key** → Save
4. Go to [x.com](https://x.com) and scroll!

### 2. Setup MCP Server

```bash
cd mcp-server
npm install
npm run build
```

### 3. Connect to Claude Desktop

Add to your Claude Desktop config:

| OS | Config path |
|----|-------------|
| Mac | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "tweet-tool-finder": {
      "command": "node",
      "args": ["/FULL/PATH/TO/tweet-tool-finder/mcp-server/build/index.js"]
    }
  }
}
```

Replace `/FULL/PATH/TO/` with the actual path.

### 3b. Or Connect to Claude Code

```bash
claude mcp add tweet-tool-finder node /FULL/PATH/TO/tweet-tool-finder/mcp-server/build/index.js
```

### 4. Use It!

Now in Claude, just ask naturally:

- *"Is there a tool for converting JSON to TypeScript types?"*
- *"What dev tools have I saved recently?"*
- *"Show me all the productivity hacks I've collected"*
- *"I need something for API testing — do I have anything?"*

## MCP Tools

| Tool | Description |
|------|-------------|
| `search_tools` | Search saved tools by keyword or problem description |
| `list_all_tools` | List everything saved, optionally filtered by category |
| `get_stats` | Stats — counts by category, recent additions |
| `recommend_tool` | Describe a problem, get the best matching saved tool |

## How Classification Works

Each tweet visible in your feed is sent to **Claude Haiku** (`claude-haiku-4-5-20251001`) for classification. The model determines:

- Whether the tweet is **useful** (actionable tool/technique, not marketing or vague content)
- A **category**: `tool` (specific software/library), `hack` (coding trick or shortcut), or `productivity` (workflow tip)
- A **tool name** and **one-line summary**
- A **confidence score** (0–1)

Tweets are discarded if they're under 50 characters, or if the confidence score is below 0.6.

There's a **daily limit of 1,000 API calls** to prevent runaway costs. The counter resets at midnight and is visible in both the popup and sidebar.

## Extension Features

### Popup Settings

Click the extension icon to access:

- **API key** — your Anthropic API key (stored in Chrome local storage)
- **Auto-scan** — automatically classify tweets as you scroll (on by default)
- **Pause scanning** — temporarily stop all classification
- **Show sidebar** — toggle the sidebar panel on X
- **Ignore handles** — skip tweets from specific accounts (e.g. `@ads_account`)
- **Stats** — scanned count, found count, and daily API usage

### Sidebar Panel

The sidebar overlay on X shows classified tweets with:

- **Filter tabs** — All, Tools, Hacks, Productivity
- **Tweet cards** — click to open the original tweet on X, or click ✕ to remove
- **Sync MCP** — manually push all saved tweets to the MCP server
- **Copy for LLM** — copies a structured JSON context to clipboard (paste into any LLM)
- **JSON export** — download all found tweets as a JSON file
- **Clear** — remove all saved tweets

## Syncing

- **Auto**: Every new classified tweet is sent to the MCP server (if running)
- **Manual**: Click **Sync MCP** in the sidebar to push all saved tweets
- Data lives in `~/.tweet-tool-finder/tools.json`

### Standalone Sync Server

If you just want to receive data from the extension without running the full MCP server:

```bash
cd mcp-server
npm run sync
```

This starts only the HTTP endpoint on `127.0.0.1:7849` — useful for collecting tweets before setting up MCP.

## Cost

~$0.0003 per tweet using Claude Haiku. ~$0.30 per 1,000 tweets. The built-in daily limit of 1,000 tweets caps costs at ~$0.30/day.

## Privacy

- All data stored locally (Chrome storage + `~/.tweet-tool-finder/`)
- MCP server runs on `127.0.0.1:7849` only — no external access
- No third-party data sharing (only Anthropic API for classification)

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Set API key in extension popup" | Click the extension icon and enter your Anthropic API key |
| Sidebar not appearing | Make sure "Show sidebar" is enabled in popup settings, and you're on x.com or twitter.com |
| MCP sync fails | Ensure the MCP server is running (`cd mcp-server && npm run start`) |
| Port 7849 already in use | Another instance may be running — kill it or restart your terminal |
| Daily limit reached | Wait until midnight for the counter to reset, or the 1,000 limit is per-day |
| Tweets not being classified | Check that "Pause scanning" is off and "Auto-scan" is on in popup settings |
