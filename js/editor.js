// js/editor.js
import { $, debounce, fileKind, formatSize, KIND_ICONS, KIND_LABELS, parseTags, toast } from './utils.js';
import { deleteRawBlob } from './db.js';
import { encryptJSON, decryptJSON } from './crypto.js';
import {
  makeUniqueId,
  normalizeItem,
  putItem,
  putAttachmentBlob,
  createFolder,
  getAttachmentBlob
} from './repo.js';
import {
  DRAFT_KEY,
  THUMB_WIDTH,
  state,
  settings,
  getCryptoKey,
  getAllItems,
  getItemById,
  addItemLocal,
  replaceLocalItem,
  getFolderTrail
} from './state.js';
import { render, setPage } from './render.js';

let editingId = null;
let composeMode = 'item';
let pending = [];
let removedAttIds = [];
let baseAttachments = [];
let pendingDraft = null;
let tempIdSeq = 0;
const existingThumbUrls = new Map();

function bytesToBase64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToBytes(base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function setAutosave(mode) {
  const el = $('#autosaveState');
  el.className = 'autosave';
  if (mode === 'saving') el.textContent = 'در حال ذخیره خودکار…';
  else if (mode === 'saved') {
    el.textContent = 'ذخیره خودکار ✓';
    el.classList.add('is-saved');
  } else if (mode === 'error') {
    el.textContent = 'خطا در ذخیره خودکار';
    el.classList.add('is-error');
  } else el.textContent = '';
}

function formValues() {
  return {
    title: $('#fTitle').value.trim(),
    content: $('#contentInput').value,
    tags: parseTags($('#fTags').value),
    importance: Number($('#fImportance').value) || 3,
    parentId: $('#fFolder').value ? Number($('#fFolder').value) : null
  };
}

function currentDraft() {
  return {
    title: $('#fTitle').value,
    content: $('#contentInput').value,
    tags: $('#fTags').value,
    importance: $('#fImportance').value,
    parentId: $('#fFolder').value
  };
}

function draftHasContent(draft) {
  return !!draft && (
    (draft.title || '').trim() ||
    (draft.content || '').trim() ||
    (draft.tags || '').trim()
  );
}

async function saveDraftLocal() {
  const draft = currentDraft();
  try {
    const key = getCryptoKey();
    if (settings.encryptionEnabled && key) {
      const cipher = await encryptJSON(draft, key);
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ v: 3, cipher: bytesToBase64(cipher) }));
    } else {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ v: 3, plain: draft }));
    }
    setAutosave('saved');
  } catch {
    setAutosave('error');
  }
}

async function loadDraftLocal() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.cipher) {
      const key = getCryptoKey();
      if (!key) return null;
      return await decryptJSON(base64ToBytes(data.cipher), key);
    }
    return data.plain || null;
  } catch {
    return null;
  }
}

function clearDraftLocal() {
  localStorage.removeItem(DRAFT_KEY);
}

async function runAutosave() {
  if (composeMode === 'folder') return;
  if (editingId == null) {
    await saveDraftLocal();
    return;
  }
  setAutosave('saving');
  try {
    const old = getItemById(editingId);
    if (!old) return;
    const updated = { ...old, ...formValues(), updatedAt: new Date().toISOString() };
    await putItem(updated);
    replaceLocalItem(updated);
    setAutosave('saved');
  } catch {
    setAutosave('error');
  }
}

const scheduleAutosave = debounce(() => { runAutosave(); }, 900);

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve(img);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('تصویر قابل پردازش نیست.'));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(blob => resolve(blob), type, quality));
}

async function makeImageThumb(file) {
  let source;
  let width;
  let height;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
    width = source.width;
    height = source.height;
  } catch {
    source = await loadImageFromFile(file);
    width = source.naturalWidth;
    height = source.naturalHeight;
  }
  const scale = Math.min(1, THUMB_WIDTH / width);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0, w, h);
  if (source.close) source.close();
  let blob = await canvasToBlob(canvas, 'image/webp', 0.82);
  if (!blob || blob.type !== 'image/webp') blob = await canvasToBlob(canvas, 'image/jpeg', 0.82);
  if (!blob) throw new Error('ساخت بندانگشتی ممکن نشد.');
  return { blob, w, h };
}

function collectDescendantIds(folderId) {
  const out = new Set([folderId]);
  const stack = [folderId];
  while (stack.length) {
    const current = stack.pop();
    for (const item of getAllItems()) {
      if (item.kind === 'folder' && item.parentId === current && !out.has(item.id)) {
        out.add(item.id);
        stack.push(item.id);
      }
    }
  }
  return out;
}

