// js/markdown.js
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(url) {
  const clean = String(url || '').trim();
  if (/^(https?:|mailto:)/i.test(clean)) return clean;
  return '#';
}

function ensureTokenStyles() {
  if (document.getElementById('mdTokenStyles')) return;
  const style = document.createElement('style');
  style.id = 'mdTokenStyles';
  style.textContent = `
    .tok-k { color: #c084fc; }
    .tok-s { color: #86efac; }
    .tok-n { color: #fbbf24; }
    .tok-c { color: #64748b; font-style: italic; }
    html[data-theme="light"] .tok-k { color: #7c3aed; }
    html[data-theme="light"] .tok-s { color: #15803d; }
    html[data-theme="light"] .tok-n { color: #b45309; }
    html[data-theme="light"] .tok-c { color: #94a3b8; }
  `;
  document.head.appendChild(style);
}

const TOKEN_PATTERN = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(\d+(?:\.\d+)?)\b|\b(function|const|let|var|if|else|for|while|return|import|from|export|default|class|new|await|async|try|catch|finally|throw|switch|case|break|continue|typeof|instanceof|def|print|lambda|None|True|False|in|not|and|or|elif|except|with|as|pass|raise|yield|global|assert|del|is|public|private|protected|static|void|int|string|bool|float|double|struct|interface|implements|extends|super|this|null|undefined|true|false)\b/g;

export function highlightCode(code) {
  ensureTokenStyles();
  let out = '';
  let last = 0;
  for (const match of code.matchAll(TOKEN_PATTERN)) {
    out += escapeHtml(code.slice(last, match.index));
    const [full, comment, str, num, keyword] = match;
    if (comment) out += `<span class="tok-c">${escapeHtml(comment)}</span>`;
    else if (str) out += `<span class="tok-s">${escapeHtml(str)}</span>`;
    else if (num) out += `<span class="tok-n">${escapeHtml(num)}</span>`;
    else if (keyword) out += `<span class="tok-k">${escapeHtml(keyword)}</span>`;
    else out += escapeHtml(full);
    last = match.index + full.length;
  }
  out += escapeHtml(code.slice(last));
  return out;
}

function inline(text, parts) {
  let out = String(text);
  out = out.replace(/`([^`]+)`/g, (m, code) => {
    parts.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${parts.length - 1}\u0000`;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    parts.push(`<a href="${safeUrl(url)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`);
    return `\u0000${parts.length - 1}\u0000`;
  });
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, url) => {
    parts.push(`<a href="${safeUrl(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>`);
    return `${pre}\u0000${parts.length - 1}\u0000`;
  });
  out = escapeHtml(out);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/\u0000(\d+)\u0000/g, (m, idx) => parts[Number(idx)]);
  return out;
}

export function renderMarkdown(source) {
  const wrap = document.createElement('div');
  wrap.className = 'viewer-text';
  const text = String(source || '');
  if (!text.trim()) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = '(متنی ثبت نشده)';
    wrap.appendChild(p);
    return wrap;
  }
  const parts = [];
  const lines = text.split(/\r?\n/);
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const p = document.createElement('p');
    p.dir = 'auto';
    p.innerHTML = inline(paragraph.join('\n'), parts);
    wrap.appendChild(p);
    paragraph = [];
  };
  const flushList = () => {
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^```([\w+-]*)\s*$/);
    if (fence) {
      flushParagraph();
      flushList();
      const buffer = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buffer.push(lines[i]);
        i++;
      }
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.innerHTML = highlightCode(buffer.join('\n'));
      pre.appendChild(code);
      wrap.appendChild(pre);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const h = document.createElement(`h${heading[1].length}`);
      h.innerHTML = inline(heading[2], parts);
      wrap.appendChild(h);
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      flushParagraph();
      flushList();
      wrap.appendChild(document.createElement('hr'));
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      const block = document.createElement('blockquote');
      block.innerHTML = inline(quote[1], parts);
      wrap.appendChild(block);
      continue;
    }
    const task = line.match(/^\s*[-*]\s+\[( |x)\]\s+(.*)$/i);
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (task || ul || ol) {
      flushParagraph();
      const wanted = ol ? 'ol' : 'ul';
      if (!list || list.tagName.toLowerCase() !== wanted) {
        flushList();
        list = document.createElement(wanted);
        wrap.appendChild(list);
      }
      const li = document.createElement('li');
      if (task) {
        const checked = task[1].toLowerCase() === 'x';
        li.innerHTML = `<input type="checkbox" disabled${checked ? ' checked' : ''}> ${inline(task[2], parts)}`;
      } else {
        li.innerHTML = inline((ul || ol)[1], parts);
      }
      list.appendChild(li);
      continue;
    }
    if (list) flushList();
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return wrap;
}