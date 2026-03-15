// FB Marketplace Notifier - With Cooldown and Self-Reply Filter
// Watches for Facebook's in-page notification popups (toasts)

let webhookUrl = null;
let lastSendTime = 0;
const COOLDOWN_MS = 5000; // 5 seconds between sends

// Load settings
chrome.storage.sync.get(['webhookUrl', 'enabled'], (result) => {
  if (result.enabled !== false && result.webhookUrl) {
    webhookUrl = result.webhookUrl;
    init();
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.webhookUrl) webhookUrl = changes.webhookUrl.newValue;
  if (changes.enabled && changes.enabled.newValue === false) webhookUrl = null;
  if (changes.enabled && changes.enabled.newValue === True) {
    chrome.storage.sync.get(['webhookUrl'], (result) => {
      webhookUrl = result.webhookUrl;
    });
  }
});

function init() {
  console.log('[FB Marketplace Notifier] Started - Title + Toast Monitor Mode');
  
  // Watch for Facebook toast notifications (legacy)
  watchForToasts();
  
  // Watch for page title changes (primary detection method now)
  watchTitleChanges();
  
  // Also intercept browser notifications as backup
  interceptBrowserNotifications();
}

// Track last title state to detect changes
let lastTitleCount = 0;
let lastTitle = '';

function watchTitleChanges() {
  // Check title periodically for changes
  setInterval(() => {
    const title = document.title;
    if (title === lastTitle) return;
    lastTitle = title;
    
    // Extract notification count from title like "(3) Messenger" or "(1) Facebook"
    const match = title.match(/^\((\d+)\)/);
    if (match) {
      const count = parseInt(match[1], 10);
      if (count > lastTitleCount) {
        console.log('[FB Notifier] Title change detected:', title, '- new messages:', count - lastTitleCount);
        // Notification count increased - new message(s)
        onNewMessageDetected();
      }
      lastTitleCount = count;
    } else {
      // No count in title - reset to 0
      if (lastTitleCount > 0) {
        console.log('[FB Notifier] Title cleared - messages read');
      }
      lastTitleCount = 0;
    }
  }, 1000); // Check every second
  
  console.log('[FB Notifier] Title watcher started');
}

function onNewMessageDetected() {
  if (!webhookUrl) return;
  
  console.log('[FB Notifier] New message detected via title change');
  
  // Try to find unread message indicators in the page
  // Look for elements with aria-label indicating unread messages
  const unreadIndicators = document.querySelectorAll('[aria-label*="unread"], [aria-label*="Unread"], [data-testid*="unread"]');
  
  if (unreadIndicators.length > 0) {
    console.log('[FB Notifier] Found unread indicators:', unreadIndicators.length);
  }
  
  // Look for the messenger icon badge or notification dots
  const badge = document.querySelector('[aria-label*="Messenger"][aria-label*="notification"], [aria-label*="message request"]');
  if (badge) {
    const badgeText = badge.getAttribute('aria-label') || '';
    console.log('[FB Notifier] Badge found:', badgeText);
  }
  
  // Look for active conversation with unread indicator
  const activeChats = document.querySelectorAll('[role="listitem"][aria-label*="unread"], [role="row"][aria-label*="unread"]');
  for (const chat of activeChats) {
    const chatText = chat.textContent || '';
    console.log('[FB Notifier] Unread chat:', chatText.substring(0, 100));
  }
  
  // Send a generic notification - user should check Facebook
  sendMessage('New Message', 'You have a new message on Facebook. Check your inbox.');
}

function watchForToasts() {
  // Watch the entire body for new toast elements
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          checkForToastNotification(node);
        }
      }
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  console.log('[FB Notifier] Toast observer installed');
}

