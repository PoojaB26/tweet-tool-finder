// background.js — handles Anthropic API classification calls

function sanitizeForJSON(text) {
  // Remove emojis, special unicode, and control characters that break JSON
  return text
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')  // control chars
    .replace(/\\/g, '\\\\')  // escape backslashes
    .replace(/"/g, '\\"')     // escape quotes
    .replace(/\n/g, ' ')      // newlines to spaces
    .replace(/\r/g, '')       // remove carriage returns
    .replace(/\t/g, ' ')      // tabs to spaces
    .trim()
    .slice(0, 500);           // limit length
}

const DAILY_LIMIT = 1000;

function getTodayKey() {
  return 'dailyCount_' + new Date().toISOString().slice(0, 10);
}

async function getDailyCount() {
  const key = getTodayKey();
  return new Promise(resolve => {
    chrome.storage.local.get([key], (data) => {
      resolve(data[key] || 0);
    });
  });
}

async function incrementDailyCount() {
  const key = getTodayKey();
  const count = await getDailyCount();
  return new Promise(resolve => {
    chrome.storage.local.set({ [key]: count + 1 }, () => {
      resolve(count + 1);
    });
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'CLASSIFY_TWEET') {
    getDailyCount().then(count => {
      if (count >= DAILY_LIMIT) {
        sendResponse({ success: false, error: 'DAILY_LIMIT_REACHED' });
        return;
      }
      classifyTweet(request.text, request.apiKey)
        .then(async result => {
          await incrementDailyCount();
          sendResponse({ success: true, data: result });
        })
        .catch(err => sendResponse({ success: false, error: err.message }));
    });
    return true; // keep channel open for async
  }

  if (request.type === 'GET_DAILY_COUNT') {
    getDailyCount().then(count => sendResponse({ count, limit: DAILY_LIMIT }));
    return true;
  }

  if (request.type === 'GET_SETTINGS') {
    chrome.storage.local.get(['apiKey', 'autoScan', 'paused', 'showSidebar', 'ignoredHandles'], (data) => {
      sendResponse(data);
    });
    return true;
  }

  if (request.type === 'SAVE_SETTINGS') {
    chrome.storage.local.set(request.settings, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.type === 'GET_FOUND_TWEETS') {
    chrome.storage.local.get(['foundTweets', 'scannedCount'], (data) => {
      sendResponse({
        foundTweets: data.foundTweets || [],
        scannedCount: data.scannedCount || 0
      });
    });
    return true;
  }

  if (request.type === 'SAVE_FOUND_TWEET') {
    chrome.storage.local.get(['foundTweets', 'scannedCount'], (data) => {
      const tweets = data.foundTweets || [];
      // Avoid duplicates
      if (!tweets.find(t => t.id === request.tweet.id)) {
        tweets.unshift(request.tweet);
        // Keep max 200 tweets
        if (tweets.length > 200) tweets.pop();
      }
      chrome.storage.local.set({ foundTweets: tweets }, () => {
        sendResponse({ success: true, count: tweets.length });
      });
    });
    return true;
  }

  if (request.type === 'INCREMENT_SCANNED') {
    chrome.storage.local.get(['scannedCount'], (data) => {
      const count = (data.scannedCount || 0) + 1;
      chrome.storage.local.set({ scannedCount: count }, () => {
        sendResponse({ count });
      });
    });
    return true;
  }

  if (request.type === 'CLEAR_TWEETS') {
    chrome.storage.local.set({ foundTweets: [], scannedCount: 0 }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

});

async function classifyTweet(tweetText, apiKey) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: `You are a tweet classifier. Analyze tweets to determine if they share a useful software development tool, coding hack/trick, or productivity workflow tip. 

Respond ONLY with valid JSON, no other text before or after:
{"is_useful": true, "category": "tool", "tool_name": "name or null", "summary": "one-line summary or null", "confidence": 0.8}

Only mark as useful if the tweet genuinely teaches something actionable — a specific tool, technique, shortcut, or workflow. Ignore promotional/marketing tweets, vague motivational content, memes, image-only posts, or pure opinions.`,
      messages: [
        {
          role: 'user',
          content: `Classify this tweet:\n\n${sanitizeForJSON(tweetText)}`
        }
      ]
    })
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`API error ${response.status}: ${errBody}`);
  }

  const data = await response.json();
  const text = data.content[0].text.trim();

  // Parse JSON — strip backticks and extract first valid JSON object
  let cleaned = text.replace(/```json|```/g, '').trim();
  
  // Find the first complete JSON object
  const startIdx = cleaned.indexOf('{');
  if (startIdx === -1) throw new Error('No JSON object found in response');
  
  let braceCount = 0;
  let endIdx = -1;
  for (let i = startIdx; i < cleaned.length; i++) {
    if (cleaned[i] === '{') braceCount++;
    if (cleaned[i] === '}') braceCount--;
    if (braceCount === 0) {
      endIdx = i;
      break;
    }
  }
  
  if (endIdx === -1) throw new Error('Incomplete JSON object');
  
  return JSON.parse(cleaned.slice(startIdx, endIdx + 1));
}