function renderFolderOptions(selectedParentId, excludeFolderId) {
  const select = $('#fFolder');
  select.innerHTML = '';
  const root = document.createElement('option');
  root.value = '';
  root.textContent = '🏠 ریشه (بدون پوشه)';
  select.appendChild(root);
  const excluded = excludeFolderId != null ? collectDescendantIds(excludeFolderId) : new Set();
  const folders = getAllItems()
    .filter(i => i.kind === 'folder' && !i.isDeleted && !excluded.has(i.id))
    .sort((a, b) => (a.title || '').localeCompare(b.title || '', 'fa'));
  for (const folder of folders) {
    const depth = Math.max(0, getFolderTrail(folder.id).length - 1);
    const option = document.createElement('option');
    option.value = String(folder.id);
    option.textContent = '\u00A0\u00A0'.repeat(depth) + '📁 ' + (folder.title || 'بدون نام');
    select.appendChild(option);
  }
  select.value = selectedParentId != null ? String(selectedParentId) : (state.folderId ? String(state.folderId) : '');
}

async function loadExistingThumb(att, img) {
  try {
    if (existingThumbUrls.has(att.id)) {
      img.src = existingThumbUrls.get(att.id);
      return;
    }
    const record = await getAttachmentBlob(att.id, att);
    const blob = record?.thumb || (record?.original?.type?.startsWith('image/') ? record.original : null);
    if (!blob || !img.isConnected) return;
    const url = URL.createObjectURL(blob);
    existingThumbUrls.set(att.id, url);
    img.src = url;
  } catch {}
}

function renderAttachList() {
  const list = $('#attachList');
  list.innerHTML = '';
  const makeRow = ({ kind, name, size, url }, previewSource, onRemove, isExisting, key) => {
    const li = document.createElement('li');
    li.className = 'attach-item';
    const media = document.createElement('div');
    if (kind === 'image') {
      const img = document.createElement('img');
      img.className = 'attach-thumb';
      img.alt = name || 'تصویر';
      if (previewSource) img.src = previewSource;
      media.appendChild(img);
      if (isExisting) loadExistingThumb({ id: key, kind, mime: '' }, img);
    } else {
      const icon = document.createElement('div');
      icon.className = 'attach-icon';
      icon.textContent = kind === 'link' ? '🔗' : (KIND_ICONS[kind] || '📎');
      media.appendChild(icon);
    }
    const info = document.createElement('div');
    const nameDiv = document.createElement('div');
    nameDiv.className = 'attach-name';
    nameDiv.dir = 'auto';
    nameDiv.textContent = kind === 'link' ? (url || name) : (name || 'فایل');
    const metaDiv = document.createElement('div');
    metaDiv.className = 'attach-meta';
    metaDiv.textContent = `${KIND_LABELS[kind] || kind}${kind === 'link' ? '' : ' · ' + formatSize(size || 0)}`;
    info.append(nameDiv, metaDiv);
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'copy-btn';
    removeBtn.textContent = '✕';
    removeBtn.title = 'حذف پیوست';
    removeBtn.setAttribute('aria-label', `حذف پیوست ${name || ''}`);
    removeBtn.addEventListener('click', onRemove);
    li.append(media, info, removeBtn);
    list.appendChild(li);
  };
  for (const att of baseAttachments) {
    makeRow(att, null, () => {
      removedAttIds.push(att.id);
      baseAttachments = baseAttachments.filter(a => a.id !== att.id);
      renderAttachList();
    }, true, att.id);
  }
  for (const entry of pending) {
    makeRow(entry, entry.previewUrl, () => {
      if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
      if (entry.staged) deleteRawBlob(entry.attId).catch(() => {});
      pending = pending.filter(p => p.tempId !== entry.tempId);
      renderAttachList();
    }, false, entry.tempId);
  }
}

async function addFiles(fileList) {
  const files = [...fileList].filter(Boolean);
  if (!files.length) return;
  await runAutosave();
  for (const file of files) {
    const kind = fileKind(file);
    const entry = {
      tempId: ++tempIdSeq,
      attId: null,
      staged: false,
      kind,
      name: file.name || 'فایل',
      mime: file.type || '',
      size: file.size || 0,
      file,
      thumbBlob: null,
      width: 0,
      height: 0,
      url: null,
      previewUrl: null
    };
    if (kind === 'image') {
      try {
        const thumb = await makeImageThumb(file);
        entry.thumbBlob = thumb.blob;
        entry.width = thumb.w;
        entry.height = thumb.h;
        entry.previewUrl = URL.createObjectURL(thumb.blob);
      } catch {
        entry.previewUrl = URL.createObjectURL(file);
      }
    }
    entry.attId = makeUniqueId();
    await putAttachmentBlob(entry.attId, file, entry.thumbBlob);
    entry.staged = true;
    entry.file = null;
    pending.push(entry);
  }
  renderAttachList();
  setAutosave('saved');
}

