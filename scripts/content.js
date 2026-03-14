// FB Marketplace Notifier - Notification Interception Version
// Intercepts browser notifications to capture new messages instantly

let webhookUrl = null;
const sentMessages = new Map(); // messageId -> timestamp
const MESSAGE_EXPIRY = 10 * 60 * 1000; // 10 minutes

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
  console.log('[FB Marketplace Notifier] Started - Notification Interception Mode');
  
  // Intercept Notification API
  interceptNotifications();
  
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

function interceptNotifications() {
  // Save original Notification constructor
  const OriginalNotification = window.Notification;
  
  // Override Notification constructor
  window.Notification = function(title, options = {}) {
    console.log('[FB Notifier] Notification intercepted:', title, options.body);
    
    // Create the actual notification so user still sees it
    const notification = new OriginalNotification(title, options);
    
    // Process the notification for our webhook
    processNotification(title, options);
    
    return notification;
  };
  
  // Copy static properties
  window.Notification.permission = OriginalNotification.permission;
  window.Notification.requestPermission = OriginalNotification.requestPermission.bind(OriginalNotification);
  
  // Also intercept notifications created via Service Worker (for when page is in background)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(registration => {
      // Monkey-patch showNotification if possible
      const originalShowNotification = registration.showNotification;
      registration.showNotification = function(title, options) {
        console.log('[FB Notifier] SW Notification intercepted:', title, options?.body);
        processNotification(title, options || {});
        return originalShowNotification.call(this, title, options);
      };
    }).catch(err => console.log('[FB Notifier] SW interception skipped:', err));
  }
}

function processNotification(title, options) {
  if (!webhookUrl) return;
  
  // Only process Facebook/Messenger related notifications
  const isFacebook = window.location.hostname.includes('facebook.com') ||
                     window.location.hostname.includes('messenger.com') ||
                     (options.icon && options.icon.includes('facebook')) ||
                     (options.tag && options.tag.includes('messenger'));
  
  if (!isFacebook) return;
  
  // Skip non-message notifications
  const skipPatterns = [
    'friend request',
    'suggested for you',
    'people you may know',
    'birthday',
    'event',
    'reminder',
    'liked your',
    'commented on',
    'shared'
  ];
  
  const lowerTitle = (title || '').toLowerCase();
  const lowerBody = (options.body || '').toLowerCase();
  
  for (const pattern of skipPatterns) {
    if (lowerTitle.includes(pattern) || lowerBody.includes(pattern)) {
      console.log('[FB Notifier] Skipping non-message notification:', pattern);
      return;
    }
  }
  
  // Extract sender and message
  // Format is usually: sender name in title, message preview in body
  let sender = title || 'Unknown';
  let message = options.body || 'New message';
  
  // Handle "Name sent you a message" format
  const sentMatch = sender.match(/^(.+?)\s+(?:sent you a message|messaged you)/i);
  if (sentMatch) {
    sender = sentMatch[1];
  }
  
  // Create unique ID to prevent duplicates
  const msgId = `${sender}:${message.substring(0, 50)}`;
  const now = Date.now();
  
  if (sentMessages.has(msgId)) {
    console.log('[FB Notifier] Skipping duplicate:', msgId);
    return;
  }
  
  sentMessages.set(msgId, now);
  console.log('[FB Notifier] Sending webhook for:', sender, '-', message.substring(0, 30));
  
  // Get Messenger URL if possible
  const messengerUrl = options.data?.url || 
                       (options.tag?.includes('messenger') ? 'https://www.facebook.com/messages/t/' : window.location.href);
  
  // Send to background script
  chrome.runtime.sendMessage({
    action: 'sendWebhook',
    data: {
      sender: sender,
      message: message,
      url: messengerUrl,
      timestamp: new Date().toISOString()
    }
  });
}
