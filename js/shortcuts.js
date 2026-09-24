// js/shortcuts.js
import { $, defaultTitle, itemSearchText, normalizeText } from './utils.js';
import { settings, saveSettings, applyTheme, getAllItems } from './state.js';
import { openFolder, clearFilters } from './render.js';
import { openViewer } from './viewer.js';
import { openEditor } from './editor.js';
import { openSettings } from './settings.js';

let paletteOverlay = null;
let paletteInput = null;
let paletteList = null;
let paletteItems = [];
let paletteIndex = 0;
let paletteOpen = false;
let helpDialog = null;

const PALETTE_STYLES = `
#paletteOverlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: rgba(0, 0, 0, .45);
  display: flex;
  justify-content: center;
  padding: 12vh 16px 16px;
}
.palette {
  width: min(92vw, 560px);
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 1rem;
  box-shadow: var(--shadow);
  overflow: hidden;
  height: fit-content;
}
.palette input {
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 14px 16px;
  font-size: 1rem;
}
.palette input:focus { box-shadow: none; }
.palette-list {
  list-style: none;
  margin: 0;
  padding: 6px;
  overflow: auto;
  display: grid;
  gap: 2px;
}
.palette-item {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border-radius: .7rem;
  cursor: pointer;
}
.palette-item.selected { background: var(--surface2); }
.palette-item .hint { color: var(--muted); font-size: .75rem; white-space: nowrap; }
.help-table { display: grid; gap: 8px; }
.help-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: .8rem;
  background: var(--surface2);
  font-size: .9rem;
  align-items: center;
}
.help-row kbd {
  font-family: Consolas, Monaco, monospace;
  background: var(--surface);
  border: 1px solid var(--border);
  border-bottom-width: 2px;
  border-radius: .4rem;
  padding: 2px 7px;
  direction: ltr;
}
`;

function ensureStyles() {
  if (document.getElementById('paletteStyles')) return;
  const style = document.createElement('style');
  style.id = 'paletteStyles';
  style.textContent = PALETTE_STYLES;
  document.head.appendChild(style);
}

export function toggleTheme() {
  settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
  saveSettings();
  applyTheme();
}

const SHORTCUT_ROWS = [
  ['Ctrl + K', 'باز/بستن Command Palette'],
  ['/', 'فوکوس روی جستجو'],
  ['N', 'آیتم جدید'],
  ['Shift + N', 'پوشه جدید'],
  ['T', 'تغییر تم روشن/تاریک'],
  ['?', 'همین راهنما'],
  ['Ctrl + Enter', 'ذخیره در صفحه نوشتن'],
  ['Esc', 'بستن دیالوگ‌ها / Palette']
];

function openHelp() {
  ensureStyles();
  if (!helpDialog) {
    helpDialog = document.createElement('dialog');
    const form = document.createElement('form');
    form.className = 'dialog';
    form.method = 'dialog';
    const header = document.createElement('header');
    header.className = 'dialog-header';
    const title = document.createElement('h2');
    title.textContent = 'میان‌برهای صفحه‌کلید';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'icon-btn';
    closeBtn.type = 'submit';
    closeBtn.setAttribute('aria-label', 'بستن');
    closeBtn.textContent = '✕';
    header.append(title, closeBtn);
    const body = document.createElement('div');
    body.className = 'dialog-body';
    const table = document.createElement('div');
    table.className = 'help-table';
    for (const [keys, description] of SHORTCUT_ROWS) {
      const row = document.createElement('div');
      row.className = 'help-row';
      const kbd = document.createElement('kbd');
      kbd.textContent = keys;
      const desc = document.createElement('span');
      desc.textContent = description;
      row.append(kbd, desc);
      table.appendChild(row);
    }
    body.appendChild(table);
    form.append(header, body);
    helpDialog.appendChild(form);
    document.body.appendChild(helpDialog);
  }
  helpDialog.showModal();
}

function renderPaletteList() {
  paletteList.innerHTML = '';
  paletteItems.forEach((command, index) => {
    const li = document.createElement('li');
    li.className = 'palette-item' + (index === paletteIndex ? ' selected' : '');
    const label = document.createElement('span');
    label.textContent = command.label;
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = command.hint || '';
    li.append(label, hint);
    li.addEventListener('click', () => {
      paletteIndex = index;
      runSelectedCommand();
    });
    paletteList.appendChild(li);
  });
  paletteList.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
}

