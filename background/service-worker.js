const STOP_WORDS = new Set(['the','a','an','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','can','shall','to','of','in','for','on','with','at','by','from','as','into','through','during','before','after','above','below','between','out','off','over','under','again','further','then','once','here','there','when','where','why','how','all','both','each','few','more','most','other','some','such','no','nor','not','only','own','same','so','than','too','very','just','don','now','i','you','he','she','it','we','they','me','him','her','us','them','my','your','his','its','our','their','what','which','who','whom','this','that','these','those','am','if','about','up','also','like','much','get','got','one','two','new','make','know','take','come','think','want','need','use','using','used','try','way','back','still','even']);

const TOPIC_PATTERNS = [
  [/javascript|react|node|typescript|vue|angular/i, 'JavaScript'],
  [/python|django|flask|fastapi|pandas/i, 'Python'],
  [/api|endpoint|rest|graphql|http/i, 'API'],
  [/database|sql|mongo|postgres|mysql|redis/i, 'Database'],
  [/machine.?learning|neural|deep.?learning|model|train/i, 'Machine Learning'],
  [/css|style|layout|flexbox|grid|tailwind/i, 'CSS'],
  [/git|commit|branch|merge|pull.?request/i, 'Git'],
  [/docker|container|kubernetes|k8s|deploy/i, 'DevOps'],
  [/security|auth|encrypt|token|password/i, 'Security'],
  [/test|testing|jest|mocha|cypress|spec/i, 'Testing']
];

function extractKeywords(messages) {
  const counts = {};
  messages.forEach(m => {
    m.content.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w))
      .forEach(w => counts[w] = (counts[w] || 0) + 1);
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w]) => w);
}

function identifyTopics(messages) {
  const topics = new Set();
  messages.forEach(m => {
    TOPIC_PATTERNS.forEach(([pat, topic]) => { if (pat.test(m.content)) topics.add(topic); });
  });
  return [...topics];
}

function generateFilename(c) {
  const d = new Date(c.timestamp);
  const dateStr = d.toISOString().split('T')[0];
  const slug = c.title.replace(/[^a-z0-9\s-]/gi, '').replace(/\s+/g, '-').toLowerCase().substring(0, 50);
  return `${dateStr}-${slug}.md`;
}

function generateGraphFilename(c) {
  return generateFilename(c).replace('.md', '-graph.md');
}

function esc(text) { return text.replace(/"/g, '\\"').replace(/\n/g, ' '); }

function generateMarkdown(c, settings = {}) {
  let md = `---\ntitle: "${esc(c.title)}"\nplatform: ${c.platform}\ncaptured: ${c.timestamp}\n`;
  if (!settings.excludeUrls) md += `source_url: "${c.url}"\n`;
  md += `tags:\n  - ai-conversation\n  - ${c.platform.toLowerCase()}\n---\n\n`;
  md += `# ${esc(c.title)}\n\n**Platform:** ${c.platform}  \n**Captured:** ${new Date(c.timestamp).toLocaleString()}  \n`;
  md += settings.excludeUrls ? '\n' : `**Source:** [Original](${c.url})\n\n`;
  md += `---\n\n`;
  c.messages.forEach((m, i) => {
    const speaker = m.role === 'user' ? 'User' : c.platform;
    md += `**${speaker}:**\n\n${m.content}\n\n`;
    if (i < c.messages.length - 1) md += `---\n\n`;
  });
  md += `\n---\n*Captured with Brain Extension*`;
  return md;
}

function generateGraphNote(c) {
  const kw = extractKeywords(c.messages);
  const topics = identifyTopics(c.messages);
  let md = `---\ntype: graph-note\nsource: "${esc(c.title)}"\nplatform: ${c.platform}\ncaptured: ${c.timestamp}\nkeywords:\n`;
  kw.forEach(k => md += `  - ${k}\n`);
  md += `---\n\n# Graph: ${esc(c.title)}\n\n**Source:** [[${esc(c.title)}]]  \n**Platform:** ${c.platform}\n\n`;
  if (kw.length) { md += `## Keywords\n\n`; kw.forEach(k => md += `- [[${k}]]\n`); md += '\n'; }
  if (topics.length) { md += `## Topics\n\n`; topics.forEach(t => md += `- [[${t}]]\n`); md += '\n'; }
  return md;
}

async function createFileViaAPI(apiKey, baseUrl, path, content) {
  const url = `${baseUrl}/vault/${encodeURIComponent(path)}`;

  console.log('Brain: Creating file via API', { url });

  try {
    const checkRes = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      }
    });

    const method = checkRes.ok ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'text/markdown',
        'Accept': 'application/json'
      },
      body: content
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`${res.status}: ${errorText}`);
    }

    return true;
  } catch (e) {
    if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')) {
      throw new Error('Cannot connect to Obsidian - is it running?');
    }
    throw e;
  }
}

