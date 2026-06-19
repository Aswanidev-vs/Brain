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
  let lastCaptureTime = 0;
  let lastMessageCount = 0;
  let autoSaveTimeout = null;
  let isCapturing = false;

  chrome.storage.sync.get(['autoCapture', 'autoCaptureDelay'], (settings) => {
    autoCaptureEnabled = settings.autoCapture !== false;
  });

  function getExtractors() {
    switch (platform) {
      case 'ChatGPT':
        return {
          messages: () => [...document.querySelectorAll('[data-message-author-role]')].map(el => ({
            role: el.getAttribute('data-message-author-role') === 'user' ? 'user' : 'assistant',
            content: (el.querySelector('.markdown') || el.querySelector('.whitespace-pre-wrap') || el).innerText.trim()
          })),
          title: () => {
            const t = document.querySelector('title')?.textContent?.replace(' | ChatGPT', '').trim();
            if (t && t !== 'ChatGPT') return t;
            const f = document.querySelector('[data-message-author-role="user"]')?.innerText?.trim();
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
              const text = el.innerText.trim();
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
                const text = el.innerText.trim();
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
            if (h && h.textContent.trim() !== 'Claude') return h.textContent.trim();
            return null;
          },
          getMessageCount: () => document.querySelectorAll('p').length
        };
      case 'Gemini':
        return {
          messages: () => {
            const msgs = [];
            document.querySelectorAll('.user-query, .query-text').forEach(el => {
              msgs.push({ role: 'user', content: el.innerText.trim() });
            });
            document.querySelectorAll('.model-response-text, .response-container').forEach(el => {
              msgs.push({ role: 'assistant', content: el.innerText.trim() });
            });
            if (msgs.length === 0) {
              document.querySelectorAll('[class*="message"], [class*="turn"]').forEach(el => {
                const content = el.innerText.trim();
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
            if (h && !h.textContent.includes('Gemini')) return h.textContent.trim();
            const f = document.querySelector('.user-query, .query-text')?.innerText?.trim();
            return f ? f.substring(0, 60) : null;
          },
          getMessageCount: () => document.querySelectorAll('.user-query, .query-text, .model-response-text, .response-container').length
        };
      case 'Grok':
        return {
          messages: () => {
            const msgs = [];

            document.querySelectorAll('[class*="message"]').forEach(el => {
              const text = el.innerText.trim();
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
                const text = el.innerText.trim();
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
            if (h && !h.textContent.includes('Grok')) return h.textContent.trim();
            return null;
          },
          getMessageCount: () => document.querySelectorAll('[class*="message"]').length
        };
    }
  }

  const extractors = getExtractors();
  let captureBtn = null;

  function createButton() {
    if (captureBtn) return;
    captureBtn = document.createElement('button');
    captureBtn.className = 'ai-brain-capture-btn';
    captureBtn.innerHTML = `<svg class="brain-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M8 12c0-2.21 1.79-4 4-4s4 1.79 4 4-1.79 4-4 4"/><circle cx="12" cy="12" r="2"/></svg><span>Capture to Brain</span>`;
    captureBtn.onclick = capture;
    document.body.appendChild(captureBtn);
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

  async function capture(isAuto = false) {
    if (isCapturing) return null;
    isCapturing = true;

    if (captureBtn) {
      captureBtn.classList.add('capturing');
      captureBtn.querySelector('span').textContent = 'Capturing...';
    }

    try {
      const messages = extractors.messages().filter(m => m.content);
      const title = extractors.title() || `${platform} Chat ${new Date().toLocaleDateString()}`;

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
          captureBtn.querySelector('span').textContent = 'Saved!';
        }
        if (!isAuto) toast(`Captured ${messages.length} messages`);
        lastCaptureTime = Date.now();
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
        if (captureBtn) captureBtn.querySelector('span').textContent = 'Capture to Brain';
      }, 2000);
    }
  }

  function scheduleAutoCapture() {
    if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
    chrome.storage.sync.get(['autoCaptureDelay'], (settings) => {
      const delay = settings.autoCaptureDelay || 5000;
      autoSaveTimeout = setTimeout(async () => {
        const msgCount = extractors.getMessageCount();
        if (msgCount > lastMessageCount && msgCount > 0) {
          await capture(true);
          lastMessageCount = msgCount;
        }
      }, delay);
    });
  }

  function setupAutoCapture() {
    const observer = new MutationObserver(() => {
      if (!document.querySelector('.ai-brain-capture-btn')) {
        createButton();
      }

      if (autoCaptureEnabled && !isCapturing) {
        const msgCount = extractors.getMessageCount();
        if (msgCount > lastMessageCount) {
          lastMessageCount = msgCount;
          scheduleAutoCapture();
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return observer;
  }

  chrome.runtime.onMessage.addListener((req) => {
    if (req.action === 'capture') capture();
    if (req.action === 'toggleAutoCapture') {
      autoCaptureEnabled = !autoCaptureEnabled;
      toast(`Auto-capture ${autoCaptureEnabled ? 'enabled' : 'disabled'}`);
    }
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.autoCapture) {
      autoCaptureEnabled = changes.autoCapture.newValue;
    }
  });

  setupAutoCapture();
  createButton();
  lastMessageCount = extractors.getMessageCount();
})();