// js/viewer.js
import {
  $,
  defaultTitle,
  formatDate,
  formatSize,
  copyTextToClipboard,
  downloadBlob,
  toast
} from './utils.js';
import { getAttachmentBlob, softDeleteItem, togglePinned } from './repo.js';
import { getItemById } from './state.js';
import { renderMarkdown } from './markdown.js';
import { importanceBadge, kindBadges, render, openFolder } from './render.js';
import { openEditor } from './editor.js';

let viewerItemId = null;
let objectUrls = [];

function trackUrl(url) {
  objectUrls.push(url);
  return url;
}

function clearViewerMedia() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls = [];
  $('#viewerContent').innerHTML = '';
}

export function openFolderGuard(item) {
  if (item.kind === 'folder') {
    openFolder(item.id);
    return;
  }
  openViewer(item.id);
}

function viewerCopyText(item) {
  if ((item.content || '').trim()) return item.content;
  const links = (item.attachments || []).filter(att => att.kind === 'link').map(att => att.url || '');
  return links.join('\n');
}

async function buildViewerContent(item) {
  const content = $('#viewerContent');
  content.innerHTML = '';
  const copyBtn = $('#viewerCopyBtn');
  const downloadBtn = $('#viewerDownloadBtn');
  const openLinkBtn = $('#viewerOpenLinkBtn');
  copyBtn.hidden = !viewerCopyText(item);
  const fileAtts = (item.attachments || []).filter(att => att.kind !== 'link');
  downloadBtn.hidden = fileAtts.length === 0;
  const firstLink = (item.attachments || []).find(att => att.kind === 'link');
  openLinkBtn.hidden = !firstLink;
  if (firstLink) openLinkBtn.href = firstLink.url || '#';
  if ((item.content || '').trim()) {
    content.appendChild(renderMarkdown(item.content));
  }
  for (const att of item.attachments || []) {
    if (att.kind === 'link') {
      const a = document.createElement('a');
      a.className = 'viewer-link';
      a.dir = 'ltr';
      a.href = att.url || '#';
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = att.url || '';
      content.appendChild(a);
      continue;
    }
    let record = null;
    try {
      record = await getAttachmentBlob(att.id, att);
    } catch {}
    if (att.kind === 'image') {
      const img = document.createElement('img');
      img.className = 'viewer-img';
      img.alt = item.title || att.name || 'تصویر';
      const blob = record?.original || record?.thumb;
      if (blob) img.src = trackUrl(URL.createObjectURL(blob));
      content.appendChild(img);
    } else if (att.kind === 'audio' || att.kind === 'video') {
      const player = document.createElement(att.kind);
      player.controls = true;
      if (att.kind === 'video') player.playsInline = true;
      if (record?.original) player.src = trackUrl(URL.createObjectURL(record.original));
      content.appendChild(player);
    } else {
      const div = document.createElement('div');
      div.className = 'file-info';
      div.textContent = `📎 ${att.name || 'فایل'} — ${formatSize(att.size || 0)}${att.mime ? ` · ${att.mime}` : ''}`;
      content.appendChild(div);
    }
  }
  if (!(item.content || '').trim() && !(item.attachments || []).length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = '(این آیتم محتوایی ندارد)';
    content.appendChild(p);
  }
}

export async function openViewer(id) {
  const item = getItemById(id);
  if (!item) {
    toast('آیتم پیدا نشد', 'error');
    return;
  }
  if (item.kind === 'folder') {
    openFolder(id);
    return;
  }
  viewerItemId = id;
  clearViewerMedia();
  $('#viewerTitle').textContent = defaultTitle(item);
  const pinBtn = $('#viewerPinBtn');
  pinBtn.textContent = item.pinned ? '📌 پین شده' : '📌 پین';
  pinBtn.classList.toggle('primary', !!item.pinned);
  const badges = $('#viewerBadges');
  badges.innerHTML = '';
  badges.appendChild(kindBadges(item));
  badges.appendChild(importanceBadge(item.importance));
  const meta = $('#viewerMeta');
  meta.innerHTML = '';
  const created = document.createElement('span');
  created.textContent = `ساخت: ${formatDate(item.createdAt)}`;
  const updated = document.createElement('span');
  updated.textContent = `ویرایش: ${formatDate(item.updatedAt)}`;
  meta.append(created, updated);
  const totalSize = (item.attachments || []).reduce((sum, att) => sum + (att.size || 0), 0);
  if (totalSize) {
    const size = document.createElement('span');
    size.textContent = formatSize(totalSize);
    meta.appendChild(size);
  }
  const tags = $('#viewerTags');
  tags.innerHTML = '';
  tags.hidden = !(item.tags || []).length;
  (item.tags || []).forEach(tag => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = '#' + tag;
    tags.appendChild(chip);
  });
  await buildViewerContent(item);
  $('#viewerDialog').showModal();
}

$('#viewerCloseBtn').addEventListener('click', () => $('#viewerDialog').close());
$('#viewerDialog').addEventListener('close', () => {
  clearViewerMedia();
  viewerItemId = null;
});
$('#viewerDialog').addEventListener('click', (event) => {
  if (event.target === $('#viewerDialog')) $('#viewerDialog').close();
});
$('#viewerEditBtn').addEventListener('click', () => {
  const id = viewerItemId;
  $('#viewerDialog').close();
  if (id != null) openEditor(id);
});
$('#viewerCopyBtn').addEventListener('click', async () => {
  const item = getItemById(viewerItemId);
  if (!item) return;
  try {
    await copyTextToClipboard(viewerCopyText(item));
    toast('کپی شد');
  } catch {
    toast('کپی ممکن نشد', 'error');
  }
});
$('#viewerDownloadBtn').addEventListener('click', async () => {
  const item = getItemById(viewerItemId);
  if (!item) return;
  try {
    const fileAtts = (item.attachments || []).filter(att => att.kind !== 'link');
    for (const att of fileAtts) {
      const record = await getAttachmentBlob(att.id, att);
      if (record?.original) {
        downloadBlob(record.original, att.name || 'file');
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
    toast('دانلود شروع شد');
  } catch {
    toast('دانلود فایل ممکن نشد', 'error');
  }
});
$('#viewerPinBtn').addEventListener('click', async () => {
  const id = viewerItemId;
  if (id == null) return;
  try {
    const updated = await togglePinned(id);
    const pinBtn = $('#viewerPinBtn');
    pinBtn.textContent = updated.pinned ? '📌 پین شده' : '📌 پین';
    pinBtn.classList.toggle('primary', !!updated.pinned);
    render();
    toast(updated.pinned ? 'پین شد' : 'پین برداشته شد');
  } catch {
    toast('خطا در پین', 'error');
  }
});
$('#viewerDeleteBtn').addEventListener('click', async () => {
  const id = viewerItemId;
  if (id == null) return;
  try {
    await softDeleteItem(id);
    $('#viewerDialog').close();
    render();
    toast('آیتم به سطل زباله منتقل شد');
  } catch {
    toast('خطا در انتقال به سطل زباله', 'error');
  }
});
