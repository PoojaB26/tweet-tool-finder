// content.js — Scans X/Twitter feed and collects useful tool/hack tweets

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────
  let settings = { apiKey: '', autoScan: true, showSidebar: true, ignoredHandles: [] };
  let processedTweetIds = new Set();
  let foundTweets = [];
  let isScanning = false;
  let isPaused = false;
  let scanQueue = [];
  let activeFilter = 'all'; // 'all', 'tool', 'hack', 'productivity'
  let sidebarOpen = false;

  // Rate limiting: max concurrent API calls
  const MAX_CONCURRENT = 2;
  let activeCalls = 0;
  let dailyCount = 0;
  const DAILY_LIMIT = 1000;
  let limitReached = false;

  // ── Initialize ─────────────────────────────────────────
  init();

  async function init() {
    // Load settings
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (data) => {
      if (data) {
        settings = { ...settings, ...data };
        isPaused = !!data.paused;
      }
      // Load previously found tweets
      chrome.runtime.sendMessage({ type: 'GET_FOUND_TWEETS' }, (resp) => {
        foundTweets = resp.foundTweets || [];
        // Mark already-processed tweets
        foundTweets.forEach(t => processedTweetIds.add(t.id));
        // Load daily count
        chrome.runtime.sendMessage({ type: 'GET_DAILY_COUNT' }, (dcResp) => {
          dailyCount = dcResp?.count || 0;
          limitReached = dailyCount >= DAILY_LIMIT;
          createUI();
          if (settings.autoScan && settings.apiKey && !limitReached) {
            startObserving();
          }
        });
      });
    });
  }

  // ── Listen for settings updates from popup ─────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SETTINGS_UPDATED') {
      const wasPaused = isPaused;
      settings = { ...settings, ...msg.settings };
      isPaused = !!msg.settings.paused;
      
      if (isPaused && !wasPaused) {
        scanQueue = [];
        updateScanStatus('Paused', false);
      } else if (!isPaused && wasPaused) {
        updateScanStatus('Resumed. Watching feed...', true);
        scanVisibleTweets();
      }

      if (settings.autoScan && settings.apiKey && !isPaused) {
        startObserving();
      }
      updateSidebarVisibility();
    }
  });

  // ── UI Creation ────────────────────────────────────────
  function createUI() {
    // Toggle button
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'ttf-toggle-btn';
    toggleBtn.innerHTML = `⚡<span class="ttf-badge" style="display:none">0</span>`;
    toggleBtn.addEventListener('click', toggleSidebar);
    document.body.appendChild(toggleBtn);

    // Sidebar
    const sidebar = document.createElement('div');
    sidebar.id = 'ttf-sidebar';
    sidebar.innerHTML = `
      <div class="ttf-header">
        <div class="ttf-header-top">
          <h2>⚡ Tool Finder</h2>
          <button class="ttf-close-btn" id="ttf-close">✕</button>
        </div>
        <div class="ttf-tabs">
          <button class="ttf-tab active" data-filter="all">All</button>
          <button class="ttf-tab" data-filter="tool">Tools</button>
          <button class="ttf-tab" data-filter="hack">Hacks</button>
          <button class="ttf-tab" data-filter="productivity">Productivity</button>
        </div>
      </div>
      <div class="ttf-scan-status" id="ttf-scan-status">
        <span class="ttf-pulse"></span>
        <span id="ttf-status-text">Waiting to scan...</span>
        <span id="ttf-daily-counter" style="margin-left:auto;color:#6a6a7a;font-size:10px;">0 / 1000 today</span>
      </div>
      <div class="ttf-cards" id="ttf-cards">
        <div class="ttf-empty">
          <div class="ttf-empty-icon">🔍</div>
          <h3>No tools found yet</h3>
          <p>Scroll through your feed and I'll catch tweets about useful tools & hacks.</p>
        </div>
      </div>
      <div class="ttf-footer">
        <button class="ttf-clear-btn" id="ttf-clear">Clear</button>
        <button class="ttf-sync-btn" id="ttf-sync-mcp">🔄 Sync MCP</button>
        <button class="ttf-copy-ctx-btn" id="ttf-copy-ctx">📋 Copy for LLM</button>
        <button class="ttf-export-btn" id="ttf-export-ctx">⬇ JSON</button>
      </div>
    `;
    document.body.appendChild(sidebar);

    // Event listeners
    document.getElementById('ttf-close').addEventListener('click', toggleSidebar);
    document.getElementById('ttf-clear').addEventListener('click', clearAll);
    document.getElementById('ttf-sync-mcp').addEventListener('click', syncAllToMCP);
    document.getElementById('ttf-copy-ctx').addEventListener('click', copyContext);
    document.getElementById('ttf-export-ctx').addEventListener('click', exportContext);

    sidebar.querySelectorAll('.ttf-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        sidebar.querySelectorAll('.ttf-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        activeFilter = tab.dataset.filter;
        renderCards();
      });
    });

    // Initial render
    renderCards();
    updateBadge();
    updateSidebarVisibility();
  }

  function toggleSidebar() {
    const sidebar = document.getElementById('ttf-sidebar');
    sidebarOpen = !sidebarOpen;
    sidebar.classList.toggle('ttf-open', sidebarOpen);
  }

  function updateSidebarVisibility() {
    const toggleBtn = document.getElementById('ttf-toggle-btn');
    if (toggleBtn) {
      toggleBtn.style.display = settings.showSidebar ? 'flex' : 'none';
    }
  }

  function updateBadge() {
    const badge = document.querySelector('#ttf-toggle-btn .ttf-badge');
    if (!badge) return;
    const count = foundTweets.length;
    badge.textContent = count;
    badge.style.display = count > 0 ? 'flex' : 'none';
  }

  function updateScanStatus(text, scanning) {
    const statusEl = document.getElementById('ttf-scan-status');
    const textEl = document.getElementById('ttf-status-text');
    const counterEl = document.getElementById('ttf-daily-counter');
    if (!statusEl || !textEl) return;
    textEl.textContent = text;
    statusEl.classList.toggle('idle', !scanning);
    if (counterEl) {
      counterEl.textContent = `${dailyCount} / ${DAILY_LIMIT} today`;
      counterEl.style.color = dailyCount >= DAILY_LIMIT * 0.9 ? '#ff3b5c' : '#6a6a7a';
    }
  }

  // ── Render Cards ───────────────────────────────────────
  function renderCards() {
    const container = document.getElementById('ttf-cards');
    if (!container) return;

    const filtered = activeFilter === 'all'
      ? foundTweets
      : foundTweets.filter(t => t.category === activeFilter);

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="ttf-empty">
          <div class="ttf-empty-icon">🔍</div>
          <h3>No ${activeFilter === 'all' ? 'tools' : activeFilter + 's'} found yet</h3>
          <p>Scroll through your feed and I'll catch tweets about useful tools & hacks.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(tweet => {
      return `
      <div class="ttf-card" data-url="${tweet.url}" data-id="${tweet.id}">
        <div class="ttf-card-header">
          ${tweet.avatar ? `<img class="ttf-avatar" src="${tweet.avatar}" alt="" />` : '<div class="ttf-avatar"></div>'}
          <div style="flex:1;min-width:0">
            <div class="ttf-author">${escapeHtml(tweet.author)}</div>
            <div class="ttf-handle">${escapeHtml(tweet.handle)}</div>
          </div>
          <button class="ttf-delete-btn" data-id="${tweet.id}" title="Remove">✕</button>
          <span class="ttf-open-icon" title="Open tweet on X">↗</span>
        </div>
        ${tweet.summary ? `<div class="ttf-card-summary">💡 ${escapeHtml(tweet.summary)}</div>` : ''}
        <div class="ttf-card-tags">
          ${tweet.category ? `<span class="ttf-tag ${tweet.category}">${tweet.category}</span>` : ''}
          ${tweet.toolName ? `<span class="ttf-tag tool">${escapeHtml(tweet.toolName)}</span>` : ''}
        </div>
      </div>
    `}).join('');

    // Attach click handlers for opening tweets
    container.querySelectorAll('.ttf-card').forEach(card => {
      card.addEventListener('click', (e) => {
        // Don't open tweet if delete button was clicked
        if (e.target.closest('.ttf-delete-btn')) return;
        const url = card.getAttribute('data-url');
        if (url) window.open(url, '_blank');
      });
    });

    // Attach delete handlers
    container.querySelectorAll('.ttf-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        removeTweet(id);
      });
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
  }

  // ── Tweet Extraction from DOM ──────────────────────────
  function extractTweetsFromDOM() {
    // X/Twitter uses article elements for tweets
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    const tweets = [];

    articles.forEach(article => {
      try {
        // Get tweet link for unique ID
        const timeEl = article.querySelector('time');
        const linkEl = timeEl ? timeEl.closest('a') : null;
        const tweetUrl = linkEl ? linkEl.href : null;

        if (!tweetUrl) return;

        // Only process actual tweet status URLs, skip everything else
        const match = tweetUrl.match(/^https?:\/\/(x|twitter)\.com\/[^/]+\/status\/(\d+)/);
        if (!match) return;
        const tweetId = match[2];
        if (processedTweetIds.has(tweetId)) return;

        // Get tweet text
        const tweetTextEl = article.querySelector('[data-testid="tweetText"]');
        const tweetText = tweetTextEl ? tweetTextEl.textContent.trim() : '';
        if (!tweetText || tweetText.length < 50) return; // skip short/image-only tweets

        // Get author info
        const userLinks = article.querySelectorAll('a[role="link"]');
        let author = '';
        let handle = '';
        let avatar = '';

        userLinks.forEach(link => {
          const href = link.getAttribute('href');
          if (href && href.match(/^\/[^/]+$/) && !handle) {
            handle = '@' + href.slice(1);
            const nameSpan = link.querySelector('span');
            if (nameSpan) author = nameSpan.textContent;
          }
        });

        const avatarImg = article.querySelector('img[src*="profile_images"]');
        if (avatarImg) avatar = avatarImg.src;

        // Skip ignored handles
        const handleLower = (handle || '').toLowerCase();
        const ignored = (settings.ignoredHandles || []).map(h => h.toLowerCase());
        if (ignored.some(h => handleLower === h || handleLower === '@' + h.replace('@', ''))) return;

        tweets.push({
          id: tweetId,
          text: tweetText,
          url: tweetUrl,
          author: author || 'Unknown',
          handle: handle || '@unknown',
          avatar
        });
      } catch (e) {
        // Skip problematic tweets silently
      }
    });

    return tweets;
  }

  // ── Classification Pipeline ────────────────────────────
  async function processTweet(tweet) {
    if (!settings.apiKey) return;
    if (limitReached) {
      updateScanStatus('Daily limit reached (1000 tweets). Resets tomorrow.', false);
      scanQueue = [];
      return;
    }

    if (processedTweetIds.has(tweet.id)) return;
    processedTweetIds.add(tweet.id);

    // Increment scanned count — only for unique API calls
    chrome.runtime.sendMessage({ type: 'INCREMENT_SCANNED' });

    try {
      activeCalls++;
      updateScanStatus(`Analyzing tweet...`, true);

      const result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'CLASSIFY_TWEET',
          text: tweet.text,
          apiKey: settings.apiKey
        }, (response) => {
          if (response && response.success) {
            resolve(response.data);
          } else if (response?.error === 'DAILY_LIMIT_REACHED') {
            limitReached = true;
            reject(new Error('DAILY_LIMIT_REACHED'));
          } else {
            reject(new Error(response?.error || 'Classification failed'));
          }
        });
      });

      activeCalls--;
      dailyCount++;

      if (result.is_useful && result.confidence >= 0.6) {
        const enrichedTweet = {
          ...tweet,
          category: result.category,
          toolName: result.tool_name,
          summary: result.summary,
          confidence: result.confidence,
          foundAt: new Date().toISOString()
        };

        foundTweets.unshift(enrichedTweet);
        chrome.runtime.sendMessage({ type: 'SAVE_FOUND_TWEET', tweet: enrichedTweet });
        syncToMCP(enrichedTweet);

        renderCards();
        updateBadge();
        updateScanStatus(`Found: ${result.summary || result.tool_name}`, true);
      } else {
        updateScanStatus(`Scanned ${processedTweetIds.size} tweets...`, true);
      }
    } catch (err) {
      activeCalls--;
      if (err.message === 'DAILY_LIMIT_REACHED') {
        scanQueue = [];
        updateScanStatus('Daily limit reached (1000 tweets). Resets tomorrow.', false);
        return;
      }
      console.warn('[TTF] Classification error:', err.message);
      updateScanStatus(`Error — check API key`, false);
    }

    // Process next in queue
    processQueue();
  }

  function processQueue() {
    while (scanQueue.length > 0 && activeCalls < MAX_CONCURRENT) {
      const tweet = scanQueue.shift();
      processTweet(tweet);
    }

    if (scanQueue.length === 0 && activeCalls === 0) {
      updateScanStatus(`Scanned ${processedTweetIds.size} tweets · ${foundTweets.length} found`, false);
    }
  }

  function queueTweets(tweets) {
    tweets.forEach(t => {
      if (!processedTweetIds.has(t.id)) {
        scanQueue.push(t);
      }
    });
    processQueue();
  }

  // ── Feed Observer ──────────────────────────────────────
  let observer = null;
  let scanDebounce = null;

  function startObserving() {
    if (observer) return;

    // Initial scan
    scanVisibleTweets();

    // Watch for new tweets appearing (infinite scroll)
    observer = new MutationObserver(() => {
      clearTimeout(scanDebounce);
      scanDebounce = setTimeout(scanVisibleTweets, 1500);
    });

    const timeline = document.querySelector('main') || document.body;
    observer.observe(timeline, {
      childList: true,
      subtree: true
    });

    updateScanStatus('Watching feed...', true);
  }

  function scanVisibleTweets() {
    if (isPaused) return;
    if (!settings.apiKey) {
      updateScanStatus('Set API key in extension popup', false);
      return;
    }

    // Only scan on pages that have a feed (home, profile, search, lists)
    const path = window.location.pathname;
    const skipPages = ['/settings', '/messages', '/i/', '/login', '/signup'];
    if (skipPages.some(p => path.startsWith(p))) return;

    const tweets = extractTweetsFromDOM();
    if (tweets.length > 0) {
      queueTweets(tweets);
    }
  }

  // ── Actions ────────────────────────────────────────────
  function clearAll() {
    if (!confirm('Clear all found tweets?')) return;
    foundTweets = [];
    processedTweetIds.clear();
    chrome.runtime.sendMessage({ type: 'CLEAR_TWEETS' });
    renderCards();
    updateBadge();
    updateScanStatus('Cleared. Watching feed...', true);
  }

  function removeTweet(id) {
    foundTweets = foundTweets.filter(t => t.id !== id);
    // Update chrome storage
    chrome.runtime.sendMessage({ type: 'GET_FOUND_TWEETS' }, (data) => {
      const updated = (data.foundTweets || []).filter(t => t.id !== id);
      chrome.storage.local.set({ foundTweets: updated });
    });
    renderCards();
    updateBadge();
  }

  function exportTweets() {
    const filtered = activeFilter === 'all'
      ? foundTweets
      : foundTweets.filter(t => t.category === activeFilter);

    const data = JSON.stringify(filtered, null, 2);
    downloadFile(data, `tweet-tools-raw-${new Date().toISOString().slice(0, 10)}.json`);
  }

  function exportContext() {
    const tools = foundTweets.map(t => ({
      tool: t.toolName || null,
      category: t.category,
      summary: t.summary,
      author: t.handle,
      url: t.url,
      date: t.foundAt ? t.foundAt.slice(0, 10) : null
    }));

    const contextPayload = {
      _instruction: "This is a curated list of developer tools, coding hacks, and productivity tips I've collected from Twitter/X. Use this as context when I ask questions like 'is there a tool for X?' or 'what did I save about Y?'",
      total: tools.length,
      categories: {
        tools: tools.filter(t => t.category === 'tool').length,
        hacks: tools.filter(t => t.category === 'hack').length,
        productivity: tools.filter(t => t.category === 'productivity').length
      },
      items: tools
    };

    const data = JSON.stringify(contextPayload, null, 2);
    downloadFile(data, `tweet-tools-context-${new Date().toISOString().slice(0, 10)}.json`);
  }

  function copyContext() {
    const tools = foundTweets.map(t => ({
      tool: t.toolName || null,
      category: t.category,
      summary: t.summary,
      author: t.handle,
      url: t.url
    }));

    const contextPayload = {
      _instruction: "This is a curated list of developer tools, coding hacks, and productivity tips I've collected from Twitter/X. Use this as context when I ask questions like 'is there a tool for X?' or 'what did I save about Y?'",
      total: tools.length,
      items: tools
    };

    const text = JSON.stringify(contextPayload, null, 2);
    navigator.clipboard.writeText(text).then(() => {
      showToast('Copied to clipboard! Paste into Claude.');
    }).catch(() => {
      // Fallback
      downloadFile(text, `tweet-tools-context-${new Date().toISOString().slice(0, 10)}.json`);
    });
  }

  function downloadFile(content, filename) {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function showToast(message) {
    let toast = document.getElementById('ttf-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'ttf-toast';
      toast.style.cssText = `
        position: fixed; bottom: 90px; right: 24px; z-index: 100000;
        background: #00e5a0; color: #0d0d0f; padding: 10px 18px;
        border-radius: 8px; font-family: 'JetBrains Mono', monospace;
        font-size: 12px; font-weight: 600; opacity: 0;
        transition: opacity 0.3s; pointer-events: none;
        box-shadow: 0 4px 16px rgba(0,229,160,0.3);
      `;
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    setTimeout(() => { toast.style.opacity = '0'; }, 2500);
  }

  // ── MCP Server Sync ───────────────────────────────────
  async function syncToMCP(tweet) {
    try {
      const payload = {
        id: tweet.id,
        tool: tweet.toolName || null,
        category: tweet.category,
        summary: tweet.summary,
        author: tweet.author,
        handle: tweet.handle,
        url: tweet.url,
        text: tweet.text,
        confidence: tweet.confidence,
        foundAt: tweet.foundAt
      };

      chrome.runtime.sendMessage({ type: 'MCP_SYNC', tweets: payload }, (resp) => {
        if (resp && !resp.success) {
          // MCP server not running — that's fine
        }
      });
    } catch (e) {
      // Silently fail
    }
  }

  async function syncAllToMCP() {
    try {
      const tweets = foundTweets.map(t => ({
        id: t.id,
        tool: t.toolName || null,
        category: t.category,
        summary: t.summary,
        author: t.author,
        handle: t.handle,
        url: t.url,
        text: t.text,
        confidence: t.confidence,
        foundAt: t.foundAt
      }));

      chrome.runtime.sendMessage({ type: 'MCP_SYNC', tweets }, (resp) => {
        if (resp && resp.success) {
          showToast('Synced to MCP server!');
        } else {
          showToast('MCP server not running — start it first');
        }
      });
    } catch (e) {
      showToast('MCP server not running — start it first');
    }
  }
})();
