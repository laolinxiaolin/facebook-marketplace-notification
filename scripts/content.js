// FB Marketplace Notifier - With Cooldown
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
  if (changes.enabled && changes.enabled.newValue === true) {
    chrome.storage.sync.get(['webhookUrl'], (result) => {
      webhookUrl = result.webhookUrl;
    });
  }
});

function init() {
  console.log('[FB Marketplace Notifier] Started - Toast Monitor Mode (5s cooldown)');
  
  // Watch for Facebook toast notifications
  watchForToasts();
  
  // Also intercept browser notifications as backup
  interceptBrowserNotifications();
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
  if (text.includes('messaged you') || 
      text.includes('sent you a message') ||
      text.includes('new message') ||
      /^[A-Z][a-z]+\s/.test(text)) {
    processPossibleMessageNotification(element);
  }
}

function processToast(toast) {
  const text = toast.textContent || '';
  console.log('[FB Notifier] Toast detected:', text.substring(0, 100));
  
  // Skip non-message toasts
  const skipPatterns = [
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
    'memory'
  ];
  
  const lowerText = text.toLowerCase();
  for (const pattern of skipPatterns) {
    if (lowerText.includes(pattern)) {
      console.log('[FB Notifier] Skipping non-message toast:', pattern);
      return;
    }
  }
  
  // Look for message-related patterns
  if (lowerText.includes('message') || 
      lowerText.includes('messaged') ||
      lowerText.includes('replied')) {
    extractAndSendFromToast(toast, text);
  }
}

function processPossibleMessageNotification(element) {
  if (!webhookUrl) return;
  
  const text = element.textContent || '';
  
  let sender = 'Unknown';
  let message = 'New message';
  
  const nameMessageMatch = text.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)[:\s]+(.+?)(?:\s*·|\s*\d+|\s*$)/);
  if (nameMessageMatch) {
    sender = nameMessageMatch[1];
    message = nameMessageMatch[2] || 'New message';
  } else {
    const sentMatch = text.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+sent\s+you\s+a\s+message/i);
    if (sentMatch) {
      sender = sentMatch[1];
    }
  }
  
  sendMessage(sender, message);
}

function extractAndSendFromToast(toast, text) {
  const cleanText = text.replace(/\s+/g, ' ').trim();
  
  let sender = 'Unknown';
  let message = 'New message';
  
  // Pattern 1: "Name: Message content"
  const colonMatch = cleanText.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*:\s*(.+?)(?:\s+·|\s+\d|\s*$)/);
  if (colonMatch) {
    sender = colonMatch[1];
    message = colonMatch[2];
  }
  
  // Pattern 2: "Name sent you a message"
  if (sender === 'Unknown') {
    const sentMatch = cleanText.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+sent\s+you\s+a\s+message/i);
    if (sentMatch) {
      sender = sentMatch[1];
    }
  }
  
  // Pattern 3: "Name messaged you"
  if (sender === 'Unknown') {
    const msgMatch = cleanText.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+messaged\s+you/i);
    if (msgMatch) {
      sender = msgMatch[1];
    }
  }
  
  sendMessage(sender, message);
}

function interceptBrowserNotifications() {
  const OriginalNotification = window.Notification;
  
  window.Notification = function(title, options = {}) {
    console.log('[FB Notifier] Browser notification intercepted:', title);
    
    const notification = new OriginalNotification(title, options);
    
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
