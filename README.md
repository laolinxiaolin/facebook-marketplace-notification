# Facebook Marketplace Notifier

A Chrome extension that forwards Facebook Marketplace messages to external services.

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked" and select the `facebook-marketplace-notifier` folder

## Setup

1. Click the extension icon and go to Settings
2. Enter your webhook URL (see below for options)
3. Choose notification type and save

## Webhook Options

### Option 1: Discord
1. Go to your Discord server settings > Integrations > Webhooks
2. Create a webhook and copy the URL
3. Paste in extension settings, select "Discord Webhook"

### Option 2: Slack
1. Go to https://api.slack.com/apps and create an app
2. Enable incoming webhooks and create one for your channel
3. Paste the webhook URL in extension settings

### Option 3: Custom Server
Create a simple server to receive notifications:

```python
# Python example (server.py)
from flask import Flask, request, jsonify
app = Flask(__name__)

@app.route('/webhook', methods=['POST'])
def webhook():
    data = request.json
    print(f"New Marketplace message from {data['sender']}: {data['message']}")
    # Send push notification, email, etc.
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    app.run(port=5000)
```

Then use ngrok to expose it: `ngrok http 5000`

### Option 4: Telegram Bot
1. Create a bot via @BotFather
2. Get your chat ID by messaging @userinfobot
3. Use URL format: `https://api.telegram.org/bot<BOT_TOKEN>/sendMessage?chat_id=<CHAT_ID>`

## Files Structure

```
facebook-marketplace-notifier/
├── manifest.json
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── scripts/
│   ├── content.js
│   └── background.js
├── options/
│   ├── options.html
│   └── options.js
└── popup/
    ├── popup.html
    └── popup.js
```