function buildCommands(query) {
  const q = normalizeText(query);
  const commands = [];
  const staticCommands = [
    { label: 'افزودن آیتم جدید', hint: 'N', run: () => openEditor() },
    { label: 'ساخت پوشه جدید', hint: 'Shift+N', run: () => openEditor(null, { mode: 'folder' }) },
    { label: 'باز کردن تنظیمات', hint: '', run: () => openSettings() },
    { label: 'تغییر تم روشن/تاریک', hint: 'T', run: () => toggleTheme() },
    { label: 'پاک کردن فیلترها', hint: '', run: () => clearFilters() },
    { label: 'رفتن به ریشه', hint: '', run: () => openFolder(null) },
    { label: 'میان‌برهای صفحه‌کلید', hint: '?', run: () => openHelp() }
  ];
  for (const command of staticCommands) {
    if (!q || normalizeText(command.label).includes(q)) commands.push(command);
  }
  const alive = getAllItems().filter(item => !item.isDeleted);
  if (q) {
    for (const item of alive.filter(i => i.kind === 'item')) {
      const haystack = normalizeText(`${defaultTitle(item)} ${(item.tags || []).join(' ')} ${itemSearchText(item)}`);
      if (haystack.includes(q)) {
        commands.push({ label: 'آیتم: ' + defaultTitle(item), hint: 'باز کردن', run: () => openViewer(item.id) });
      }
    }
    for (const folder of alive.filter(i => i.kind === 'folder')) {
      if (normalizeText(folder.title || '').includes(q)) {
        commands.push({ label: 'پوشه: ' + defaultTitle(folder), hint: 'رفتن', run: () => openFolder(folder.id) });
      }
    }
  } else {
    const recent = alive
      .filter(i => i.kind === 'item')
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, 5);
    for (const item of recent) {
      commands.push({ label: 'آیتم اخیر: ' + defaultTitle(item), hint: '', run: () => openViewer(item.id) });
    }
  }
  paletteItems = commands.slice(0, 14);
  paletteIndex = 0;
  renderPaletteList();
}

function ensurePalette() {
  if (paletteOverlay) return;
  ensureStyles();
  paletteOverlay = document.createElement('div');
  paletteOverlay.id = 'paletteOverlay';
  paletteOverlay.hidden = true;
  const box = document.createElement('div');
  box.className = 'palette';
  paletteInput = document.createElement('input');
  paletteInput.type = 'search';
  paletteInput.placeholder = 'فرمان یا جستجو... (Esc برای بستن)';
  paletteInput.setAttribute('aria-label', 'Command Palette');
  paletteList = document.createElement('ul');
  paletteList.className = 'palette-list';
  paletteList.setAttribute('role', 'listbox');
  box.append(paletteInput, paletteList);
  paletteOverlay.appendChild(box);
  document.body.appendChild(paletteOverlay);
  paletteOverlay.addEventListener('mousedown', (event) => {
    if (event.target === paletteOverlay) closePalette();
  });
  paletteInput.addEventListener('input', () => buildCommands(paletteInput.value));
  paletteInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      paletteIndex = Math.min(paletteItems.length - 1, paletteIndex + 1);
      renderPaletteList();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      paletteIndex = Math.max(0, paletteIndex - 1);
      renderPaletteList();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      runSelectedCommand();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closePalette();
    }
  });
}

function openPalette() {
  ensurePalette();
  paletteOpen = true;
  paletteOverlay.hidden = false;
  paletteInput.value = '';
  buildCommands('');
  paletteInput.focus();
}

function closePalette() {
  paletteOpen = false;
  if (paletteOverlay) paletteOverlay.hidden = true;
}

function runSelectedCommand() {
  const command = paletteItems[paletteIndex];
  closePalette();
  command?.run();
}

export function initShortcuts() {
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (paletteOpen) closePalette();
      else openPalette();
      return;
    }
    if (paletteOpen) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    const typing = target instanceof HTMLElement && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable
    );
    if (typing) return;
    if (!$('#lockScreen')?.hidden) return;
    if (document.body.classList.contains('composing')) return;
    if (document.querySelector('dialog[open]')) return;
    if (event.key === '/') {
      event.preventDefault();
      $('#searchInput').focus();
      return;
    }
    if (event.key === 'n') {
      event.preventDefault();
      openEditor();
      return;
    }
    if (event.key === 'N') {
      event.preventDefault();
      openEditor(null, { mode: 'folder' });
      return;
    }
    if (event.key === 't' || event.key === 'T') {
      toggleTheme();
      return;
    }
    if (event.key === '?') {
      event.preventDefault();
      openHelp();
    }
  });
}