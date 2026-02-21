#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { createServer } from "http";
import { homedir } from "os";
import { join } from "path";

// ── Data directory & file ────────────────────────────────
const DATA_DIR = join(homedir(), ".tweet-tool-finder");
const DATA_FILE = join(DATA_DIR, "tools.json");
const PORT = 7849; // local sync port

interface SavedTweet {
  id: string;
  tool: string | null;
  category: "tool" | "hack" | "productivity" | null;
  summary: string | null;
  author: string;
  handle: string;
  url: string;
  text: string;
  confidence: number;
  foundAt: string;
}

// ── Helpers ──────────────────────────────────────────────
function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!existsSync(DATA_FILE)) {
    writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
  }
}

function loadTweets(): SavedTweet[] {
  ensureDataDir();
  try {
    const raw = readFileSync(DATA_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveTweets(tweets: SavedTweet[]): void {
  ensureDataDir();
  writeFileSync(DATA_FILE, JSON.stringify(tweets, null, 2));
}

// ── HTTP sync server (receives data from Chrome extension) ─
function startSyncServer(): void {
  const server = createServer((req, res) => {
    // CORS for Chrome extension
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // GET /tweets — return all saved tweets
    if (req.method === "GET" && req.url === "/tweets") {
      const tweets = loadTweets();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ count: tweets.length, tweets }));
      return;
    }

    // POST /tweets — add new tweets (from Chrome extension)
    if (req.method === "POST" && req.url === "/tweets") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const incoming = JSON.parse(body);
          const newTweets: SavedTweet[] = Array.isArray(incoming) ? incoming : [incoming];
          const existing = loadTweets();
          const existingIds = new Set(existing.map((t) => t.id));

          let added = 0;
          for (const tweet of newTweets) {
            if (tweet.id && !existingIds.has(tweet.id)) {
              existing.unshift(tweet);
              existingIds.add(tweet.id);
              added++;
            }
          }

          saveTweets(existing);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, added, total: existing.length }));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        }
      });
      return;
    }

    // DELETE /tweets — clear all
    if (req.method === "DELETE" && req.url === "/tweets") {
      saveTweets([]);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, message: "All tweets cleared" }));
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.error(`[TTF] Sync server running on http://127.0.0.1:${PORT}`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[TTF] Port ${PORT} already in use — another instance may be running`);
    } else {
      console.error(`[TTF] Sync server error:`, err.message);
    }
  });
}

// ── MCP Server ───────────────────────────────────────────
const server = new McpServer({
  name: "tweet-tool-finder",
  version: "1.0.0",
});

// Tool: search_tools — fuzzy search through saved tools
server.tool(
  "search_tools",
  "Search your saved developer tools, hacks, and productivity tips from Twitter. Use this when the user asks things like 'is there a tool for X?' or 'do I have anything saved about Y?'",
  {
    query: z.string().describe("Search query — tool name, category, keyword, or problem description"),
    category: z
      .enum(["tool", "hack", "productivity", "all"])
      .optional()
      .default("all")
      .describe("Filter by category"),
  },
  async ({ query, category }) => {
    const tweets = loadTweets();
    const q = query.toLowerCase();

    let filtered = category === "all" ? tweets : tweets.filter((t) => t.category === category);

    // Search across tool name, summary, text, author
    const results = filtered.filter((t) => {
      const searchable = [t.tool, t.summary, t.text, t.handle, t.author]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      // Split query into words and check if all match
      const words = q.split(/\s+/);
      return words.every((word) => searchable.includes(word));
    });

    if (results.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No saved tools/hacks found matching "${query}". You have ${tweets.length} total items saved. Try a broader search or check list_all_tools.`,
          },
        ],
      };
    }

    const formatted = results.slice(0, 15).map((t, i) => {
      return `${i + 1}. **${t.tool || "Untitled"}** [${t.category}]\n   ${t.summary || t.text.slice(0, 150)}\n   By: ${t.handle} | ${t.url}`;
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${results.length} result(s) for "${query}":\n\n${formatted.join("\n\n")}`,
        },
      ],
    };
  }
);

// Tool: list_all_tools — list everything saved
server.tool(
  "list_all_tools",
  "List all saved developer tools, hacks, and tips collected from Twitter. Use this for a full overview or when the user asks 'what tools do I have saved?' or 'show me everything'.",
  {
    category: z
      .enum(["tool", "hack", "productivity", "all"])
      .optional()
      .default("all")
      .describe("Filter by category"),
    limit: z.number().optional().default(30).describe("Max items to return"),
  },
  async ({ category, limit }) => {
    const tweets = loadTweets();
    const filtered = category === "all" ? tweets : tweets.filter((t) => t.category === category);
    const items = filtered.slice(0, limit);

    if (items.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No items found${category !== "all" ? ` in category "${category}"` : ""}. Total saved: ${tweets.length}.`,
          },
        ],
      };
    }

    const formatted = items.map((t, i) => {
      return `${i + 1}. **${t.tool || "Untitled"}** [${t.category}] — ${t.summary || t.text.slice(0, 100)}\n   ${t.url}`;
    });

    const summary = `Showing ${items.length} of ${filtered.length} items${category !== "all" ? ` (category: ${category})` : ""}:`;

    return {
      content: [
        {
          type: "text" as const,
          text: `${summary}\n\n${formatted.join("\n\n")}`,
        },
      ],
    };
  }
);

