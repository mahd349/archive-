// js/repo.js
import {
  getAllRawItems,
  putRawItem,
  deleteRawItem,
  getRawBlob,
  putRawBlob,
  deleteRawBlob,
  clearRawAll
} from './db.js';
import {
  encryptJSON,
  decryptJSON,
  encryptBlob,
  decryptBlob,
  deriveAesKey
} from './crypto.js';
import {
  settings,
  saveSettings,
  getCryptoKey,
  setCryptoKey,
  verifyPassword,
  getAllItems,
  setAllItems,
  replaceLocalItem,
  removeLocalItem
} from './state.js';
import { blobToDataURL, dataURLToBlob, downloadBlob } from './utils.js';

let idNonce = 0;

export function makeUniqueId() {
  const taken = new Set();
  for (const item of getAllItems()) {
    taken.add(item.id);
    for (const att of item.attachments || []) taken.add(att.id);
  }
  const base = Date.now() * 100;
  let id;
  do {
    id = base + (idNonce++);
  } while (taken.has(id));
  return id;
}

export function normalizeItem(record) {
  return {
    kind: record.kind === 'folder' ? 'folder' : 'item',
    id: record.id,
    title: record.title || '',
    content: record.content || '',
    tags: Array.isArray(record.tags) ? record.tags : [],
    importance: Number(record.importance) || 3,
    parentId: record.parentId ?? null,
    attachments: Array.isArray(record.attachments) ? record.attachments : [],
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: record.updatedAt || record.createdAt || new Date().toISOString(),
    isDeleted: !!record.isDeleted,
    deletedAt: record.deletedAt || null,
    pinned: !!record.pinned
  };
}

function isLegacyRecord(record) {
  return !!record && record.kind === undefined && record.type !== undefined;
}

export function migrateLegacyRecord(record) {
  if (!isLegacyRecord(record)) return null;
  const type = record.type;
  const attachments = [];
  if (record.hasFile && ['image', 'file', 'audio', 'video'].includes(type)) {
    attachments.push({
      id: record.id,
      kind: type,
      name: record.fileName || '',
      mime: record.mimeType || '',
      size: record.fileSize || 0,
      hasThumb: !!record.hasThumb,
      width: record.thumbWidth || 0,
      height: record.thumbHeight || 0
    });
  }
  if (type === 'link' && record.url) {
    attachments.push({ id: record.id, kind: 'link', name: record.url, url: record.url });
  }
  let content = '';
  if (type === 'text') content = record.content || '';
  if (type === 'code') content = '```' + (record.language || '') + '\n' + (record.content || '') + '\n```';
  if (record.note) content = content ? record.note + '\n\n' + content : record.note;
  return normalizeItem({ ...record, kind: 'item', content, attachments });
}

export async function putItem(item) {
  if (item.id == null) item.id = makeUniqueId();
  const key = getCryptoKey();
  if (settings.encryptionEnabled && key) {
    const cipher = await encryptJSON(item, key);
    await putRawItem({ id: item.id, cipher });
  } else {
    await putRawItem(item);
  }
  return item.id;
}

export async function putAttachmentBlob(attId, original, thumb) {
  const key = getCryptoKey();
  if (settings.encryptionEnabled && key) {
    const encOriginal = original ? await encryptBlob(original, key) : null;
    const encThumb = thumb ? await encryptBlob(thumb, key) : null;
    await putRawBlob({
      id: attId,
      encrypted: true,
      original: encOriginal,
      thumb: encThumb,
      originalMime: original?.type || '',
      thumbMime: thumb?.type || ''
    });
  } else {
    await putRawBlob({ id: attId, original: original || null, thumb: thumb || null });
  }
}

export async function getAttachmentBlob(attId, att = null) {
  const record = await getRawBlob(attId);
  if (!record) return null;
  const key = getCryptoKey();
  if (record.encrypted) {
    if (!key) return null;
    const original = record.original
      ? await decryptBlob(record.original, record.originalMime || att?.mime || 'application/octet-stream', key)
      : null;
    const thumb = record.thumb
      ? await decryptBlob(record.thumb, record.thumbMime || 'image/webp', key)
      : null;
    return { original, thumb };
  }
  return { original: record.original || null, thumb: record.thumb || null };
}

