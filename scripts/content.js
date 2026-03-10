let webhookUrl = null;
let notifiedMessages = new Set();
let lastTitle = document.title;
let lastScanTime = 0;
let scanInProgress = false;
const SCAN_COOLDOWN = 10000; // Only scan once every 10 seconds

// Load previously notified messages from localStorage
try {
  const saved = localStorage.getItem('fb-notified-messages');
  if (saved) {
    notifiedMessages = new Set(JSON.parse(saved));
    console.log('[FB Marketplace Notifier] Loaded', notifiedMessages.size, 'previously notified messages');
  }
} catch (e) {
  console.error('[FB Marketplace Notifier] Error loading saved messages:', e);
}

// Save notified messages periodically
setInterval(() => {
  try {
    localStorage.setItem('fb-notified-messages', JSON.stringify([...notifiedMessages]));
  } catch (e) {
    // Clear old messages if storage is full
    const arr = [...notifiedMessages];
    if (arr.length > 100) {
      notifiedMessages = new Set(arr.slice(-50));
      localStorage.setItem('fb-notified-messages', JSON.stringify([...notifiedMessages]));
    }
  }
}, 60000); // Save every minute

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
  
  // Only use title change detection, remove periodic scanning to avoid duplicates
  console.log('[FB Marketplace Notifier] Using title-change detection only');
}

function onTitleChange() {
  if (document.title === lastTitle) return;
  lastTitle = document.title;
  
  console.log('[FB Marketplace Notifier] Title:', document.title);
  
  // Trigger on (N) prefix OR "new message" text
  const hasNewMessage = /^\(\d+\)/.test(document.title) || 
                         document.title.toLowerCase().includes('new message');
  
  if (hasNewMessage) {
    console.log('[FB Marketplace Notifier] New message detected');
    const now = Date.now();
    if (now - lastScanTime > SCAN_COOLDOWN && !scanInProgress) {
      lastScanTime = now;
      scanInProgress = true;
      setTimeout(() => {
        scanForUnread();
        scanInProgress = false;
      }, 500);
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
        textContent.toLowerCase().includes('group photo') ||
        textContent.toLowerCase().includes('message sent')) {
      return;
    }
    
    // Extract message content for better uniqueness
    const messageMatch = textContent.match(/Unread message:([^:]+): (.+)/i);
    const messageContent = messageMatch ? messageMatch[2] : textContent.slice(0, 100);
    
    // Use link + message content hash as ID (more unique)
    const id = link + '::' + messageContent.replace(/\d+ (minutes?|hours?|days?) ago/gi, '').trim();
    
    if (notifiedMessages.has(id)) {
      console.log('[FB Marketplace Notifier] Already notified:', id.slice(0, 80));
      return;
    }
    
    const isUnread = (() => {
      const text = textContent.toLowerCase();
      if (text.includes('unread')) return true;
      for (const span of conv.querySelectorAll('span[dir="auto"]')) {
        try { if (parseInt(getComputedStyle(span).fontWeight) >= 600) return true; } catch (e) {}
      }
      return false;
    })();
    
    if (isUnread) {
      console.log('[FB Marketplace Notifier] Found unread:', id.slice(0, 80));
      notifiedMessages.add(id);
      sendNotification(conv);
      
      // Save immediately after adding new message
      try {
        localStorage.setItem('fb-notified-messages', JSON.stringify([...notifiedMessages]));
      } catch (e) {}
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
