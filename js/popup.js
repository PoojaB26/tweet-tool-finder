// popup.js — settings page logic

document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const autoScanToggle = document.getElementById('autoScan');
  const pauseScanToggle = document.getElementById('pauseScan');
  const showSidebarToggle = document.getElementById('showSidebar');
  const saveBtn = document.getElementById('saveBtn');
  const statusEl = document.getElementById('status');
  const scannedEl = document.getElementById('scannedCount');
  const foundEl = document.getElementById('foundCount');
  const handleInput = document.getElementById('handleInput');
  const addHandleBtn = document.getElementById('addHandle');
  const handleList = document.getElementById('handleList');

  let ignoredHandles = [];

  // Load saved settings
  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (data) => {
    if (data.apiKey) apiKeyInput.value = data.apiKey;
    if (data.autoScan !== undefined) autoScanToggle.checked = data.autoScan;
    if (data.paused !== undefined) pauseScanToggle.checked = data.paused;
    if (data.showSidebar !== undefined) showSidebarToggle.checked = data.showSidebar;
    if (data.ignoredHandles) {
      ignoredHandles = data.ignoredHandles;
      renderHandles();
    }
  });

  // Load stats
  chrome.runtime.sendMessage({ type: 'GET_FOUND_TWEETS' }, (data) => {
    scannedEl.textContent = data.scannedCount || 0;
    foundEl.textContent = (data.foundTweets || []).length;
  });

  // Load daily count
  chrome.runtime.sendMessage({ type: 'GET_DAILY_COUNT' }, (data) => {
    const dailyEl = document.getElementById('dailyCount');
    if (dailyEl && data) {
      dailyEl.textContent = data.count || 0;
      if (data.count >= data.limit) {
        dailyEl.style.color = '#ff3b5c';
      }
    }
  });

  // Add handle
  addHandleBtn.addEventListener('click', addHandle);
  handleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addHandle();
  });

  function addHandle() {
    let handle = handleInput.value.trim();
    if (!handle) return;
    if (!handle.startsWith('@')) handle = '@' + handle;
    handle = handle.toLowerCase();

    if (!ignoredHandles.includes(handle)) {
      ignoredHandles.push(handle);
      renderHandles();
    }
    handleInput.value = '';
  }

  function removeHandle(handle) {
    ignoredHandles = ignoredHandles.filter(h => h !== handle);
    renderHandles();
  }

  function renderHandles() {
    handleList.innerHTML = ignoredHandles.map(h =>
      `<span class="handle-chip">${h}<span class="remove-handle" data-handle="${h}">✕</span></span>`
    ).join('');

    handleList.querySelectorAll('.remove-handle').forEach(el => {
      el.addEventListener('click', () => removeHandle(el.dataset.handle));
    });
  }

  // Save
  saveBtn.addEventListener('click', () => {
    const settings = {
      apiKey: apiKeyInput.value.trim(),
      autoScan: autoScanToggle.checked,
      paused: pauseScanToggle.checked,
      showSidebar: showSidebarToggle.checked,
      ignoredHandles: ignoredHandles
    };

    if (!settings.apiKey) {
      statusEl.textContent = '⚠ API key required';
      statusEl.style.color = '#ff3b5c';
      return;
    }

    chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings }, () => {
      statusEl.textContent = '✓ Settings saved';
      statusEl.style.color = '#00e5a0';

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'SETTINGS_UPDATED',
            settings
          });
        }
      });

      setTimeout(() => { statusEl.textContent = ''; }, 2000);
    });
  });
});