export async function loadAllItems() {
  const rawItems = await getAllRawItems();
  const key = getCryptoKey();
  const items = [];
  let migrated = 0;
  for (const record of rawItems) {
    if (!record) continue;
    let data = record;
    if (record.cipher) {
      if (!key) continue;
      try {
        data = await decryptJSON(record.cipher, key);
      } catch (err) {
        console.error('decrypt item failed', err);
        continue;
      }
    }
    const moved = migrateLegacyRecord(data);
    if (moved) {
      data = moved;
      migrated++;
      try {
        await putItem(moved);
      } catch (err) {
        console.error('migration write-back failed', err);
      }
    }
    items.push(normalizeItem(data));
  }
  setAllItems(items);
  return { items, migrated };
}

export async function removeItemBlobs(item) {
  for (const att of item.attachments || []) {
    if (att.kind === 'link') continue;
    await deleteRawBlob(att.id);
  }
}

export async function permanentDeleteItem(id) {
  const item = getAllItems().find(x => x.id === id);
  if (!item) throw new Error('آیتم پیدا نشد.');
  await removeItemBlobs(item);
  await deleteRawItem(id);
  removeLocalItem(id);
}

export async function softDeleteItem(id) {
  const old = getAllItems().find(x => x.id === id);
  if (!old) throw new Error('آیتم پیدا نشد.');
  const updated = { ...old, isDeleted: true, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await putItem(updated);
  replaceLocalItem(updated);
  return updated;
}

export async function restoreItem(id) {
  const old = getAllItems().find(x => x.id === id);
  if (!old) throw new Error('آیتم پیدا نشد.');
  const updated = { ...old, isDeleted: false, deletedAt: null, updatedAt: new Date().toISOString() };
  await putItem(updated);
  replaceLocalItem(updated);
  return updated;
}

export async function togglePinned(id) {
  const old = getAllItems().find(x => x.id === id);
  if (!old) throw new Error('آیتم پیدا نشد.');
  const updated = { ...old, pinned: !old.pinned, updatedAt: new Date().toISOString() };
  await putItem(updated);
  replaceLocalItem(updated);
  return updated;
}

export async function createFolder({ title, parentId = null, tags = [] }) {
  const now = new Date().toISOString();
  const folder = normalizeItem({
    id: makeUniqueId(),
    kind: 'folder',
    title,
    tags,
    parentId,
    createdAt: now,
    updatedAt: now
  });
  await putItem(folder);
  return folder;
}

async function collectPlainBlobs(item, key) {
  const result = [];
  for (const att of item.attachments || []) {
    if (att.kind === 'link') continue;
    const record = await getRawBlob(att.id);
    if (!record) continue;
    let original = null;
    let thumb = null;
    if (record.encrypted) {
      if (!key) continue;
      original = record.original ? await decryptBlob(record.original, record.originalMime || att.mime, key) : null;
      thumb = record.thumb ? await decryptBlob(record.thumb, record.thumbMime || 'image/webp', key) : null;
    } else {
      original = record.original || null;
      thumb = record.thumb || null;
    }
    result.push({ att, original, thumb });
  }
  return result;
}

export async function encryptAllWithKey(key) {
  for (const item of getAllItems()) {
    for (const { att, original, thumb } of await collectPlainBlobs(item, null)) {
      if (!original && !thumb) continue;
      const encOriginal = original ? await encryptBlob(original, key) : null;
      const encThumb = thumb ? await encryptBlob(thumb, key) : null;
      await putRawBlob({
        id: att.id,
        encrypted: true,
        original: encOriginal,
        thumb: encThumb,
        originalMime: original?.type || att.mime || '',
        thumbMime: thumb?.type || 'image/webp'
      });
    }
    const cipher = await encryptJSON(item, key);
    await putRawItem({ id: item.id, cipher });
  }
}

export async function reencryptAll(oldKey, newKey) {
  for (const item of getAllItems()) {
    for (const { att, original, thumb } of await collectPlainBlobs(item, oldKey)) {
      const encOriginal = original ? await encryptBlob(original, newKey) : null;
      const encThumb = thumb ? await encryptBlob(thumb, newKey) : null;
      await putRawBlob({
        id: att.id,
        encrypted: true,
        original: encOriginal,
        thumb: encThumb,
        originalMime: original?.type || att.mime || '',
        thumbMime: thumb?.type || 'image/webp'
      });
    }
    const cipher = await encryptJSON(item, newKey);
    await putRawItem({ id: item.id, cipher });
  }
}

export async function decryptAllToPlain(oldKey) {
  for (const item of getAllItems()) {
    for (const { att, original, thumb } of await collectPlainBlobs(item, oldKey)) {
      await putRawBlob({ id: att.id, original, thumb });
    }
    await putRawItem(item);
  }
}

export async function enableEncryption(password) {
  if (!window.crypto?.subtle) throw new Error('مرورگر از رمزنگاری پشتیبانی نمی‌کند.');
  const salt = randomSaltHexLocal();
  const iterations = 120000;
  const key = await deriveAesKey(password, salt, iterations);
  const hash = await hashPasswordLocal(password, salt, iterations);
  await encryptAllWithKey(key);
  setCryptoKey(key);
  settings.encryptionEnabled = true;
  settings.salt = salt;
  settings.hash = hash;
  settings.iterations = iterations;
  saveSettings();
}

export async function changeEncryptionPassword(currentPassword, newPassword) {
  const ok = await verifyPassword(currentPassword);
  if (!ok) throw new Error('رمز فعلی اشتباه است.');
  const oldKey = getCryptoKey() || await deriveAesKey(currentPassword, settings.salt, settings.iterations);
  const newSalt = randomSaltHexLocal();
  const newIterations = 120000;
  const newKey = await deriveAesKey(newPassword, newSalt, newIterations);
  const newHash = await hashPasswordLocal(newPassword, newSalt, newIterations);
  await reencryptAll(oldKey, newKey);
  setCryptoKey(newKey);
  settings.salt = newSalt;
  settings.hash = newHash;
  settings.iterations = newIterations;
  saveSettings();
}

export async function disableEncryption(currentPassword) {
  const ok = await verifyPassword(currentPassword);
  if (!ok) throw new Error('رمز فعلی اشتباه است.');
  const oldKey = getCryptoKey() || await deriveAesKey(currentPassword, settings.salt, settings.iterations);
  await decryptAllToPlain(oldKey);
  setCryptoKey(null);
  settings.encryptionEnabled = false;
  settings.salt = null;
  settings.hash = null;
  saveSettings();
}

import { randomSaltHex as randomSaltHexLocal, hashPassword as hashPasswordLocal } from './crypto.js';

export async function exportBackup() {
  const payload = {
    app: 'personal-archive',
    version: 3,
    exportedAt: new Date().toISOString(),
    items: getAllItems().map(item => ({ ...item })),
    blobs: {}
  };
  for (const item of getAllItems()) {
    for (const att of item.attachments || []) {
      if (att.kind === 'link') continue;
      const record = await getAttachmentBlob(att.id, att);
      if (!record || (!record.original && !record.thumb)) continue;
      payload.blobs[att.id] = {
        original: record.original ? await blobToDataURL(record.original) : null,
        thumb: record.thumb ? await blobToDataURL(record.thumb) : null
      };
    }
  }
  const json = JSON.stringify(payload);
  downloadBlob(new Blob([json], { type: 'application/json' }), `archive-backup-${new Date().toISOString().slice(0, 10)}.json`);
}

export async function importBackup(file) {
  const data = JSON.parse(await file.text());
  if (!data || !Array.isArray(data.items)) throw new Error('فایل پشتیبان معتبر نیست.');
  const items = [];
  const blobs = {};
  if (data.version === 3) {
    for (const record of data.items) items.push(normalizeItem(record));
    for (const [attId, entry] of Object.entries(data.blobs || {})) {
      blobs[attId] = {
        original: entry.original ? dataURLToBlob(entry.original) : null,
        thumb: entry.thumb ? dataURLToBlob(entry.thumb) : null
      };
    }
  } else {
    for (const record of data.items) {
      const { originalData, thumbData, ...meta } = record;
      const moved = migrateLegacyRecord(meta);
      const item = moved || normalizeItem(meta);
      if (originalData) {
        const attId = item.attachments[0]?.id ?? item.id;
        if (!item.attachments.length) {
          item.attachments.push({ id: attId, kind: 'file', name: item.title || 'فایل', mime: '', size: 0, hasThumb: false });
        }
        blobs[attId] = {
          original: dataURLToBlob(originalData),
          thumb: thumbData ? dataURLToBlob(thumbData) : null
        };
      }
      items.push(item);
    }
  }
  for (const item of items) {
    if (item.id == null) item.id = makeUniqueId();
  }
  await clearRawAll();
  setAllItems(items);
  for (const item of items) await putItem(item);
  for (const [attId, entry] of Object.entries(blobs)) {
    if (entry.original || entry.thumb) await putAttachmentBlob(attId, entry.original, entry.thumb);
  }
}
