let webhookUrl = null;
let notifiedMessages = new Set();
let lastTitle = document.title;

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
  
  setInterval(onTitleChange, 2000);
}

function onTitleChange() {
  if (document.title === lastTitle) return;
  lastTitle = document.title;
  
  console.log('[FB Marketplace Notifier] Title:', document.title);
  
  if (/^\(\d+\)/.test(document.title) || document.title.toLowerCase().includes('new message')) {
    console.log('[FB Marketplace Notifier] New message detected');
    setTimeout(scanForUnread, 500);
  }
}

function scanForUnread() {
  if (!webhookUrl) return;
  
  document.querySelectorAll('[role="gridcell"]').forEach(conv => {
    const id = (conv.textContent || '').slice(0, 60);
    
    if (notifiedMessages.has(id)) return;
    
    const isUnread = (() => {
      const text = (conv.textContent || '').toLowerCase();
      if (text.includes('unread')) return true;
      for (const span of conv.querySelectorAll('span[dir="auto"]')) {
        try { if (parseInt(getComputedStyle(span).fontWeight) >= 600) return true; } catch (e) {}
      }
      return false;
    })();
    
    if (isUnread) {
      console.log('[FB Marketplace Notifier] Found unread:', id);
      notifiedMessages.add(id);
      sendNotification(conv);
    }
  });
}

function sendNotification(conv) {
  const text = conv.textContent || '';
  const parts = text.split('·').map(p => p.trim());
  const sender = parts[0]?.split(':')[0]?.trim() || 'Unknown';
  const message = parts[1] || text.slice(0, 100);
  
  let payload;

  if (webhookUrl.includes('discord.com')) {
    payload = {
      content: `**New Message from ${sender}**\n${message}\n\n${window.location.href}`
    };
  } else if (webhookUrl.includes('slack.com')) {
    payload = {
      text: `New Message from ${sender}`,
      attachments: [{ text: message }]
    };
  } else if (webhookUrl.includes('/hooks/agent')) {
    // OpenClaw webhook format
    payload = {
      message: `**New Facebook Marketplace Message**\n\n**From:** ${sender}\n**Message:** ${message}\n\n${window.location.href}`,
      name: 'Marketplace-Alert',
      wakeMode: 'now'
    };
  } else {
    payload = {
      sender,
      message,
      timestamp: new Date().toISOString(),
      source: 'facebook_messenger',
      url: window.location.href
    };
  }
  
  fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(res => console.log('[FB Marketplace Notifier] Sent:', res.status))
    .catch(err => console.error('[FB Marketplace Notifier] Error:', err.message));
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
