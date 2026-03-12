// FB Marketplace Notifier - Fixed Version
// Proper parsing and deduplication

let webhookUrl = null;
let lastTitle = document.title;
let lastScanTime = 0;
const SCAN_COOLDOWN = 5000; // 5 seconds
const sentMessages = new Set(); // Track sent message IDs

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
  console.log('[FB Marketplace Notifier] Started - title-change detection only');
  
  const titleEl = document.querySelector('title');
  if (titleEl) {
    new MutationObserver(() => onTitleChange()).observe(titleEl, { 
        childList: true, 
        characterData: true, 
        subtree: true 
      });
  }
  
  // Clear sent messages cache every 5 minutes
  setInterval(() => sentMessages.clear(), 5 * 60 * 1000);
}

function onTitleChange() {
  if (document.title === lastTitle) return;
  lastTitle = document.title;
  
  console.log('[FB Marketplace Notifier] Title:', document.title);
  
  const hasNewMessage = /^\(\d+\)/.test(document.title) || 
                         document.title.toLowerCase().includes('new message');
  
  if (hasNewMessage) {
    console.log('[FB Marketplace Notifier] New message detected');
    const now = Date.now();
    if (now - lastScanTime > SCAN_COOLDOWN) {
      lastScanTime = now;
      setTimeout(scanForUnread, 500);
    }
  }
}

function parseMessage(textContent) {
  // Format: "Name · Product Unread message: Name: Message snippet..."
  // Or: "Name · Product You: ... Seen by..."
  
  // Extract sender name (before first ·)
  const nameMatch = textContent.match(/^([^·]+)·/);
  const sender = nameMatch ? nameMatch[1].trim() : 'Unknown';
  
  // Extract message snippet
  let message = '';
  
  // Try "Unread message: Sender: message"
  const unreadMatch = textContent.match(/Unread message:\s*([^:]+):\s*(.+?)(?:\s*\d|$)/i);
  if (unreadMatch) {
    message = unreadMatch[2].trim();
  } else {
    // Try to find text after last "·" before timestamp
    const parts = textContent.split('·');
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i].trim();
      if (part && !part.match(/^\d+[mhd]$/) && !part.includes('Seen by')) {
        message = part;
        break;
      }
    }
  }
  
  return { sender, message: message || 'New message' };
}

function generateMessageId(sender, message) {
  // Create a simple ID based on sender + first 50 chars of message
  return `${sender}:${message.substring(0, 50)}`;
}

function scanForUnread() {
  if (!webhookUrl) return;
  
  document.querySelectorAll('[role="gridcell"]').forEach(conv => {
    const textContent = conv.textContent || '';
    
    // Skip system messages
    if (textContent.toLowerCase().includes('rate each other') ||
        textContent.toLowerCase().includes('you can now rate') ||
        textContent.toLowerCase().includes('marked as sold') ||
        textContent.toLowerCase().includes('group photo') ||
        textContent.toLowerCase().includes('message sent') ||
        textContent.toLowerCase().includes('removed the item')) {
      return;
    }
    
    // Skip if we already responded (contains "You:")
    if (textContent.includes('You:') || textContent.includes('You sent')) {
      return;
    }
    
    const isUnread = (() => {
      const text = textContent.toLowerCase();
      if (text.includes('unread')) return true;
      for (const span of conv.querySelectorAll('span[dir="auto"]')) {
        try { 
          if (parseInt(getComputedStyle(span).fontWeight) >= 600) return true; 
        } catch (e) {}
      }
      return false;
    })();
    
    if (isUnread) {
      const { sender, message } = parseMessage(textContent);
      const messageId = generateMessageId(sender, message);
      
      // Skip if already sent
      if (sentMessages.has(messageId)) {
        console.log('[FB Marketplace Notifier] Skipping duplicate:', messageId);
        return;
      }
      
      sentMessages.add(messageId);
      console.log('[FB Marketplace Notifier] Found unread from:', sender, '-', message.substring(0, 30));
      
      // Send to background script
      chrome.runtime.sendMessage({
        action: 'sendWebhook',
        data: {
          sender: sender,
          message: message,
          text: textContent,
          url: window.location.href,
          timestamp: new Date().toISOString()
        }
      });
    }
  });
}

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === 'checkNow') {
    scanForUnread();
  }
});