function createFileDownload(path, content) {
  chrome.downloads.download({
    url: 'data:text/markdown;charset=utf-8,' + encodeURIComponent(content),
    filename: path.replace(/\//g, '\\'),
    saveAs: false
  });
}

async function saveConversation(conversation) {
  const s = await chrome.storage.sync.get([
    'apiKey', 'port', 'captureFolder', 'generateGraph', 'connectionMethod',
    'excludeUrls', 'anonymizeData', 'useHttps', 'isConnected'
  ]);

  console.log('Brain: Saving conversation', { connectionMethod: s.connectionMethod, hasApiKey: !!s.apiKey, isConnected: s.isConnected });

  const folder = s.captureFolder || 'AI-Brain';
  const platformFolder = conversation.platform.toLowerCase();
  const filename = generateFilename(conversation);
  const isAPI = s.connectionMethod === 'api';

  if (!s.connectionMethod) {
    return { success: false, error: 'Not configured - open Brain extension and connect first' };
  }

  if (isAPI && !s.apiKey) return { success: false, error: 'Not connected - no API key. Open Brain extension and paste your API key.' };

  if (isAPI && !s.isConnected) return { success: false, error: 'Not connected - click Connect in Brain extension first' };

  let conv = conversation;
  if (s.anonymizeData) {
    const map = { ChatGPT: 'Model A', Claude: 'Model B', Gemini: 'Model C', Grok: 'Model D' };
    conv = { ...conversation, platform: map[conversation.platform] || 'AI Model' };
  }

  const md = generateMarkdown(conv, s);
  const graphMd = generateGraphNote(conv);

  if (isAPI) {
    const protocol = s.useHttps ? 'https' : 'http';
    const port = s.port || (s.useHttps ? 27124 : 27123);
    const baseUrl = `${protocol}://127.0.0.1:${port}`;

    console.log('Brain: Using API', { baseUrl, hasApiKey: !!s.apiKey });

    try {
      await createFileViaAPI(s.apiKey, baseUrl, `${folder}/${platformFolder}/${filename}`, md);
      if (s.generateGraph) {
        await createFileViaAPI(s.apiKey, baseUrl, `${folder}/_graphs/${generateGraphFilename(conv)}`, graphMd);
      }
    } catch (e) {
      console.error('Brain: API save failed:', e.message);
      return { success: false, error: `API error: ${e.message}` };
    }
  } else {
    createFileDownload(`${folder}/${platformFolder}/${filename}`, md);
    if (s.generateGraph) {
      createFileDownload(`${folder}/_graphs/${generateGraphFilename(conv)}`, graphMd);
    }
  }

  const data = await chrome.storage.sync.get(['captureCount']);
  await chrome.storage.sync.set({ captureCount: (data.captureCount || 0) + 1 });
  return { success: true, filename };
}

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === 'saveConversation') {
    saveConversation(req.data).then(r => sendResponse(r));
    return true;
  }
});
