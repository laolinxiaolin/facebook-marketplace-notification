// FB Marketplace Notifier - Ultra-Safe Version
// Maximum deduplication to prevent any duplicate messages

let webhookUrl = null;
let lastTitle = document.title;
let lastScanTime = 0;
const SCAN_COOLDOWN = 5000; // 5 seconds between scans
const MESSAGE_EXPIRY = 10 * 60 * 1000; // 10 minutes
const sentMessages = new Map(); // messageId -> timestamp

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
    new MutationObserver(() => onTitleChange()).observe(titleEl, { 
      childList: true, 
      characterData: true, 
      subtree: true 
    });
  }
  
  // Clean up old sent messages every minute
  setInterval(() => {
    const now = Date.now();
    for (const [id, time] of sentMessages) {
      if (now - time > MESSAGE_EXPIRY) {
        sentMessages.delete(id);
      }
    }
  }, 60 * 1000);
}

function onTitleChange() {
  if (document.title === lastTitle) return;
  lastTitle = document.title;
  
  const hasNewMessage = /^\(\d+\)/.test(document.title) || 
                         document.title.toLowerCase().includes('new message');
  
  if (hasNewMessage) {
    const now = Date.now();
    if (now - lastScanTime > SCAN_COOLDOWN) {
      lastScanTime = now;
      setTimeout(scanForUnread, 500);
    }
  }
}

function parseMessage(textContent) {
  // Extract sender name (before first ·)
  const nameMatch = textContent.match(/^([^·]+)·/);
  const sender = nameMatch ? nameMatch[1].trim() : 'Unknown';
  
  // Extract message - try "Unread message:" pattern
  let message = '';
  const unreadMatch = textContent.match(/Unread message:\s*([^:]+):\s*(.+?)(?:\s*\d+[mhd]|\s*$)/i);
  if (unreadMatch) {
    message = unreadMatch[2].trim();
  } else {
    // Fallback: get last meaningful part
    const parts = textContent.split('·').map(p => p.trim()).filter(p => p);
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i];
      if (part && !part.match(/^\d+[mhd]?$/) && !part.includes('Seen') && !part.includes('You:')) {
        message = part;
        break;
      }
    }
  }
  
  return { sender, message: message || 'New message' };
}

function scanForUnread() {
  if (!webhookUrl) return;
  
  const now = Date.now();
  
  document.querySelectorAll('[role="gridcell"]').forEach(conv => {
    const textContent = conv.textContent || '';
    
    // Skip system messages and already-responded conversations
    const lower = textContent.toLowerCase();
    if (lower.includes('rate each other') ||
        lower.includes('you can now rate') ||
        lower.includes('marked as sold') ||
        lower.includes('group photo') ||
        lower.includes('message sent') ||
        lower.includes('removed the item') ||
        textContent.includes('You:') ||
        textContent.includes('You sent')) {
      return;
    }
    
    // Check for unread indicator
    const isUnread = lower.includes('unread') || (() => {
      for (const span of conv.querySelectorAll('span[dir="auto"]')) {
        try {
          if (parseInt(getComputedStyle(span).fontWeight) >= 600) return true;
        } catch (e) {}
      }
      return false;
    })();
    
    if (isUnread) {
      const { sender, message } = parseMessage(textContent);
      
      // Create unique ID from sender + first 30 chars of message + conversation element position
      const msgId = `${sender}:${message.substring(0, 30)}`;
      
      // Skip if already sent (within expiry window)
      if (sentMessages.has(msgId)) {
        console.log('[FB Notifier] Skipping duplicate:', msgId);
        return;
      }
      
      // Mark as sent
      sentMessages.set(msgId, now);
      console.log('[FB Notifier] Sending webhook for:', sender);
      
      // Send to background script
      chrome.runtime.sendMessage({
        action: 'sendWebhook',
        data: {
          sender: sender,
          message: message,
          url: window.location.href,
          timestamp: new Date().toISOString()
        }
      });
    }
  });
}
