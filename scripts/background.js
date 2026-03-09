chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkMessages') {
    chrome.tabs.query({ url: ['https://www.facebook.com/*', 'https://www.messenger.com/*'] }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'checkNow' });
      });
    });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('checkMessages', { periodInMinutes: 1 });
});
