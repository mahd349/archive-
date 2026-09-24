// js/app.js (version 2 — replaces the Part 4 file completely)
import { $, debounce, toast } from './utils.js';
import { openDB } from './db.js';
import { deriveAesKey } from './crypto.js';
import { loadAllItems } from './repo.js';
import {
  loadSettings,
  saveSettings,
  applyTheme,
  settings,
  state,
  verifyPassword,
  setCryptoKey,
  refreshTags
} from './state.js';
import { render, setPage, clearFilters } from './render.js';
import { openEditor } from './editor.js';
import { openSettings } from './settings.js';
import { initShortcuts, toggleTheme } from './shortcuts.js';

let dbOpened = false;

function showLock() {
  $('#app').hidden = true;
  $('#lockScreen').hidden = false;
  setTimeout(() => $('#lockPassword').focus(), 50);
}

async function startApp() {
  $('#lockScreen').hidden = true;
  $('#app').hidden = false;
  $('#status').hidden = false;
  try {
    if (!dbOpened) {
      await openDB();
      dbOpened = true;
    }
    const { migrated } = await loadAllItems();
    refreshTags();
    render();
    if (migrated > 0) {
      toast(`${new Intl.NumberFormat('fa-IR').format(migrated)} آیتم قدیمی به ساختار جدید مهاجرت کرد`);
    }
  } catch (err) {
    console.error(err);
    toast('خطا در باز کردن دیتابیس مرورگر', 'error');
  } finally {
    $('#status').hidden = true;
  }
}

function isComposing() {
  return document.body.classList.contains('composing');
}

function injectManifestLink() {
  if (document.querySelector('link[rel="manifest"]')) return;
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = 'manifest.webmanifest';
  document.head.appendChild(link);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!/^https?:$/.test(window.location.protocol)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.error('SW registration failed', err);
    });
  });
}

function bindEvents() {
  $('#addBtn').addEventListener('click', () => openEditor());
  $('#newFolderBtn').addEventListener('click', () => openEditor(null, { mode: 'folder' }));
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#themeToggleBtn').addEventListener('click', toggleTheme);
  $('#searchInput').addEventListener('input', debounce(() => {
    state.search = $('#searchInput').value;
    setPage(1);
    render();
  }, 220));
  $('#typeFilter').addEventListener('change', (event) => {
    state.type = event.target.value;
    setPage(1);
    render();
  });
  $('#tagFilter').addEventListener('change', (event) => {
    state.tag = event.target.value;
    setPage(1);
    render();
  });
  $('#importanceFilter').addEventListener('change', (event) => {
    state.importance = event.target.value;
    setPage(1);
    render();
  });
  $('#sortFilter').addEventListener('change', (event) => {
    state.sort = event.target.value;
    setPage(1);
    render();
  });
  $('#clearFiltersBtn').addEventListener('click', clearFilters);
  $('#lockForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = $('#lockPassword').value;
    $('#lockError').textContent = '';
    try {
      const ok = await verifyPassword(password);
      if (!ok) {
        $('#lockError').textContent = 'رمز اشتباه است.';
        return;
      }
      setCryptoKey(await deriveAesKey(password, settings.salt, settings.iterations));
      $('#lockPassword').value = '';
      await startApp();
    } catch {
      $('#lockError').textContent = 'خطا در باز کردن قفل.';
    }
  });
  let dragCounter = 0;
  window.addEventListener('dragenter', (event) => {
    if (isComposing() || $('#app').hidden) return;
    const types = Array.from(event.dataTransfer?.types || []);
    if (!types.includes('Files')) return;
    event.preventDefault();
    dragCounter++;
    $('#dropOverlay').hidden = false;
  });
  window.addEventListener('dragover', (event) => {
    if (isComposing() || $('#app').hidden) return;
    event.preventDefault();
  });
  window.addEventListener('dragleave', () => {
    if (isComposing() || $('#app').hidden) return;
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      $('#dropOverlay').hidden = true;
    }
  });
  window.addEventListener('drop', (event) => {
    if (isComposing() || $('#app').hidden) return;
    event.preventDefault();
    dragCounter = 0;
    $('#dropOverlay').hidden = true;
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length) openEditor(null, { presetFiles: files });
  });
  window.addEventListener('paste', (event) => {
    if (isComposing() || $('#app').hidden) return;
    const files = [...(event.clipboardData?.files || [])];
    if (files.length) {
      event.preventDefault();
      openEditor(null, { presetFiles: files });
    }
  });
}

function init() {
  loadSettings();
  applyTheme();
  injectManifestLink();
  bindEvents();
  initShortcuts();
  registerServiceWorker();
  if (settings.encryptionEnabled) showLock();
  else startApp();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}