function checkForToastNotification(element) {
  if (!webhookUrl) return;
  
  // Facebook toast patterns to check
  const toastSelectors = [
    '[role="alert"]',
    '[aria-live="polite"]',
    '[data-visualcompletion="ignore-dynamic"]',
    '[class*="toast"]',
    '[class*="notification"]',
    '[class*="snackbar"]'
  ];
  
  // Check if element is a toast
  let isToast = false;
  for (const selector of toastSelectors) {
    if (element.matches && element.matches(selector)) {
      isToast = true;
      break;
    }
    if (element.querySelector && element.querySelector(selector)) {
      const toasts = element.querySelectorAll(selector);
      toasts.forEach(toast => processToast(toast));
      return;
    }
  }
  
  if (isToast) {
    processToast(element);
  }
  
  // Also check if this is a message notification popup
  const text = element.textContent || '';
  if (text.includes('sent you a message') || 
      text.includes('messaged you')) {
    processPossibleMessageNotification(element);
  }
}

function processToast(toast) {
  const text = toast.textContent || '';
  const innerText = toast.innerText || '';
  const ariaLabel = toast.getAttribute('aria-label') || '';
  
  // Safely get className (may be DOMTokenList or SVGAnimatedString)
  let className = '';
  try {
    className = (toast.className && typeof toast.className === 'string') 
      ? toast.className 
      : (toast.className && toast.className.baseVal) 
        ? toast.className.baseVal 
        : String(toast.className || '');
  } catch (e) {
    className = 'error-getting-class';
  }
  
  // Skip if all text sources are empty - not a real notification
  if (!text && !innerText && !ariaLabel) {
    return;
  }
  
  // Log all possible text sources for debugging
  console.log('[FB Notifier] Toast detected:', {
    textContent: text.substring(0, 100),
    innerText: innerText.substring(0, 100),
    ariaLabel: ariaLabel.substring(0, 100),
    tagName: toast.tagName,
    className: className.substring(0, 50)
  });
  
  // NEW: Handle SVG elements with aria-label (Facebook's notification style)
  // These contain sender names but we need to find the message in parent/child elements
  // IMPORTANT: Skip SVGs that are just chat list avatars (very common)
  if (toast.tagName === 'SVG' && ariaLabel) {
    // Skip if this SVG is in the chat list sidebar (not a real notification)
    const chatListContainer = toast.closest('[role="list"], [role="grid"], [aria-label*="Chats"], [aria-label*="Conversations"]');
    if (chatListContainer) {
      // This is just the chat list, not a new notification
      return;
    }
    
    console.log('[FB Notifier] SVG notification detected, sender:', ariaLabel);
    
    // Walk up the DOM to find notification container with more text
    let parent = toast.parentElement;
    let attempts = 0;
    while (parent && attempts < 5) {
      const parentText = parent.textContent || parent.innerText || '';
      console.log('[FB Notifier] Parent level', attempts, 'text:', parentText.substring(0, 200));
      
      if (parentText.length > ariaLabel.length) {
        // Found more context - extract message info
        extractAndSendFromToast(parentText);
        return;
      }
      parent = parent.parentElement;
      attempts++;
    }
    
    // If no parent text found, just send the sender name as notification
    sendMessage(ariaLabel, 'New message (check Facebook for details)');
    return;
  }
  
  // Skip non-message toasts and our own messages
  // Note: Only skip patterns that clearly indicate OUR outgoing messages
  const skipPatterns = [
    'you sent',
    'you replied',
    'your reply',
    'sent you a friend request',
    'liked your',
    'commented on',
    'shared a',
    'is live',
    'updated their',
    'added a new',
    'friend suggestion',
    'people you may know',
    'suggested for you',
    'on this day',
    'memory',
    'you approved a login'
  ];
  
  const lowerText = text.toLowerCase();
  for (const pattern of skipPatterns) {
    if (lowerText.includes(pattern)) {
      console.log('[FB Notifier] Skipping:', pattern);
      return;
    }
  }
  
  // Only process incoming message toasts
  if (lowerText.includes('sent you a message') || 
      lowerText.includes('messaged you') ||
      lowerText.includes('sent,') ||
      lowerText.includes('new message')) {
    extractAndSendFromToast(text);
  }
  
  // Also check innerText and ariaLabel
  const lowerInnerText = innerText.toLowerCase();
  const lowerAria = ariaLabel.toLowerCase();
  
  if (lowerInnerText.includes('sent you a message') || 
      lowerInnerText.includes('messaged you') ||
      lowerAria.includes('sent you a message') ||
      lowerAria.includes('messaged you')) {
    extractAndSendFromToast(innerText || ariaLabel);
  }
}

