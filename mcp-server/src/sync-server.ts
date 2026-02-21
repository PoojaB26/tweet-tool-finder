#!/usr/bin/env node

// Standalone sync server — run this to receive data from the Chrome extension
// Usage: node build/sync-server.js

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { createServer } from "http";
import { homedir } from "os";
import { join } from "path";

const DATA_DIR = join(homedir(), ".tweet-tool-finder");
const DATA_FILE = join(DATA_DIR, "tools.json");
const PORT = 7849;

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!existsSync(DATA_FILE)) {
    writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
  }
}

function loadTweets(): any[] {
  ensureDataDir();
  try {
    return JSON.parse(readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveTweets(tweets: any[]): void {
  ensureDataDir();
  writeFileSync(DATA_FILE, JSON.stringify(tweets, null, 2));
}

const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/tweets") {
    const tweets = loadTweets();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ count: tweets.length, tweets }));
    return;
  }

  if (req.method === "POST" && req.url === "/tweets") {
    let body = "";
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", () => {
      try {
        const incoming = JSON.parse(body);
        const newTweets = Array.isArray(incoming) ? incoming : [incoming];
        const existing = loadTweets();
        const existingIds = new Set(existing.map((t: any) => t.id));

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
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  if (req.method === "DELETE" && req.url === "/tweets") {
    saveTweets([]);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`⚡ Tweet Tool Finder sync server running on http://127.0.0.1:${PORT}`);
  console.log(`   Data file: ${DATA_FILE}`);
  console.log(`   Press Ctrl+C to stop`);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} already in use — is another instance running?`);
  } else {
    console.error("Server error:", err.message);
  }
  process.exit(1);
});