// Tool: get_stats — summary statistics
server.tool(
  "get_stats",
  "Get statistics about your saved tools collection — total count, breakdown by category, most recent additions.",
  {},
  async () => {
    const tweets = loadTweets();
    const tools = tweets.filter((t) => t.category === "tool").length;
    const hacks = tweets.filter((t) => t.category === "hack").length;
    const productivity = tweets.filter((t) => t.category === "productivity").length;
    const recent = tweets.slice(0, 5);

    const recentFormatted = recent.map((t) => `  • ${t.tool || t.summary || "Untitled"} [${t.category}]`).join("\n");

    return {
      content: [
        {
          type: "text" as const,
          text: `📊 Tweet Tool Finder Stats:\n\n• Total saved: ${tweets.length}\n• Tools: ${tools}\n• Hacks: ${hacks}\n• Productivity: ${productivity}\n\nMost recent:\n${recentFormatted || "  (none yet)"}`,
        },
      ],
    };
  }
);

// Tool: recommend_tool — AI-friendly prompt for getting suggestions
server.tool(
  "recommend_tool",
  "Given a problem or task description, find the most relevant saved tool or hack. Use when the user says things like 'I need something for...' or 'what should I use to...'",
  {
    problem: z.string().describe("The problem or task the user needs a tool for"),
  },
  async ({ problem }) => {
    const tweets = loadTweets();
    const q = problem.toLowerCase();

    // Score each tweet by relevance
    const scored = tweets.map((t) => {
      const searchable = [t.tool, t.summary, t.text].filter(Boolean).join(" ").toLowerCase();
      const words = q.split(/\s+/).filter((w) => w.length > 2);
      const matchCount = words.filter((word) => searchable.includes(word)).length;
      const score = matchCount / Math.max(words.length, 1);
      return { ...t, score };
    });

    const relevant = scored
      .filter((t) => t.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (relevant.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `I couldn't find any saved tools matching that problem. You have ${tweets.length} items saved — try rephrasing or use search_tools with different keywords.`,
          },
        ],
      };
    }

    const formatted = relevant.map((t, i) => {
      return `${i + 1}. **${t.tool || "Untitled"}** (${Math.round(t.score * 100)}% match)\n   ${t.summary || t.text.slice(0, 150)}\n   Category: ${t.category} | By: ${t.handle}\n   Link: ${t.url}`;
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Here are the most relevant saved tools for "${problem}":\n\n${formatted.join("\n\n")}`,
        },
      ],
    };
  }
);

// ── Start ────────────────────────────────────────────────
async function main() {
  // Start the HTTP sync server for Chrome extension
  startSyncServer();

  // Start MCP stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
