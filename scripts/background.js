// FB Marketplace Notifier - Background Script
// Handles webhook sending with cooldown and deduplication

// Cooldown to prevent duplicate notifications (10 seconds)
const COOLDOWN_MS = 10000;
let lastWebhookTime = 0;

function checkCooldown() {
  const now = Date.now();
  if (now - lastWebhookTime < COOLDOWN_MS) {
    console.log('[FB Notifier] Cooldown active - skipping duplicate');
    return false;
  }
  lastWebhookTime = now;
  return true;
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[FB Notifier] Extension installed');
});

// Handle webhook sending from content script (avoids CORS restrictions)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'sendWebhook') {
    // Check cooldown to prevent duplicate notifications
    if (!checkCooldown()) {
      sendResponse({ success: true, skipped: 'cooldown' });
      return true;
    }

    chrome.storage.sync.get(['webhookUrl', 'notificationType', 'enabled'], (result) => {
      if (result.enabled === false || !result.webhookUrl) {
        console.log('[FB Notifier] Disabled or no webhook URL');
        sendResponse({ success: false, error: 'Disabled or no webhook' });
        return;
      }

      const webhookUrl = result.webhookUrl;
      const type = result.notificationType || 'openclaw';
      const { sender: msgSender, message, msgText, url, timestamp } = request.data;

      // Validate required fields
      if (!msgSender || !msgText) {
        console.error('[FB Notifier] Missing sender or message:', request.data);
        sendResponse({ success: false, error: 'Missing sender or message' });
        return;
      }

      // Extract token from URL if present, then use header auth
      let finalUrl = webhookUrl;
      let headers = { 'Content-Type': 'application/json' };
      
      try {
        const urlObj = new URL(webhookUrl);
        const tokenParam = urlObj.searchParams.get('token');
        if (tokenParam) {
          // Remove token from URL and add to header
          urlObj.searchParams.delete('token');
          finalUrl = urlObj.toString();
          headers['Authorization'] = `Bearer ${tokenParam}`;
        }
      } catch (e) {
        console.error('[FB Notifier] Invalid URL:', e);
      }

      let payload;

      if (webhookUrl.includes('discord.com') || type === 'discord') {
        // Discord format - clean message
        const cleanSender = msgSender || 'Unknown';
        const cleanMessage = message || msgText || 'New message';
        payload = {
          content: `**New Message from ${cleanSender}**\n${cleanMessage}\n\n${url}`
        };
      } else if (webhookUrl.includes('slack.com') || type === 'slack') {
        payload = {
          text: `New Message from ${msgSender}`,
          attachments: [{ text: message || msgText }]
        };
      } else if (webhookUrl.includes('/hooks/agent') || type === 'openclaw') {
        // OpenClaw webhook format
        payload = {
          message: `**New Facebook Marketplace Message**\n\n**From:** ${msgSender}\n**Message:** ${message || msgText}\n\n${url}`,
          name: 'Marketplace-Alert'
        };
      } else {
        payload = {
          sender: msgSender,
          message: message || msgText,
          timestamp,
          source: 'facebook_messenger',
          url
        };
      }

      fetch(finalUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      }).then(res => {
        console.log('[FB Notifier] Sent:', res.status);
        sendResponse({ success: res.ok });
      }).catch(err => {
        console.error('[FB Notifier] Error:', err.message);
        sendResponse({ success: false, error: err.message });
      });
    });

    return true; // Keep message channel open for async response
  }
});
