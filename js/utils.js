// js/utils.js
export const $ = (selector) => document.querySelector(selector);
export const $$ = (selector) => [...document.querySelectorAll(selector)];

export const KIND_LABELS = {
  text: 'متن',
  image: 'تصویر',
  audio: 'صدا',
  video: 'ویدیو',
  file: 'فایل',
  link: 'لینک',
  folder: 'پوشه'
};

export const KIND_ICONS = {
  text: '📝',
  image: '🖼️',
  audio: '🎵',
  video: '🎬',
  file: '📎',
  link: '🔗',
  folder: '📁'
};

export function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function formatSize(bytes) {
  if (!bytes) return '۰ بایت';
  const units = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت'];
  let value = Number(bytes);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toLocaleString('fa-IR', { maximumFractionDigits: 1 })} ${units[index]}`;
}

export function formatDate(dateString) {
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(dateString));
  } catch {
    return '';
  }
}

export function parseTags(value) {
  return [...new Set(
    String(value || '')
      .split(/[,،\n]+/)
      .map(tag => tag.trim())
      .filter(Boolean)
  )];
}

export function fileKind(file) {
  if (!file || !file.type) return 'file';
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  return 'file';
}

export function normalizeText(value) {
  return String(value || '').toLowerCase().trim();
}

export function parseQuery(raw) {
  const parsed = { terms: [], neg: [], tags: [], types: [], importance: '' };
  const tokens = String(raw || '').match(/"([^"]*)"|\S+/g) || [];
  for (const token of tokens) {
    const clean = token.startsWith('"') && token.endsWith('"') ? token.slice(1, -1) : token;
    const lower = clean.toLowerCase();
    if (lower.startsWith('tag:')) {
      const value = clean.slice(4).trim();
      if (value) parsed.tags.push(value.toLowerCase());
      continue;
    }
    if (lower.startsWith('type:')) {
      const value = clean.slice(5).trim();
      if (value) parsed.types.push(value.toLowerCase());
      continue;
    }
    if (lower.startsWith('imp:') || lower.startsWith('importance:')) {
      const value = clean.split(':')[1];
      if (value) parsed.importance = value;
      continue;
    }
    if (clean.startsWith('-') && clean.length > 1) {
      parsed.neg.push(normalizeText(clean.slice(1)));
      continue;
    }
    parsed.terms.push(normalizeText(clean));
  }
  return parsed;
}

export function itemKinds(item) {
  const kinds = new Set();
  for (const att of item.attachments || []) kinds.add(att.kind);
  if ((item.content || '').trim()) kinds.add('text');
  return kinds;
}

export function itemSearchText(item) {
  const parts = [item.title, item.content];
  for (const att of item.attachments || []) parts.push(att.name, att.url);
  parts.push((item.tags || []).join(' '));
  return parts.map(normalizeText).join(' ');
}

export function itemMatchesQuery(item, parsed) {
  const text = itemSearchText(item);
  for (const term of parsed.terms) {
    if (!text.includes(term)) return false;
  }
  for (const term of parsed.neg) {
    if (term && text.includes(term)) return false;
  }
  if (parsed.tags.length) {
    const tags = (item.tags || []).map(tag => tag.toLowerCase());
    for (const tag of parsed.tags) {
      if (!tags.includes(tag)) return false;
    }
  }
  if (parsed.types.length) {
    const kinds = itemKinds(item);
    for (const type of parsed.types) {
      if (!kinds.has(type)) return false;
    }
  }
  if (parsed.importance && String(item.importance) !== String(parsed.importance)) return false;
  return true;
}

export function defaultTitle(item) {
  if (item.title && item.title.trim()) return item.title.trim();
  const att = (item.attachments || [])[0];
  if (att) {
    if (att.kind === 'link' && att.url) {
      try {
        return new URL(att.url).hostname;
      } catch {
        return att.url;
      }
    }
    if (att.name) return att.name;
  }
  if (item.kind === 'folder') return 'پوشه بدون نام';
  return 'بدون عنوان';
}

export function toast(message, type = 'info') {
  const area = document.querySelector('#toastArea');
  if (!area) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  area.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, 3500);
}

export async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function dataURLToBlob(dataURL) {
  const [meta, base64] = String(dataURL).split(',');
  const mime = meta.match(/data:(.*?)(;|$)/)?.[1] || 'application/octet-stream';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'file';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}