function processPossibleMessageNotification(element) {
  if (!webhookUrl) return;
  const text = element.textContent || '';
  
  // Skip our own messages
  if (text.toLowerCase().includes('you sent')) {
    return;
  }
  
  extractAndSendFromToast(text);
}

function extractAndSendFromToast(text) {
  // Clean up text - remove "Unread" prefix and extra whitespace
  let cleanText = text.replace(/^Unread\s*/i, '').replace(/\s+/g, ' ').trim();
  
  // Skip if this is our own message
  if (cleanText.toLowerCase().startsWith('you sent')) {
    console.log('[FB Notifier] Skipping own message');
    return;
  }
  
  let sender = 'Unknown';
  let message = 'New message';
  
  // Pattern 1: "Name sent you a message about your Marketplace listing: Product Name"
  const marketplaceMatch = cleanText.match(/^([A-Z][a-zA-Z\s]+?)\s+sent you a message about your Marketplace listing:\s*(.+?)(?:\s+\d+[mhd]|\s*$)/i);
  if (marketplaceMatch) {
    sender = marketplaceMatch[1].trim();
    message = `Marketplace inquiry: ${marketplaceMatch[2].trim()}`;
    sendMessage(sender, message);
    return;
  }
  
  // Pattern 2: "Name sent you a message"
  const sentMatch = cleanText.match(/^([A-Z][a-zA-Z\s]+?)\s+sent\s+you\s+a\s+message/i);
  if (sentMatch) {
    sender = sentMatch[1].trim();
    sendMessage(sender, message);
    return;
  }
  
  // Pattern 3: "Name messaged you"
  const msgMatch = cleanText.match(/^([A-Z][a-zA-Z\s]+?)\s+messaged\s+you/i);
  if (msgMatch) {
    sender = msgMatch[1].trim();
    sendMessage(sender, message);
    return;
  }
  
  // Pattern 4: "Name: Message content"
  const colonMatch = cleanText.match(/^([A-Z][a-zA-Z\s]+?)\s*:\s*(.+?)(?:\s+·|\s+\d|\s*$)/);
  if (colonMatch) {
    sender = colonMatch[1].trim();
    message = colonMatch[2].trim();
    sendMessage(sender, message);
    return;
  }
  
  // If we got here but the text mentions message, it's probably valid - send with Unknown
  if (cleanText.toLowerCase().includes('message')) {
    sendMessage('Unknown', cleanText.substring(0, 100));
  }
}

function interceptBrowserNotifications() {
  const OriginalNotification = window.Notification;
  
  window.Notification = function(title, options = {}) {
    console.log('[FB Notifier] Browser notification intercepted:', title);
    
    const notification = new OriginalNotification(title, options);
    
    // Skip our own notifications
    if (title && title.toLowerCase().includes('you sent')) {
      return notification;
    }
    
    if (title && options.body) {
      sendMessage(title, options.body);
    }
    
    return notification;
  };
  
  window.Notification.permission = OriginalNotification.permission;
  window.Notification.requestPermission = OriginalNotification.requestPermission.bind(OriginalNotification);
}

function sendMessage(sender, message) {
  if (!webhookUrl) return;
  
  // Check cooldown
  const now = Date.now();
  if (now - lastSendTime < COOLDOWN_MS) {
    console.log('[FB Notifier] Cooldown active - skipping');
    return;
  }
  lastSendTime = now;
  
  console.log('[FB Notifier] Sending webhook:', sender, '-', message.substring(0, 30));
  
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
