<p align="center">
  <img src="icons/icon128.png" alt="Brain Logo" width="128" height="128">
</p>

<h1 align="center">Brain</h1>

<p align="center">
  Capture AI conversations from ChatGPT, Claude, Gemini, and Grok into Obsidian.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.2-blue" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/chrome-MV3-purple" alt="Manifest V3">
</p>

<p align="center">
  <a href="https://aswanidev-vs.github.io/Brain/">Website</a> • <a href="https://github.com/coddingtonbear/obsidian-local-rest-api">Obsidian Plugin</a>
</p>

---

## Features

- **Multi-Platform Support** - ChatGPT, Claude, Gemini, Grok
- **Auto-Capture** - Saves automatically after the AI reply appears and your delay passes
- **Manual Capture** - `Capture to Brain` button stays available as fallback
- **Obsidian Integration** - Direct vault writing via Local REST API
- **Graph Connections** - Auto-generates linked notes for Obsidian Graph View
- **Live Status** - Connection indicators on the capture button and extension icon
- **Privacy Options** - Exclude URLs, anonymize AI names
- **100% Local** - No data leaves your machine

## Quick Start

### 1. Install Chrome Extension

1. Open Chrome -> `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `brain` folder

### 2. Install Obsidian Plugin

1. Open Obsidian -> Settings -> Community plugins -> Browse
2. Search **Local REST API with MCP** by Adam Coddington
3. Install and enable it
4. Copy the **API Key** from plugin settings
5. Enable the HTTP server on port `27123`

### 3. Connect

1. Click the Brain extension icon
2. Paste your API key
3. Port: `27123`
4. Click **Connect**
5. Click **Test**

### 4. Capture

1. Go to ChatGPT, Claude, Gemini, or Grok
2. Click `Capture to Brain` or wait for auto-capture
3. Check your Obsidian vault in `AI-Brain/`

## Auto-Capture

Brain watches for new AI replies and saves automatically:

1. Send a message to the AI
2. Wait for the AI reply to appear
3. After your delay passes, Brain auto-saves
4. The manual button remains available as fallback

### Claude note

Claude updates its page differently from the other platforms, so Brain uses adaptive page detection there.

What that means in practice:
- Claude auto-capture may rely on reply-content changes, not only message-count changes
- If Claude ships a UI update and auto-capture misses a reply, the manual `Capture to Brain` button still works immediately

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Enable auto-capture | On | Toggle automatic saving |
| Delay | 5000ms | Wait time after a new AI reply appears |
| Capture Folder | AI-Brain | Folder name in vault |
| Generate graph | On | Create linked notes |

## Output Format

Saved as Markdown with YAML frontmatter:

```markdown
---
title: "Chat Title"
platform: Claude
captured: 2026-06-22T10:30:00Z
tags:
  - ai-conversation
  - claude
---

# Chat Title

**Platform:** Claude
**Captured:** 6/22/2026, 10:30:00 AM

---

**User:**

Your message here

---

**Claude:**

AI response here
```

## Vault Structure

```text
YourVault/
└── AI-Brain/
    ├── chatgpt/
    │   └── 2026-06-22-conversation.md
    ├── claude/
    ├── gemini/
    ├── grok/
    └── _graphs/
        └── 2026-06-22-graph.md
```

## Security

- 100% local
- No analytics or tracking
- No account required
- Open source
- Data only goes to your Obsidian vault

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `Not connected` | Check that Obsidian is running and the plugin is enabled |
| `API error 401` | The API key is wrong; copy it again from plugin settings |
| `Capture failed` | Refresh the page and try the manual button |
| Auto-capture not working | Check Settings -> Enable auto-capture and make sure the AI reply has appeared |
| Claude auto-capture misses a response | Claude updates its page differently; wait for the reply to settle or use manual capture |
| Red dot on capture button | Obsidian is not running or the API key is invalid |
| `Extension context invalidated` | The extension was updated; reload the chat page once |

## Supported Platforms

| Platform | URL |
|----------|-----|
| ChatGPT | `chat.openai.com`, `chatgpt.com` |
| Claude | `claude.ai` |
| Gemini | `gemini.google.com` |
| Grok | `grok.com`, `x.com` |

## Acknowledgements

This project uses the [Local REST API with MCP](https://github.com/coddingtonbear/obsidian-local-rest-api) plugin by Adam Coddington to connect with Obsidian and write notes directly to your vault.

## License

MIT
