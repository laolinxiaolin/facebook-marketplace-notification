// FB Marketplace Notifier - Simplified Version
// No duplicate detection, no periodic scanning - just title-change detection

let webhookUrl = null;
let lastTitle = document.title;
let lastScanTime = 0;
const SCAN_COOLDOWN = 5000; // 5 seconds

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

function scanForUnread() {
  if (!webhookUrl) return;
  
  document.querySelectorAll('[role="gridcell"]').forEach(conv => {
    const textContent = conv.textContent || '';
    
    // Skip system messages
    if (textContent.toLowerCase().includes('rate each other') ||
        textContent.toLowerCase().includes('you can now rate') ||
        textContent.toLowerCase().includes('marked as sold') ||
        textContent.toLowerCase().includes('group photo') ||
        textContent.toLowerCase().includes('message sent')) {
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
      console.log('[FB Marketplace Notifier] Found unread message, sending webhook');
      
      // Send to background script
      chrome.runtime.sendMessage({
        action: 'sendWebhook',
        data: {
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
