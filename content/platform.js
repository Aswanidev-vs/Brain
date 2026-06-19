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

  chrome.storage.sync.get(['autoCapture', 'autoCaptureDelay'], (settings) => {
    autoCaptureEnabled = settings.autoCapture !== false;
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

            document.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, pre, blockquote').forEach(el => {
              const text = readText(el);
              if (text.length < 5 || seen.has(text)) return;
              if (text.includes('Write a message') || text.includes('Settings') || text.includes('Keyboard')) return;
              if (text.includes('Claude Fable') || text.includes('Learn more')) return;
              seen.add(text);
              msgs.push({
                role: 'assistant',
                content: text
              });
            });

            if (msgs.length === 0) {
              document.querySelectorAll('[class*="prose"], [class*="markdown"]').forEach(el => {
                const text = readText(el);
                if (text.length > 10 && !seen.has(text)) {
                  seen.add(text);
                  msgs.push({
                    role: 'assistant',
                    content: text
                  });
                }
              });
            }

            return msgs;
          },
          title: () => {
            const h = document.querySelector('h1');
            const title = readText(h);
            if (title && title !== 'Claude') return title;
            return null;
          },
          getMessageCount: () => document.querySelectorAll('p').length
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
    captureBtn.innerHTML = `<svg class="brain-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M8 12c0-2.21 1.79-4 4-4s4 1.79 4 4-1.79 4-4 4"/><circle cx="12" cy="12" r="2"/></svg><span>Capture to Brain</span>`;
    captureBtn.onclick = () => capture(false);
    document.body.appendChild(captureBtn);
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
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.autoCapture) {
      autoCaptureEnabled = changes.autoCapture.newValue;
    }
    if (changes.autoCaptureDelay) {
      autoCaptureDelay = changes.autoCaptureDelay.newValue || 5000;
    }
  });

  setupAutoCapture();
  createButton();
  lastMessageCount = getMessageCount();
  lastAssistantSignature = getLatestAssistantSignature(getMessages());
  pendingMessageCount = lastMessageCount;
  pendingAssistantSignature = lastAssistantSignature;
})();
