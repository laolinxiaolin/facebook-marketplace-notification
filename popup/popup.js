document.addEventListener('DOMContentLoaded', () => {
  updateStatus();
});

document.getElementById('toggle').addEventListener('click', () => {
  chrome.storage.sync.get(['enabled'], (result) => {
    const newEnabled = result.enabled === false ? true : false;
    chrome.storage.sync.set({ enabled: newEnabled }, updateStatus);
  });
});

document.getElementById('settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

function updateStatus() {
  chrome.storage.sync.get(['webhookUrl', 'enabled'], (result) => {
    const statusBox = document.getElementById('statusBox');
    
    if (!result.webhookUrl) {
      statusBox.textContent = 'Not configured';
      statusBox.className = 'status disabled';
      return;
    }
    
    if (result.enabled !== false) {
      statusBox.textContent = 'Active - Monitoring';
      statusBox.className = 'status enabled';
    } else {
      statusBox.textContent = 'Paused';
      statusBox.className = 'status disabled';
    }
  });
}
