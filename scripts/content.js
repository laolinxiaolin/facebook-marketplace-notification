let webhookUrl = null;
let notifiedMessages = new Set();
let lastTitle = document.title;
let lastScanTime = 0;
const SCAN_COOLDOWN = 10000; // Only scan once every 10 seconds

chrome.storage.sync.get(['webhookUrl', 'enabled'], (result) => {
  if (result.enabled !== false && result.webhookUrl) {
    webhookUrl = result.webhookUrl;
    init();
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.webhookUrl) webhookUrl = changes.webhookUrl.newValue;
  if (changes.enabled) webhookUrl = changes.enabled.newValue !== false ? webhookUrl : null;
});

function init() {
  console.log('[FB Marketplace Notifier] Started');
  
  const titleEl = document.querySelector('title');
  if (titleEl) {
    new MutationObserver(() => onTitleChange()).observe(titleEl, { childList: true, characterData: true, subtree: true });
  }
  
  // Removed automatic interval scanning - only scan on actual title changes
}

function onTitleChange() {
  if (document.title === lastTitle) return;
  lastTitle = document.title;
  
  console.log('[FB Marketplace Notifier] Title:', document.title);
  
  // Only trigger if title shows actual new message indicator
  if (/^\(\d+\)/.test(document.title)) {
    console.log('[FB Marketplace Notifier] New message detected');
    const now = Date.now();
    if (now - lastScanTime > SCAN_COOLDOWN) {
      lastScanTime = now;
      setTimeout(scanForUnread, 500);
    }
  }
}

function scanForUnread() {
  if (!webhookUrl) return;
  
  document.querySelectorAll('[role="gridcell"]').forEach(conv => {
    // Create more stable ID using multiple factors
    const links = conv.querySelectorAll('a[href*="/t/"]');
    const link = links[0]?.href || '';
    const textContent = conv.textContent || '';
    
    // Skip system messages (rate prompts, sold notifications, etc.)
    if (textContent.toLowerCase().includes('rate each other') ||
        textContent.toLowerCase().includes('you can now rate') ||
        textContent.toLowerCase().includes('marked as sold') ||
        textContent.toLowerCase().includes('group photo')) {
      return;
    }
    
    // Use link + first 100 chars as more stable ID
    const id = link + '::' + textContent.slice(0, 100).replace(/\d+ minutes? ago/gi, '');
    
    if (notifiedMessages.has(id)) return;
    
    const isUnread = (() => {
      const text = textContent.toLowerCase();
      if (text.includes('unread')) return true;
      for (const span of conv.querySelectorAll('span[dir="auto"]')) {
        try { if (parseInt(getComputedStyle(span).fontWeight) >= 600) return true; } catch (e) {}
      }
      return false;
    })();
    
    if (isUnread) {
      console.log('[FB Marketplace Notifier] Found unread:', id);
      notifiedMessages.add(id);
      sendNotification(conv);
    }
  });
}

function sendNotification(conv) {
  const text = conv.textContent || '';
  const parts = text.split('·').map(p => p.trim());
  const sender = parts[0]?.split(':')[0]?.trim() || 'Unknown';
  const message = parts[1] || text.slice(0, 100);
  
  // Send to background script (avoids CORS restrictions)
  chrome.runtime.sendMessage({
    action: 'sendWebhook',
    data: {
      sender,
      message,
      url: window.location.href,
      timestamp: new Date().toISOString()
    }
  });
}

chrome.runtime.onMessage.addListener((req) => {
  if (req.action === 'checkNow') {
    chrome.storage.sync.get(['webhookUrl', 'enabled'], (res) => {
      webhookUrl = res.webhookUrl;
      if (res.enabled !== false && webhookUrl) {
        notifiedMessages.clear();
        scanForUnread();
      }
    });
  }
});

console.log('[FB Marketplace Notifier] Loaded');