function composeSectionsHidden(hidden) {
  $('#contentInput').closest('label').hidden = hidden;
  $('#attachZone').hidden = hidden;
  $('#attachList').hidden = hidden;
  $('#attachFileInput').closest('.row').hidden = hidden;
  $('#linkRow').hidden = true;
}

function resetCompose() {
  editingId = null;
  composeMode = 'item';
  for (const entry of pending) {
    if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    if (entry.staged) deleteRawBlob(entry.attId).catch(() => {});
  }
  pending = [];
  removedAttIds = [];
  baseAttachments = [];
  pendingDraft = null;
  for (const url of existingThumbUrls.values()) URL.revokeObjectURL(url);
  existingThumbUrls.clear();
  $('#fTitle').value = '';
  $('#contentInput').value = '';
  $('#fTags').value = '';
  $('#fImportance').value = '3';
  $('#attachList').innerHTML = '';
  $('#linkUrlInput').value = '';
  $('#draftBanner').hidden = true;
  setAutosave('');
}

function enterCompose() {
  $('#compose').hidden = false;
  document.body.classList.add('composing');
  window.scrollTo({ top: 0 });
  setTimeout(() => $('#fTitle').focus(), 60);
}

function exitCompose() {
  $('#compose').hidden = true;
  document.body.classList.remove('composing');
  resetCompose();
}

async function persistPending(list, attachmentsArray) {
  for (const entry of list) {
    if (entry.kind === 'link') {
      const attId = makeUniqueId();
      attachmentsArray.push({ id: attId, kind: 'link', name: entry.url, url: entry.url });
      continue;
    }
    attachmentsArray.push({
      id: entry.attId,
      kind: entry.kind,
      name: entry.name,
      mime: entry.mime,
      size: entry.size,
      hasThumb: !!entry.thumbBlob,
      width: entry.width,
      height: entry.height
    });
    if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
  }
}

async function cleanupStaged() {
  for (const entry of pending) {
    if (entry.staged) {
      try { await deleteRawBlob(entry.attId); } catch {}
    }
    if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
  }
}

async function saveItem(values) {
  const now = new Date().toISOString();
  const attachments = baseAttachments.filter(att => !removedAttIds.includes(att.id));
  if (editingId != null) {
    const old = getItemById(editingId);
    if (!old) throw new Error('آیتم پیدا نشد.');
    const updated = { ...old, ...values, attachments, updatedAt: now };
    await persistPending(pending, updated.attachments);
    try {
      await putItem(updated);
    } catch (err) {
      await cleanupStaged();
      throw err;
    }
    for (const removedId of removedAttIds) await deleteRawBlob(removedId);
    replaceLocalItem(updated);
  } else {
    const item = normalizeItem({
      id: makeUniqueId(),
      kind: 'item',
      ...values,
      attachments: [],
      createdAt: now,
      updatedAt: now
    });
    await persistPending(pending, item.attachments);
    try {
      await putItem(item);
    } catch (err) {
      await cleanupStaged();
      throw err;
    }
    addItemLocal(item);
  }
  pending = [];
  removedAttIds = [];
  baseAttachments = [];
}

async function saveFolder(values) {
  const now = new Date().toISOString();
  if (editingId != null) {
    const old = getItemById(editingId);
    if (!old || old.kind !== 'folder') throw new Error('پوشه پیدا نشد.');
    const parentId = values.parentId === old.id ? old.parentId : values.parentId;
    const updated = {
      ...old,
      title: values.title,
      tags: values.tags,
      importance: values.importance,
      parentId,
      updatedAt: now
    };
    await putItem(updated);
    replaceLocalItem(updated);
  } else {
    const folder = await createFolder({ title: values.title, parentId: values.parentId, tags: values.tags });
    addItemLocal(folder);
  }
}

let saving = false;
async function saveCompose() {
  if (saving) return;
  saving = true;
  const button = $('#composeSaveBtn');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'در حال ذخیره…';
  try {
    const values = formValues();
    if (composeMode === 'folder') await saveFolder(values);
    else await saveItem(values);
    clearDraftLocal();
    const wasFolderMode = composeMode === 'folder';
    exitCompose();
    setPage(1);
    render();
    toast(wasFolderMode ? 'پوشه ذخیره شد' : 'ذخیره شد');
  } catch (err) {
    console.error(err);
    toast(err.message || 'خطا در ذخیره', 'error');
  } finally {
    saving = false;
    button.disabled = false;
    button.textContent = label;
  }
}

