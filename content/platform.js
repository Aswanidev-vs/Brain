(() => {
  const PLATFORMS = {
    'chat.openai.com': 'ChatGPT', 'chatgpt.com': 'ChatGPT',
    'claude.ai': 'Claude', 'gemini.google.com': 'Gemini',
    'grok.com': 'Grok', 'x.com': 'Grok'
  };

  const hostname = window.location.hostname;
  const platform = Object.entries(PLATFORMS).find(([h]) => hostname.includes(h))?.[1];
  if (!platform) return;

  let autoCaptureEnabled = false;
  let autoCaptureDelay = 5000;
  let lastCaptureTime = 0;
  let lastMessageCount = 0;
  let pendingMessageCount = 0;
  let lastAssistantSignature = '';
  let pendingAssistantSignature = '';
  let autoSaveTimeout = null;
  let isCapturing = false;
  let isAutoSaving = false;
  let connectionStatus = null; // null = unknown, true = connected, false = disconnected

  chrome.storage.sync.get(['autoCapture', 'autoCaptureDelay', 'connectionMethod', 'apiKey', 'isConnected'], (settings) => {
    // Only enable auto-capture if extension is actually configured
    const isConfigured = settings.connectionMethod === 'fs' ||
                         (settings.connectionMethod === 'api' && settings.apiKey && settings.isConnected) ||
                         (!settings.connectionMethod && settings.apiKey && settings.isConnected);
    autoCaptureEnabled = isConfigured && settings.autoCapture !== false;
    autoCaptureDelay = settings.autoCaptureDelay || 5000;
  });

  function readText(el) {
    if (!el) return '';
    return (el.innerText || el.textContent || '').trim();
  }

  function getExtractors() {
    switch (platform) {
      case 'ChatGPT':
        return {
          messages: () => [...document.querySelectorAll('[data-message-author-role]')].map(el => ({
            role: el.getAttribute('data-message-author-role') === 'user' ? 'user' : 'assistant',
            content: readText(el.querySelector('.markdown') || el.querySelector('.whitespace-pre-wrap') || el)
          })),
          title: () => {
            const t = document.querySelector('title')?.textContent?.replace(' | ChatGPT', '').trim();
            if (t && t !== 'ChatGPT') return t;
            const f = readText(document.querySelector('[data-message-author-role="user"]'));
            return f ? f.substring(0, 60) : null;
          },
          getMessageCount: () => document.querySelectorAll('[data-message-author-role]').length
        };
      case 'Claude':
        return {
          messages: () => {
            const msgs = [];
            const seen = new Set();

            // Collect messages with DOM position for proper ordering
            const collected = [];

            // Strategy 1: data-testid selectors (most reliable)
            const userEls = document.querySelectorAll('[data-testid="user-message"]');
            const assistantEls = document.querySelectorAll('.font-claude-message');

            if (userEls.length > 0 || assistantEls.length > 0) {
              userEls.forEach(el => {
                const text = readText(el);
                if (text.length >= 5 && !seen.has(text)) {
                  seen.add(text);
                  collected.push({ role: 'user', content: text, el });
                }
              });
              assistantEls.forEach(el => {
                const text = readText(el);
                if (text.length >= 5 && !seen.has(text)) {
                  seen.add(text);
                  collected.push({ role: 'assistant', content: text, el });
                }
              });
            }

            // Strategy 2: class-based turn containers
            if (collected.length === 0) {
              document.querySelectorAll('[class*="turn"], [class*="message-row"], [class*="msg-row"]').forEach(el => {
                const text = readText(el);
                if (text.length < 5 || seen.has(text)) return;
                if (text.includes('Write a message') || text.includes('Keyboard')) return;
                const classes = (el.className || '').toString().toLowerCase();
                const isUser = classes.includes('human') || classes.includes('user');
                seen.add(text);
                collected.push({ role: isUser ? 'user' : 'assistant', content: text, el });
              });
            }

            // Strategy 3: Walk prose/markdown blocks, detect role by ancestry
            if (collected.length === 0) {
              document.querySelectorAll('[class*="prose"], [class*="markdown"]').forEach(el => {
                const text = readText(el);
                if (text.length < 10 || seen.has(text)) return;
                if (text.includes('Write a message') || text.includes('Settings')) return;
                if (text.includes('Claude Fable') || text.includes('Learn more')) return;
                seen.add(text);

                // Check ancestors for role hints
                let role = 'assistant';
                let parent = el.parentElement;
                for (let i = 0; i < 8 && parent; i++) {
                  const pc = (parent.className || '').toString().toLowerCase();
                  const dr = parent.getAttribute('data-role') || '';
                  if (pc.includes('human') || dr === 'human' || dr === 'user') { role = 'user'; break; }
                  if (pc.includes('assistant') || dr === 'assistant') break;
                  parent = parent.parentElement;
                }
                collected.push({ role, content: text, el });
              });
            }

            // Sort by DOM position to maintain conversation order
            collected.sort((a, b) => {
              const pos = a.el.compareDocumentPosition(b.el);
              return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
            });

            collected.forEach(m => msgs.push({ role: m.role, content: m.content }));
            return msgs;
          },
          title: () => {
            // Try page title first
            const pageTitle = document.title?.replace(/\s*[-–|]?\s*Claude\s*$/, '').trim();
            if (pageTitle && pageTitle !== 'Claude' && pageTitle.length > 2) return pageTitle;
            // Fallback: first user message
            const firstUser = document.querySelector('[data-testid="user-message"]');
            const text = readText(firstUser);
            if (text) return text.substring(0, 60);
            return null;
          },
          getMessageCount: () => {
            // Count actual conversation turns, not random p tags
            const turns = document.querySelectorAll('[data-testid="user-message"], .font-claude-message');
            if (turns.length > 0) return turns.length;
            return document.querySelectorAll('[class*="turn"], [class*="prose"]').length;
          }
        };
      case 'Gemini':
        return {
          messages: () => {
            const msgs = [];
            document.querySelectorAll('.user-query, .query-text').forEach(el => {
              msgs.push({ role: 'user', content: readText(el) });
            });
            document.querySelectorAll('.model-response-text, .response-container').forEach(el => {
              msgs.push({ role: 'assistant', content: readText(el) });
            });
            if (msgs.length === 0) {
              document.querySelectorAll('[class*="message"], [class*="turn"]').forEach(el => {
                const content = readText(el);
                if (content.length > 10) {
                  msgs.push({
                    role: el.classList.toString().includes('user') ? 'user' : 'assistant',
                    content
                  });
                }
              });
            }
            return msgs;
          },
          title: () => {
            const h = document.querySelector('h1');
            const title = readText(h);
            if (title && !title.includes('Gemini')) return title;
            const f = readText(document.querySelector('.user-query, .query-text'));
            return f ? f.substring(0, 60) : null;
          },
          getMessageCount: () => document.querySelectorAll('.user-query, .query-text, .model-response-text, .response-container').length
        };
      case 'Grok':
        return {
          messages: () => {
            const msgs = [];

            document.querySelectorAll('[class*="message"]').forEach(el => {
              const text = readText(el);
              if (text.length < 5 || text.includes('Settings') || text.includes('Keyboard')) return;
              const isUser = el.querySelector('[class*="user"]') !== null ||
                             el.getAttribute('data-role') === 'user';
              msgs.push({
                role: isUser ? 'user' : 'assistant',
                content: text
              });
            });

            if (msgs.length === 0) {
              document.querySelectorAll('[class*="prose"], [class*="markdown"], [class*="text"]').forEach(el => {
                const text = readText(el);
                if (text.length > 5 && !text.includes('Grok')) {
                  msgs.push({
                    role: msgs.length % 2 === 0 ? 'user' : 'assistant',
                    content: text
                  });
                }
              });
            }

            return msgs;
          },
          title: () => {
            const h = document.querySelector('h1, [class*="title"]');
            const title = readText(h);
            if (title && !title.includes('Grok')) return title;
            return null;
          },
          getMessageCount: () => document.querySelectorAll('[class*="message"]').length
        };
    }
  }

  const extractors = getExtractors();
  let captureBtn = null;

  function getMessages() {
    try {
      return (extractors.messages?.() || []).filter(m => m && m.content);
    } catch (e) {
      console.error('Brain extraction error (messages):', e);
      return [];
    }
  }

  function getTitle() {
    try {
      return extractors.title?.() || `${platform} Chat ${new Date().toLocaleDateString()}`;
    } catch (e) {
      console.error('Brain extraction error (title):', e);
      return `${platform} Chat ${new Date().toLocaleDateString()}`;
    }
  }

  function getMessageCount() {
    try {
      return extractors.getMessageCount?.() || 0;
    } catch (e) {
      console.error('Brain extraction error (count):', e);
      return getMessages().length;
    }
  }

  function createButton() {
    if (captureBtn) return;
    captureBtn = document.createElement('button');
    captureBtn.className = 'ai-brain-capture-btn';
    captureBtn.innerHTML = `<svg class="brain-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M8 12c0-2.21 1.79-4 4-4s4 1.79 4 4-1.79 4-4 4"/><circle cx="12" cy="12" r="2"/></svg><span>Capture to Brain</span><span class="ai-brain-status-dot" title="Checking connection..."></span>`;
    captureBtn.onclick = () => capture(false);
    document.body.appendChild(captureBtn);
    // Check initial connection status
    updateConnectionDot(connectionStatus);
  }

  function updateConnectionDot(connected) {
    connectionStatus = connected;
    const dot = captureBtn?.querySelector('.ai-brain-status-dot');
    if (!dot) return;
    dot.classList.remove('connected', 'disconnected', 'unknown');
    if (connected === true) {
      dot.classList.add('connected');
      dot.title = 'Connected to Obsidian';
    } else if (connected === false) {
      dot.classList.add('disconnected');
      dot.title = 'Not connected to Obsidian';
    } else {
      dot.classList.add('unknown');
      dot.title = 'Checking connection...';
    }
  }

  function setCaptureButtonLabel(text) {
    const label = captureBtn?.querySelector('span');
    if (label) label.textContent = text;
  }

  function toast(msg, isError = false) {
    const existing = document.querySelector('.ai-brain-toast');
    if (existing) existing.remove();
    const t = document.createElement('div');
    t.className = 'ai-brain-toast';
    t.textContent = msg;
    if (isError) t.style.borderLeft = '3px solid #ef4444';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  function getLatestAssistantSignature(messages) {
    const assistantMessage = [...messages].reverse().find(m => m.role === 'assistant' && m.content);
    if (!assistantMessage) return '';
    return `${assistantMessage.role}:${assistantMessage.content.trim()}`;
  }

  async function capture(isAuto = false) {
    if (isCapturing) return null;
    isCapturing = true;

    if (captureBtn) {
      captureBtn.classList.add('capturing');
      setCaptureButtonLabel('Capturing...');
    }

    try {
      const messages = getMessages();
      const title = getTitle();

      if (!messages.length) {
        if (!isAuto) toast('No messages found', true);
        return null;
      }

      const response = await chrome.runtime.sendMessage({
        action: 'saveConversation',
        data: { platform, title, messages, timestamp: new Date().toISOString(), url: window.location.href }
      });

      if (response && response.success) {
        if (captureBtn) {
          captureBtn.classList.add('success');
          setCaptureButtonLabel('Saved!');
        }
        if (!isAuto) toast(`Captured ${messages.length} messages`);
        lastCaptureTime = Date.now();
        lastMessageCount = Math.max(lastMessageCount, getMessageCount(), messages.length);
        lastAssistantSignature = getLatestAssistantSignature(messages);
        pendingMessageCount = lastMessageCount;
        pendingAssistantSignature = lastAssistantSignature;
        return response;
      } else {
        const errorMsg = response?.error || 'Unknown error';
        if (!isAuto) toast(`Failed: ${errorMsg}`, true);
        return null;
      }
    } catch (e) {
      console.error('Brain capture error:', e);
      if (!isAuto) toast(`Error: ${e.message}`, true);
      return null;
    } finally {
      isCapturing = false;
      setTimeout(() => {
        captureBtn?.classList.remove('capturing', 'success');
        setCaptureButtonLabel('Capture to Brain');
      }, 2000);
    }
  }

  function scheduleAutoCapture() {
    if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
    const targetMessageCount = pendingMessageCount;
    const targetAssistantSignature = pendingAssistantSignature;

    autoSaveTimeout = setTimeout(async () => {
      if (!autoCaptureEnabled || isCapturing || isAutoSaving) return;

      const msgCount = getMessageCount();
      const messages = getMessages();
      const latestAssistantSignature = getLatestAssistantSignature(messages);

      if (
        targetMessageCount > lastMessageCount &&
        msgCount >= targetMessageCount &&
        msgCount > 0 &&
        targetAssistantSignature &&
        latestAssistantSignature === targetAssistantSignature &&
        latestAssistantSignature !== lastAssistantSignature
      ) {
        isAutoSaving = true;
        try {
          await capture(true);
        } finally {
          isAutoSaving = false;
        }
      }
    }, autoCaptureDelay);
  }

  function setupAutoCapture() {
    const observer = new MutationObserver(() => {
      if (!document.querySelector('.ai-brain-capture-btn')) {
        createButton();
      }

      if (autoCaptureEnabled && !isCapturing && !isAutoSaving) {
        const msgCount = getMessageCount();
        const messages = getMessages();
        const latestAssistantSignature = getLatestAssistantSignature(messages);

        if (
          msgCount > lastMessageCount &&
          latestAssistantSignature &&
          latestAssistantSignature !== lastAssistantSignature
        ) {
          pendingMessageCount = msgCount;
          pendingAssistantSignature = latestAssistantSignature;
          scheduleAutoCapture();
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return observer;
  }

  chrome.runtime.onMessage.addListener((req) => {
    if (req.action === 'capture') capture(false);
    if (req.action === 'toggleAutoCapture') {
      autoCaptureEnabled = !autoCaptureEnabled;
      toast(`Auto-capture ${autoCaptureEnabled ? 'enabled' : 'disabled'}`);
    }
    if (req.action === 'connectionStatus') {
      updateConnectionDot(req.connected);
    }
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.autoCapture) {
      autoCaptureEnabled = changes.autoCapture.newValue;
    }
    if (changes.autoCaptureDelay) {
      autoCaptureDelay = changes.autoCaptureDelay.newValue || 5000;
    }
    // Re-evaluate auto-capture when connection state changes
    if (changes.connectionMethod || changes.isConnected || changes.apiKey) {
      chrome.storage.sync.get(['autoCapture', 'connectionMethod', 'apiKey', 'isConnected'], (s) => {
        const isConfigured = s.connectionMethod === 'fs' ||
                             (s.connectionMethod === 'api' && s.apiKey && s.isConnected) ||
                             (!s.connectionMethod && s.apiKey && s.isConnected);
        autoCaptureEnabled = isConfigured && s.autoCapture !== false;
      });
    }
  });

  setupAutoCapture();
  createButton();
  lastMessageCount = getMessageCount();
  lastAssistantSignature = getLatestAssistantSignature(getMessages());
  pendingMessageCount = lastMessageCount;
  pendingAssistantSignature = lastAssistantSignature;
  // Fetch initial connection status from service worker
  chrome.runtime.sendMessage({ action: 'getConnectionStatus' }, (response) => {
    if (chrome.runtime.lastError) return; // extension context invalidated
    if (response) updateConnectionDot(response.connected);
  });
})();
