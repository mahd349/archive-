// js/state.js
import { $ } from './utils.js';
import { hashPassword, safeEqual } from './crypto.js';

export const PAGE_SIZE = 24;
export const THUMB_WIDTH = 400;
export const SETTINGS_KEY = 'personal-archive-settings-v2';
export const DRAFT_KEY = 'personal-archive-draft-v3';

export const settings = {
  theme: 'dark',
  encryptionEnabled: false,
  salt: null,
  hash: null,
  iterations: 120000
};

export const state = {
  search: '',
  type: '',
  tag: '',
  importance: '',
  sort: 'created_desc',
  folderId: null
};

let cryptoKey = null;
let allItems = [];
export let tagsCache = [];

export function getCryptoKey() { return cryptoKey; }
export function setCryptoKey(key) { cryptoKey = key; }

export function getAllItems() { return allItems; }
export function setAllItems(list) { allItems = list; }
export function addItemLocal(item) { allItems = [...allItems, item]; refreshTags(); }
export function replaceLocalItem(updated) { allItems = allItems.map(i => (i.id === updated.id ? updated : i)); refreshTags(); }
export function removeLocalItem(id) { allItems = allItems.filter(i => i.id !== id); refreshTags(); }
export function getItemById(id) { return allItems.find(i => i.id === id) || null; }
export function getFolderById(id) { return allItems.find(i => i.id === id && i.kind === 'folder') || null; }

export function getFolderTrail(folderId) {
  const trail = [];
  let current = getFolderById(folderId);
  while (current) {
    trail.unshift(current);
    current = current.parentId != null ? getFolderById(current.parentId) : null;
  }
  return trail;
}

export function refreshTags() {
  tagsCache = [...new Set(
    allItems
      .filter(i => !i.isDeleted && i.kind === 'item')
      .flatMap(i => i.tags || [])
  )].sort((a, b) => a.localeCompare(b, 'fa'));
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) Object.assign(settings, JSON.parse(raw));
  } catch {}
  if (!settings.iterations) settings.iterations = 120000;
  if (settings.encryptionEnabled && (!settings.salt || !settings.hash)) {
    settings.encryptionEnabled = false;
  }
}

export function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function applyTheme() {
  document.documentElement.dataset.theme = settings.theme;
  const btn = $('#themeToggleBtn');
  if (btn) btn.textContent = settings.theme === 'dark' ? '☀️' : '🌙';
}

export async function verifyPassword(password) {
  if (!settings.encryptionEnabled) return true;
  if (!settings.salt || !settings.hash) return false;
  const candidate = await hashPassword(password, settings.salt, settings.iterations || 120000);
  return safeEqual(candidate, settings.hash);
}

export function isFiltering() {
  return !!(state.search.trim() || state.type || state.tag || state.importance);
}