function backCompose() {
  if (editingId == null && composeMode === 'item' && draftHasContent(currentDraft())) {
    saveDraftLocal();
    toast('پیش‌نویس نگه داشته شد؛ هر وقت برگشتی ادامه بده');
  }
  exitCompose();
}

export async function openEditor(id = null, options = {}) {
  resetCompose();
  composeMode = options.mode === 'folder' ? 'folder' : 'item';
  const isFolderMode = composeMode === 'folder';
  $('#composeHeading').textContent = id != null
    ? (isFolderMode ? 'ویرایش پوشه' : 'ویرایش آیتم')
    : (isFolderMode ? 'پوشه جدید' : 'آیتم جدید');
  composeSectionsHidden(isFolderMode);
  if (id != null) {
    const item = getItemById(id);
    if (!item) {
      toast('آیتم پیدا نشد', 'error');
      return;
    }
    editingId = id;
    $('#fTitle').value = item.title || '';
    $('#fImportance').value = String(item.importance ?? 3);
    $('#fTags').value = (item.tags || []).join(', ');
    renderFolderOptions(item.parentId, isFolderMode ? item.id : null);
    if (!isFolderMode) {
      $('#contentInput').value = item.content || '';
      baseAttachments = (item.attachments || []).map(att => ({ ...att }));
      renderAttachList();
    }
  } else {
    renderFolderOptions(options.parentId ?? state.folderId, null);
    if (!isFolderMode) {
      const draft = await loadDraftLocal();
      if (draftHasContent(draft)) {
        pendingDraft = draft;
        $('#draftBanner').hidden = false;
      }
      if (options.presetFiles?.length) await addFiles(options.presetFiles);
    }
  }
  enterCompose();
}

$('#composeSaveBtn').addEventListener('click', saveCompose);
$('#composeBackBtn').addEventListener('click', backCompose);
$('#contentInput').addEventListener('input', scheduleAutosave);
$('#fTitle').addEventListener('input', scheduleAutosave);
$('#fTags').addEventListener('input', scheduleAutosave);
$('#fImportance').addEventListener('change', scheduleAutosave);
$('#fFolder').addEventListener('change', scheduleAutosave);
$('#contentInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    saveCompose();
  }
});
$('#draftRestoreBtn').addEventListener('click', () => {
  if (!pendingDraft) return;
  $('#fTitle').value = pendingDraft.title || '';
  $('#contentInput').value = pendingDraft.content || '';
  $('#fTags').value = pendingDraft.tags || '';
  if (pendingDraft.importance) $('#fImportance').value = pendingDraft.importance;
  if (pendingDraft.parentId) $('#fFolder').value = pendingDraft.parentId;
  $('#draftBanner').hidden = true;
  setAutosave('saved');
});
$('#draftDiscardBtn').addEventListener('click', () => {
  pendingDraft = null;
  clearDraftLocal();
  $('#draftBanner').hidden = true;
  setAutosave('');
});
$('#attachZone').addEventListener('click', () => $('#attachFileInput').click());
$('#attachFileInput').addEventListener('change', (event) => {
  addFiles(event.target.files || []);
  event.target.value = '';
});
$('#addLinkBtn').addEventListener('click', () => {
  $('#linkRow').hidden = false;
  $('#linkUrlInput').focus();
});
$('#linkConfirmBtn').addEventListener('click', () => {
  const value = $('#linkUrlInput').value.trim();
  try {
    new URL(value);
  } catch {
    toast('آدرس لینک معتبر نیست', 'error');
    return;
  }
  pending.push({
    tempId: ++tempIdSeq,
    kind: 'link',
    name: value,
    mime: '',
    size: 0,
    file: null,
    thumbBlob: null,
    width: 0,
    height: 0,
    url: value,
    previewUrl: null
  });
  $('#linkUrlInput').value = '';
  $('#linkRow').hidden = true;
  renderAttachList();
});
const composeEl = $('#compose');
composeEl.addEventListener('dragover', (event) => {
  if (composeMode === 'folder') return;
  event.preventDefault();
  $('#attachZone').classList.add('dragover');
});
composeEl.addEventListener('dragleave', (event) => {
  if (event.relatedTarget && composeEl.contains(event.relatedTarget)) return;
  $('#attachZone').classList.remove('dragover');
});
composeEl.addEventListener('drop', (event) => {
  event.preventDefault();
  event.stopPropagation();
  $('#attachZone').classList.remove('dragover');
  if (composeMode === 'folder') return;
  addFiles(event.dataTransfer?.files || []);
});
