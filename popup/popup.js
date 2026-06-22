(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);

  let vaultDirHandle = null;

  $$('.tab').forEach(t => t.onclick = () => {
    $$('.tab').forEach(x => x.classList.remove('active'));
    $$('.panel').forEach(x => x.style.display = 'none');
    t.classList.add('active');
    $(`#${t.dataset.tab}`).style.display = 'block';
  });

  $$('input[name="method"]').forEach(r => r.onchange = () => {
    $('#apiSetup').style.display = r.value === 'api' ? 'block' : 'none';
    $('#fsSetup').style.display = r.value === 'fs' ? 'block' : 'none';
    // Persist method selection immediately so service worker knows the intent
    chrome.storage.sync.set({ connectionMethod: r.value });
  });

  load();

  $('#connectBtn').onclick = connect;
  $('#testBtn').onclick = testConnection;
  $('#saveFs').onclick = saveFS;
  $('#saveSettings').onclick = saveSettings;
  $('#captureBtn').onclick = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab) { chrome.tabs.sendMessage(tab.id, { action: 'capture' }); toast('Capturing...'); }
    });
  };
  $('#toggleKey').onclick = () => { $('#apiKey').type = $('#apiKey').type === 'password' ? 'text' : 'password'; };
  $('#helpBtn').onclick = () => $('#helpModal').style.display = 'flex';
  $('#closeModal').onclick = () => $('#helpModal').style.display = 'none';
  $('#helpModal').onclick = e => { if (e.target === $('#helpModal')) $('#helpModal').style.display = 'none'; };

  $('#selectFolder').onclick = async () => {
    try {
      if ('showDirectoryPicker' in window) {
        const h = await window.showDirectoryPicker({ mode: 'readwrite' });
        await chrome.storage.sync.set({ vaultPath: h.name });
        $('#vaultDisplay').textContent = h.name;
        toast('Folder selected!');
      } else {
        const p = prompt('Enter vault path (e.g., C:\\Users\\You\\Documents\\MyVault)');
        if (p) { await chrome.storage.sync.set({ vaultPath: p }); $('#vaultDisplay').textContent = p; toast('Path saved!'); }
      }
    } catch (e) { /* cancelled */ }
  };

  $('#selectVaultFolder').onclick = async () => {
    try {
      if ('showDirectoryPicker' in window) {
        vaultDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        await chrome.storage.sync.set({ vaultPath: vaultDirHandle.name, vaultPathFull: vaultDirHandle.name });
        updateVaultDisplay(vaultDirHandle.name);
        toast('Vault folder selected!');
      } else {
        const p = prompt('Enter your Obsidian vault path:\n(e.g., C:\\Users\\You\\Documents\\MyVault)');
        if (p && p.trim()) {
          await chrome.storage.sync.set({ vaultPath: p.trim() });
          updateVaultDisplay(p.trim());
          toast('Vault path saved!');
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        toast('Failed to select folder', true);
      }
    }
  };

  $('#clearVault').onclick = async () => {
    vaultDirHandle = null;
    await chrome.storage.sync.remove(['vaultPath', 'vaultPathFull']);
    updateVaultDisplay(null);
    toast('Vault path cleared');
  };

  function updateVaultDisplay(path) {
    const display = $('#vaultPathDisplay');
    const text = display.querySelector('.vault-path-text');
    const clearBtn = $('#clearVault');

    if (path) {
      text.textContent = path;
      display.classList.add('has-path');
      clearBtn.style.display = 'block';
    } else {
      text.textContent = 'No folder selected';
      display.classList.remove('has-path');
      clearBtn.style.display = 'none';
    }
  }

  async function load() {
    const d = await chrome.storage.sync.get([
      'apiKey','port','captureFolder','generateGraph','autoCapture','captureCount',
      'connectionMethod','vaultPath','excludeUrls','anonymizeData','isConnected','useHttps',
      'autoCaptureDelay'
    ]);
    if (d.apiKey) $('#apiKey').value = d.apiKey;
    if (d.port) $('#port').value = d.port;
    if (d.captureFolder) $('#captureFolder').value = d.captureFolder;
    if (d.generateGraph !== undefined) $('#generateGraph').checked = d.generateGraph;
    if (d.autoCapture !== undefined) $('#autoCapture').checked = d.autoCapture;
    if (d.autoCaptureDelay) $('#autoCaptureDelay').value = d.autoCaptureDelay;
    if (d.excludeUrls !== undefined) $('#excludeUrls').checked = d.excludeUrls;
    if (d.anonymizeData !== undefined) $('#anonymizeData').checked = d.anonymizeData;
    if (d.captureCount) $('#count').textContent = d.captureCount;
    if (d.connectionMethod === 'fs') {
      $('input[value="fs"]').checked = true;
      $('#apiSetup').style.display = 'none';
      $('#fsSetup').style.display = 'block';
    }
    if (d.vaultPath) {
      updateVaultDisplay(d.vaultPath);
    }
    if (d.isConnected && d.apiKey) {
      const ok = await testAPI(d.apiKey, d.port || 27123, d.useHttps);
      setStatus(ok);
    }
  }

  async function connect() {
    const key = $('#apiKey').value.trim();
    const port = $('#port').value.trim() || '27123';
    const useHttps = $('#useHttps')?.checked || false;
    if (!key) { toast('Enter API key', true); return; }
    $('#connectBtn').disabled = true;
    $('#connectBtn').textContent = 'Connecting...';

    const ok = await testAPI(key, port, useHttps);
    if (ok) {
      await save({ apiKey: key, port, connectionMethod: 'api', isConnected: true, useHttps });
      toast('Connected!');
    } else {
      setStatus(false);
      toast('Connection failed - check Obsidian & plugin', true);
    }
    $('#connectBtn').disabled = false;
    $('#connectBtn').textContent = 'Connect';
  }

  async function testConnection() {
    const key = $('#apiKey').value.trim();
    const port = $('#port').value.trim() || '27123';
    const useHttps = $('#useHttps')?.checked || false;
    if (!key) { toast('Enter API key first', true); return; }

    const resultEl = $('#testResult');
    resultEl.style.display = 'block';
    resultEl.className = 'test-result';
    resultEl.textContent = 'Testing connection...';

    try {
      const protocol = useHttps ? 'https' : 'http';
      const baseUrl = `${protocol}://127.0.0.1:${port}`;

      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 5000);
      const res = await fetch(`${baseUrl}/`, {
        headers: { 'Authorization': `Bearer ${key}`, 'Accept': 'application/json' },
        signal: c.signal
      });
      clearTimeout(t);

      if (!res.ok) {
        resultEl.className = 'test-result error';
        resultEl.textContent = `Failed: Server returned ${res.status}`;
        return;
      }

      const data = await res.json();

      const res2 = await fetch(`${baseUrl}/vault/`, {
        headers: { 'Authorization': `Bearer ${key}`, 'Accept': 'application/json' }
      });

      if (res2.ok) {
        const files = await res2.json();
        resultEl.className = 'test-result success';
        resultEl.innerHTML = `<strong>Connected!</strong><br>Protocol: ${protocol.toUpperCase()}<br>Vault items: ${Array.isArray(files) ? files.length : 'N/A'}`;
        setStatus(true);
        await save({ apiKey: key, port, connectionMethod: 'api', isConnected: true, useHttps });
      } else {
        resultEl.className = 'test-result error';
        resultEl.textContent = `Connected but vault access failed (${res2.status})`;
      }
    } catch (e) {
      resultEl.className = 'test-result error';
      if (e.name === 'AbortError') {
        resultEl.textContent = 'Timeout - is Obsidian running?';
      } else {
        resultEl.textContent = `Error: ${e.message}`;
      }
      setStatus(false);
    }
  }

  async function saveFS() {
    await save({ connectionMethod: 'fs', isConnected: true });
    toast('Saved!');
  }

  async function saveSettings() {
    const resultEl = $('#saveResult');
    resultEl.style.display = 'block';
    resultEl.className = 'test-result';
    resultEl.textContent = 'Saving...';

    try {
      await save();
      resultEl.className = 'test-result success';
      resultEl.textContent = 'Settings saved!';
      toast('Settings saved!');
      setTimeout(() => { resultEl.style.display = 'none'; }, 2000);
    } catch (e) {
      resultEl.className = 'test-result error';
      resultEl.textContent = `Error: ${e.message}`;
    }
  }

  async function save(extra) {
    const base = {
      captureFolder: $('#captureFolder').value.trim() || 'AI-Brain',
      generateGraph: $('#generateGraph').checked,
      autoCapture: $('#autoCapture').checked,
      autoCaptureDelay: parseInt($('#autoCaptureDelay').value) || 5000,
      excludeUrls: $('#excludeUrls').checked,
      anonymizeData: $('#anonymizeData').checked
    };
    await chrome.storage.sync.set({ ...base, ...extra });
  }

  async function testAPI(key, port, useHttps) {
    try {
      const protocol = useHttps ? 'https' : 'http';
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 3000);
      const r = await fetch(`${protocol}://127.0.0.1:${port}/`, {
        headers: { 'Authorization': `Bearer ${key}`, 'Accept': 'application/json' },
        signal: c.signal
      });
      clearTimeout(t);
      return r.ok;
    } catch { return false; }
  }

  function setStatus(on) {
    const dot = $('#status .dot');
    const txt = $('#status span:last-child');
    dot.className = on ? 'dot on' : 'dot off';
    txt.textContent = on ? 'Connected to Obsidian' : 'Not connected';
    $('#capturePanel').style.display = on ? 'block' : 'none';
  }

  function toast(msg, err) {
    const t = document.createElement('div');
    t.className = 'ai-brain-toast';
    t.textContent = msg;
    if (err) t.style.borderLeft = '3px solid #ef4444';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    try {
      const hosts = ['chat.openai.com','chatgpt.com','claude.ai','gemini.google.com','grok.com','x.com'];
      const ok = hosts.some(h => new URL(tab.url).hostname.includes(h));
      $('#captureBtn').disabled = !ok;
    } catch { $('#captureBtn').disabled = true; }
  });
})();