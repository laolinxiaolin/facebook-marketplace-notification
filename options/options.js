document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get(['webhookUrl', 'enabled', 'notificationType'], (result) => {
    if (result.webhookUrl) document.getElementById('webhookUrl').value = result.webhookUrl;
    if (result.notificationType) document.getElementById('notificationType').value = result.notificationType;
    document.getElementById('enabled').checked = result.enabled !== false;
  });
});

document.getElementById('save').addEventListener('click', () => {
  const webhookUrl = document.getElementById('webhookUrl').value;
  const enabled = document.getElementById('enabled').checked;
  const notificationType = document.getElementById('notificationType').value;

  chrome.storage.sync.set({ webhookUrl, enabled, notificationType }, () => {
    showStatus('Settings saved!', 'success');
  });
});

document.getElementById('test').addEventListener('click', () => {
  const webhookUrl = document.getElementById('webhookUrl').value;
  const notificationType = document.getElementById('notificationType').value;

  if (!webhookUrl) {
    showStatus('Please enter a webhook URL', 'error');
    return;
  }

  const testData = {
    id: 'test_' + Date.now(),
    sender: 'Test User',
    message: 'This is a test marketplace message',
    timestamp: new Date().toISOString(),
    source: 'facebook_marketplace',
    url: 'https://facebook.com/marketplace'
  };

  sendNotification(webhookUrl, testData, notificationType);
});

function sendNotification(webhookUrl, data, type) {
  let url = webhookUrl;
  let body;

  switch (type) {
    case 'openclaw':
      body = JSON.stringify({
        message: `**New Facebook Marketplace Message**\n\n**From:** ${data.sender}\n**Message:** ${data.message}\n\n${data.url}`,
        name: 'Marketplace-Alert',
        wakeMode: 'now'
      });
      break;
    case 'discord':
      body = JSON.stringify({
        content: `**New Marketplace Message**\nFrom: ${data.sender}\nMessage: ${data.message}\nTime: ${data.timestamp}`
      });
      break;
    case 'slack':
      body = JSON.stringify({
        text: `New Marketplace Message`,
        attachments: [{
          fields: [
            { title: 'From', value: data.sender, short: true },
            { title: 'Message', value: data.message, short: false }
          ]
        }]
      });
      break;
    case 'telegram':
      body = JSON.stringify({
        chat_id: webhookUrl.split('chat_id=')[1]?.split('&')[0] || '',
        text: `New Marketplace Message\nFrom: ${data.sender}\nMessage: ${data.message}`
      });
      break;
    default:
      body = JSON.stringify(data);
  }

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  })
  .then(response => {
    if (response.ok) {
      showStatus('Test notification sent!', 'success');
    } else {
      showStatus(`Error: ${response.status}`, 'error');
    }
  })
  .catch(error => {
    showStatus(`Error: ${error.message}`, 'error');
  });
}

function showStatus(message, type) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = `status ${type}`;
  status.style.display = 'block';
  setTimeout(() => { status.style.display = 'none'; }, 3000);
}
