// FB Marketplace Notifier - Background Script
// Receives messages from content script and sends webhooks

const WEBHOOK_LOG_KEY = 'fb_notifier_webhook_log';
const MAX_LOG_ENTRIES = 50;

chrome.runtime.onInstalled.addListener(() => {
  console.log('[FB Notifier] Extension installed');
});

// Handle webhook sending from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'sendWebhook') {
    chrome.storage.sync.get(['webhookUrl', 'notificationType', 'enabled'], (result) => {
      if (result.enabled === false || !result.webhookUrl) {
        console.log('[FB Notifier] Disabled or no webhook URL');
        sendResponse({ success: false, error: 'Disabled' });
        return;
      }

      const webhookUrl = result.webhookUrl;
      const type = result.notificationType || 'openclaw';
      const { sender, message, url } = request.data;

      // Build payload based on type
      let payload;
      
      if (webhookUrl.includes('discord.com') || type === 'discord') {
        payload = {
          content: `**New Message from ${sender || 'Unknown'}**\n${message || 'New message'}\n\n${url}`
        };
      } else if (webhookUrl.includes('/hooks/agent') || type === 'openclaw') {
        payload = {
          message: `**New Facebook Marketplace Message**\n\n**From:** ${sender || 'Unknown'}\n**Message:** ${message || 'New message'}\n\n${url}`,
          name: 'Marketplace-Alert'
        };
      } else {
        payload = {
          sender: sender || 'Unknown',
          message: message || 'New message',
          url,
          timestamp: new Date().toISOString()
        };
      }

      // Build headers - add Authorization for OpenClaw
      const headers = { 'Content-Type': 'application/json' };
      if (webhookUrl.includes('/hooks/agent') || type === 'openclaw') {
        headers['Authorization'] = 'Bearer 37621369dd8e1a85db6b3e9827b8081bb1bc4c3f27b4026e';
      }

      // Log the webhook
      const logEntry = {
        timestamp: new Date().toISOString(),
        sender: sender,
        message: message,
        url: url,
        payload: payload
      };
      
      console.log('[FB Notifier BG] ===== WEBHOOK =====');
      console.log('[FB Notifier BG] Time:', logEntry.timestamp);
      console.log('[FB Notifier BG] Target URL:', webhookUrl);
      console.log('[FB Notifier BG] From:', sender);
      console.log('[FB Notifier BG] Message:', message);
      console.log('[FB Notifier BG] Source URL:', url);
      console.log('[FB Notifier BG] Payload:', JSON.stringify(payload, null, 2));
      console.log('[FB Notifier BG] Headers:', JSON.stringify(headers, null, 2));
      console.log('[FB Notifier BG] ===================');
      
      // Store in local log
      saveToLog(logEntry);
      
      fetch(webhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      }).then(res => {
        console.log('[FB Notifier BG] Response:', res.status);
        sendResponse({ success: res.ok });
      }).catch(err => {
        console.error('[FB Notifier BG] Error:', err.message);
        sendResponse({ success: false, error: err.message });
      });
    });

    return true;
  }
  
  // Handle request to get log
  if (request.action === 'getLog') {
    chrome.storage.local.get([WEBHOOK_LOG_KEY], (result) => {
      sendResponse({ log: result[WEBHOOK_LOG_KEY] || [] });
    });
    return true;
  }
  
  // Handle request to clear log
  if (request.action === 'clearLog') {
    chrome.storage.local.set({ [WEBHOOK_LOG_KEY]: [] });
    sendResponse({ success: true });
    return true;
  }
});

function saveToLog(entry) {
  chrome.storage.local.get([WEBHOOK_LOG_KEY], (result) => {
    let log = result[WEBHOOK_LOG_KEY] || [];
    log.unshift(entry); // Add to beginning
    if (log.length > MAX_LOG_ENTRIES) {
      log = log.slice(0, MAX_LOG_ENTRIES);
    }
    chrome.storage.local.set({ [WEBHOOK_LOG_KEY]: log });
  });
}
