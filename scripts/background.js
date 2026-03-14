// FB Marketplace Notifier - Background Script
// Simple webhook sender with cooldown

const COOLDOWN_MS = 10000; // 10 seconds
let lastWebhookTime = 0;

chrome.runtime.onInstalled.addListener(() => {
  console.log('[FB Notifier] Extension installed');
});

// Handle webhook sending from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'sendWebhook') {
    // Check cooldown
    const now = Date.now();
    if (now - lastWebhookTime < COOLDOWN_MS) {
      console.log('[FB Notifier] Cooldown active - skipping');
      sendResponse({ success: true, skipped: 'cooldown' });
      return true;
    }
    lastWebhookTime = now;

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

      fetch(webhookUrl, {
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

    return true;
  }
});
