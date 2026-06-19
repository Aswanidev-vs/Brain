# Brain v2

A minimal, secure Chrome extension that captures AI chats from ChatGPT, Claude, Gemini, and Grok into Obsidian.

## Security

- **100% Local** - No data leaves your machine
- **No Analytics** - Zero tracking or telemetry
- **Open Source** - Fully auditable
- **No Accounts** - No registration needed

## Setup

### 1. Install Extension
1. Chrome → `chrome://extensions/`
2. Enable Developer mode
3. Load unpacked → select `Brain-v2` folder

### 2. Connect to Obsidian

**Option A: REST API (Recommended)**
1. Install "Obsidian Local REST API" plugin in Obsidian
2. Enable it → copy API Key
3. Click Brain → paste key → Connect

**Option B: Direct File System**
1. Click Brain → Settings tab → Select Folder
2. Navigate to your vault → confirm

### 3. Capture
Navigate to any AI chat → click "Capture to Brain"

## Features

- Multi-platform support (ChatGPT, Claude, Gemini, Grok)
- Graph connections in Obsidian
- Keyword and topic extraction
- Privacy options (anonymize, exclude URLs)
- Unified codebase (single content script)

## Architecture

```
Brain-v2/
├── manifest.json
├── background/service-worker.js   # Core logic + API client
├── content/platform.js            # Unified capture script
├── popup/                         # UI
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
└── styles/capture-button.css
```

## License

MIT