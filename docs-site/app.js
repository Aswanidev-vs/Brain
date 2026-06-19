/* ============================================================ */
/*  Brain — minimal interactions                                  */
/*  · copy buttons                                                */
/*  · light syntax tinting                                        */
/* ============================================================ */

(() => {

  /* ---------- copy buttons ---------- */

  document.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const block = btn.closest('.codeblock');
      const code = block?.querySelector('pre code') || block?.querySelector('pre');
      if (!code) return;
      const text = code.textContent;

      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        ta.remove();
      }

      const original = btn.textContent;
      btn.textContent = 'copied';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('copied');
      }, 1400);
    });
  });

  /* ---------- light syntax tinting (very minimal) ---------- */

  const tint = (root) => {
    const code = root.querySelector('pre code') || root.querySelector('pre');
    if (!code || code.dataset.tinted) return;
    code.dataset.tinted = '1';

    let html = code.innerHTML;

    // 1. block comments  /* ... */
    html = html.replace(/\/\*[\s\S]*?\*\//g, m => `<span class="tok-com">${m}</span>`);
    // 2. line comments  // ...
    html = html.replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => `${p1}<span class="tok-com">${m.slice(p1.length)}</span>`);
    // 3. strings (backtick, double, single)
    html = html.replace(/(`[^`]*`|"[^"]*"|'[^']*')/g, m => `<span class="tok-str">${m}</span>`);
    // 4. numbers
    html = html.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="tok-num">$1</span>');
    // 5. keywords
    const kws = /\b(const|let|var|function|return|if|else|for|while|async|await|new|true|false|null|undefined|export|import|from|class|extends|try|catch|throw|typeof|instanceof|in|of|do|switch|case|break|continue|default|void)\b/g;
    html = html.replace(kws, '<span class="tok-kw">$1</span>');

    code.innerHTML = html;
  };

  document.querySelectorAll('.codeblock').forEach(tint);

})();
