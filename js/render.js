// js/render.js
import {
  $,
  defaultTitle,
  formatDate,
  formatSize,
  KIND_ICONS,
  KIND_LABELS,
  copyTextToClipboard,
  itemKinds,
  itemMatchesQuery,
  parseQuery,
  toast
} from './utils.js';
import { getAttachmentBlob } from './repo.js';
import {
  PAGE_SIZE,
  state,
  tagsCache,
  getAllItems,
  getFolderTrail,
  isFiltering
} from './state.js';
import { openViewer, openFolderGuard } from './viewer.js';
import { openEditor } from './editor.js';

let currentPage = 1;
const thumbUrls = new Map();

export function setPage(page) { currentPage = page; }
export function getPage() { return currentPage; }

export function openFolder(folderId) {
  state.folderId = folderId;
  setPage(1);
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function clearFilters() {
  state.search = '';
  state.type = '';
  state.tag = '';
  state.importance = '';
  state.sort = 'created_desc';
  setPage(1);
  $('#searchInput').value = '';
  $('#typeFilter').value = '';
  $('#tagFilter').value = '';
  $('#importanceFilter').value = '';
  $('#sortFilter').value = 'created_desc';
  render();
}

export function syncTagControls() {
  const select = $('#tagFilter');
  if (state.tag && !tagsCache.includes(state.tag)) state.tag = '';
  const current = state.tag;
  select.innerHTML = '';
  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = 'همه تگ‌ها';
  select.appendChild(allOption);
  for (const tag of tagsCache) {
    const option = document.createElement('option');
    option.value = tag;
    option.textContent = tag;
    if (tag === current) option.selected = true;
    select.appendChild(option);
  }
  const datalist = $('#tagsDatalist');
  datalist.innerHTML = '';
  for (const tag of tagsCache) {
    const option = document.createElement('option');
    option.value = tag;
    datalist.appendChild(option);
  }
}

export function importanceBadge(importance) {
  const value = Number(importance) || 3;
  const badge = document.createElement('span');
  badge.className = `badge imp-${value}`;
  badge.textContent = `اهمیت ${new Intl.NumberFormat('fa-IR').format(value)}`;
  return badge;
}

export function kindBadges(item) {
  const wrap = document.createElement('span');
  wrap.className = 'badges';
  const kinds = [...itemKinds(item)];
  const shown = kinds.slice(0, 3);
  for (const kind of shown) {
    const badge = document.createElement('span');
    badge.className = 'type-badge';
    badge.textContent = `${KIND_ICONS[kind] || '📄'} ${KIND_LABELS[kind] || kind}`;
    wrap.appendChild(badge);
  }
  if (kinds.length > 3) {
    const more = document.createElement('span');
    more.className = 'type-badge';
    more.textContent = `+${new Intl.NumberFormat('fa-IR').format(kinds.length - 3)}`;
    wrap.appendChild(more);
  }
  if (!kinds.length) {
    const badge = document.createElement('span');
    badge.className = 'type-badge';
    badge.textContent = '📄 خالی';
    wrap.appendChild(badge);
  }
  return wrap;
}

function compareBySort(a, b) {
  switch (state.sort) {
    case 'created_asc':
      return new Date(a.createdAt) - new Date(b.createdAt);
    case 'importance_desc':
      return (b.importance - a.importance) || (new Date(b.createdAt) - new Date(a.createdAt));
    case 'importance_asc':
      return (a.importance - b.importance) || (new Date(b.createdAt) - new Date(a.createdAt));
    case 'updated_desc':
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    default:
      return new Date(b.createdAt) - new Date(a.createdAt);
  }
}

export function getFiltered() {
  const filtering = isFiltering();
  let base;
  if (filtering) {
    base = getAllItems().filter(i => !i.isDeleted && i.kind === 'item');
  } else {
    base = getAllItems().filter(i => !i.isDeleted && i.parentId === state.folderId);
  }
  let result = base;
  if (state.search.trim()) {
    const parsed = parseQuery(state.search);
    result = result.filter(i => itemMatchesQuery(i, parsed));
  }
  if (state.type) result = result.filter(i => itemKinds(i).has(state.type));
  if (state.tag) result = result.filter(i => (i.tags || []).includes(state.tag));
  if (state.importance) result = result.filter(i => String(i.importance) === state.importance);
  if (!filtering) {
    result.sort((a, b) => {
      const folderRank = (a.kind === 'folder' ? 0 : 1) - (b.kind === 'folder' ? 0 : 1);
      if (folderRank !== 0) return folderRank;
      if (a.kind === 'folder') return (a.title || '').localeCompare(b.title || '', 'fa');
      return compareBySort(a, b);
    });
  } else {
    result.sort(compareBySort);
  }
  return result;
}

function renderBreadcrumb() {
  const nav = $('#breadcrumb');
  nav.innerHTML = '';
  const trail = getFolderTrail(state.folderId);
  const makeCrumb = (label, folderId, isCurrent) => {
    if (isCurrent) {
      const span = document.createElement('span');
      span.className = 'crumb current';
      span.textContent = label;
      return span;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'crumb';
    button.textContent = label;
    button.addEventListener('click', () => openFolder(folderId));
    return button;
  };
  nav.appendChild(makeCrumb('🏠 ریشه', null, trail.length === 0));
  trail.forEach((folder, index) => {
    const sep = document.createElement('span');
    sep.className = 'crumb-sep';
    sep.textContent = '／';
    nav.appendChild(sep);
    nav.appendChild(makeCrumb(`📁 ${folder.title || 'بدون نام'}`, folder.id, index === trail.length - 1));
  });
}

function folderChildCount(folderId) {
  return getAllItems().filter(i => !i.isDeleted && i.parentId === folderId).length;
}

function createFolderCard(folder) {
  const card = document.createElement('article');
  card.className = 'card folder-card';
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `باز کردن پوشه ${defaultTitle(folder)}`);
  card.addEventListener('click', () => openFolder(folder.id));
  card.addEventListener('keydown', (event) => {
    if (event.target !== card) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openFolder(folder.id);
    }
  });
  const top = document.createElement('div');
  top.className = 'card-top';
  const badges = document.createElement('div');
  badges.className = 'badges';
  const badge = document.createElement('span');
  badge.className = 'type-badge';
  badge.textContent = '📁 پوشه';
  badges.appendChild(badge);
  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'copy-btn';
  editBtn.textContent = '✏️';
  editBtn.title = 'ویرایش پوشه';
  editBtn.setAttribute('aria-label', `ویرایش پوشه ${defaultTitle(folder)}`);
  editBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    openEditor(folder.id);
  });
  editBtn.addEventListener('keydown', (event) => event.stopPropagation());
  actions.appendChild(editBtn);
  top.append(badges, actions);
  card.appendChild(top);
  const info = document.createElement('div');
  info.className = 'card-info';
  const title = document.createElement('h3');
  title.textContent = `📁 ${defaultTitle(folder)}`;
  info.appendChild(title);
  const count = document.createElement('p');
  count.className = 'snippet';
  count.textContent = `${new Intl.NumberFormat('fa-IR').format(folderChildCount(folder.id))} آیتم داخل این پوشه`;
  info.appendChild(count);
  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const date = document.createElement('span');
  date.textContent = formatDate(folder.createdAt);
  meta.appendChild(date);
  info.appendChild(meta);
  card.appendChild(info);
  return card;
}

function itemSnippet(item) {
  if ((item.content || '').trim()) return item.content.trim().slice(0, 160);
  const names = (item.attachments || [])
    .filter(att => att.kind !== 'link')
    .map(att => att.name)
    .filter(Boolean);
  if (names.length) return names.join('، ');
  const link = (item.attachments || []).find(att => att.kind === 'link');
  return link ? link.url || '' : '';
}

function copyableText(item) {
  if ((item.content || '').trim()) return item.content;
  const link = (item.attachments || []).find(att => att.kind === 'link');
  return link ? link.url || '' : '';
}

async function loadThumb(att, img) {
  try {
    if (thumbUrls.has(att.id)) {
      img.src = thumbUrls.get(att.id);
      return;
    }
    const record = await getAttachmentBlob(att.id, att);
    const blob = record?.thumb || (record?.original?.type?.startsWith('image/') ? record.original : null);
    if (!blob) {
      img.closest('.thumb')?.remove();
      return;
    }
    const url = URL.createObjectURL(blob);
    if (!img.isConnected) {
      URL.revokeObjectURL(url);
      return;
    }
    thumbUrls.set(att.id, url);
    img.src = url;
  } catch {}
}

function createItemCard(item) {
  const card = document.createElement('article');
  card.className = 'card';
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `باز کردن ${defaultTitle(item)}`);
  card.addEventListener('click', () => openFolderGuard(item));
  card.addEventListener('keydown', (event) => {
    if (event.target !== card) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openFolderGuard(item);
    }
  });
  const top = document.createElement('div');
  top.className = 'card-top';
  const badges = document.createElement('div');
  badges.className = 'badges';
  badges.appendChild(kindBadges(item));
  badges.appendChild(importanceBadge(item.importance));
  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const copyText = copyableText(item);
  if (copyText) {
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'copy-btn';
    copyBtn.textContent = '📋';
    copyBtn.title = 'کپی سریع';
    copyBtn.setAttribute('aria-label', 'کپی سریع محتوا');
    copyBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      try {
        await copyTextToClipboard(copyText);
        toast('کپی شد');
      } catch {
        toast('کپی ممکن نشد', 'error');
      }
    });
    copyBtn.addEventListener('keydown', (event) => event.stopPropagation());
    actions.appendChild(copyBtn);
  }
  top.append(badges, actions);
  card.appendChild(top);
  const imageAtt = (item.attachments || []).find(att => att.kind === 'image');
  if (imageAtt) {
    const figure = document.createElement('figure');
    figure.className = 'thumb';
    if (imageAtt.width && imageAtt.height) {
      figure.style.aspectRatio = `${imageAtt.width} / ${imageAtt.height}`;
    }
    const img = document.createElement('img');
    img.className = 'thumb-img';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = item.title || 'تصویر بدون عنوان';
    figure.appendChild(img);
    card.appendChild(figure);
    loadThumb(imageAtt, img);
  } else {
    const preview = document.createElement('div');
    preview.className = 'preview';
    const snippetSource = (item.content || '').trim();
    if (snippetSource) {
      const pre = document.createElement('pre');
      pre.textContent = snippetSource.slice(0, 220);
      preview.appendChild(pre);
    } else {
      const div = document.createElement('div');
      div.className = 'file-info';
      const atts = item.attachments || [];
      div.textContent = atts
        .map(att => {
          if (att.kind === 'link') return `🔗 ${att.url || ''}`;
          return `${KIND_ICONS[att.kind] || '📎'} ${att.name || 'فایل'} — ${formatSize(att.size || 0)}`;
        })
        .join('\n') || '(خالی)';
      preview.appendChild(div);
    }
    card.appendChild(preview);
  }
  const info = document.createElement('div');
  info.className = 'card-info';
  const title = document.createElement('h3');
  title.textContent = defaultTitle(item);
  info.appendChild(title);
  const snippet = itemSnippet(item);
  if (snippet && imageAtt) {
    const p = document.createElement('p');
    p.className = 'snippet';
    p.textContent = snippet;
    info.appendChild(p);
  }
  if ((item.tags || []).length) {
    const tags = document.createElement('div');
    tags.className = 'tags';
    item.tags.slice(0, 5).forEach(tag => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = '#' + tag;
      tags.appendChild(chip);
    });
    info.appendChild(tags);
  }
  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const date = document.createElement('span');
  date.textContent = formatDate(item.createdAt);
  const kinds = document.createElement('span');
  kinds.textContent = [...itemKinds(item)].map(k => KIND_LABELS[k] || k).join('، ') || '—';
  meta.append(date, kinds);
  info.appendChild(meta);
  card.appendChild(info);
  return card;
}

function renderGallery(filtered) {
  const gallery = $('#gallery');
  gallery.innerHTML = '';
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);
  const visibleAttIds = new Set();
  for (const item of pageItems) {
    for (const att of item.attachments || []) visibleAttIds.add(att.id);
  }
  for (const [id, url] of [...thumbUrls.entries()]) {
    if (!visibleAttIds.has(id)) {
      URL.revokeObjectURL(url);
      thumbUrls.delete(id);
    }
  }
  for (const item of pageItems) {
    gallery.appendChild(item.kind === 'folder' ? createFolderCard(item) : createItemCard(item));
  }
}

function renderPager(total) {
  const pager = $('#pager');
  pager.innerHTML = '';
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) {
    pager.hidden = true;
    return;
  }
  pager.hidden = false;
  const fmt = new Intl.NumberFormat('fa-IR');
  const makeButton = (label, page, disabled = false, active = false) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.disabled = disabled;
    if (active) button.classList.add('active');
    button.addEventListener('click', () => {
      setPage(page);
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    return button;
  };
  const ellipsis = () => {
    const span = document.createElement('span');
    span.className = 'ellipsis';
    span.textContent = '…';
    return span;
  };
  pager.appendChild(makeButton('قبلی', currentPage - 1, currentPage === 1));
  let start = Math.max(1, currentPage - 2);
  let end = Math.min(pages, currentPage + 2);
  if (start > 1) {
    pager.appendChild(makeButton(fmt.format(1), 1));
    if (start > 2) pager.appendChild(ellipsis());
  }
  for (let page = start; page <= end; page++) {
    pager.appendChild(makeButton(fmt.format(page), page, false, page === currentPage));
  }
  if (end < pages) {
    if (end < pages - 1) pager.appendChild(ellipsis());
    pager.appendChild(makeButton(fmt.format(pages), pages));
  }
  pager.appendChild(makeButton('بعدی', currentPage + 1, currentPage === pages));
}

function renderEmpty(filteredCount) {
  const empty = $('#emptyState');
  const gallery = $('#gallery');
  const pager = $('#pager');
  if (filteredCount > 0) {
    empty.hidden = true;
    empty.innerHTML = '';
    gallery.hidden = false;
    return;
  }
  gallery.hidden = true;
  gallery.innerHTML = '';
  pager.hidden = true;
  pager.innerHTML = '';
  empty.hidden = false;
  empty.innerHTML = '';
  const activeCount = getAllItems().filter(i => !i.isDeleted && i.kind === 'item').length;
  const title = document.createElement('h2');
  const text = document.createElement('p');
  const button = document.createElement('button');
  button.className = 'btn primary';
  button.type = 'button';
  if (isFiltering()) {
    title.textContent = 'نتیجه‌ای پیدا نشد';
    text.textContent = 'فیلترها یا عبارت جستجو را تغییر بده. یادآوری: tag:کار یا type:تصویر یا -کلمه هم کار می‌کنند.';
    button.textContent = 'پاک کردن فیلترها';
    button.addEventListener('click', clearFilters);
  } else if (state.folderId) {
    title.textContent = 'این پوشه خالی است';
    text.textContent = 'اولین آیتم را همین‌جا داخل این پوشه بساز.';
    button.textContent = 'افزودن به این پوشه';
    button.addEventListener('click', () => openEditor(null, { parentId: state.folderId }));
  } else if (activeCount === 0) {
    title.textContent = 'هنوز آیتمی ثبت نکرده‌ای';
    text.textContent = 'برای شروع، دکمه افزودن را بزن یا تصویر/فایل را همین‌جا داخل صفحه رها کن.';
    button.textContent = 'افزودن اولین آیتم';
    button.addEventListener('click', () => openEditor());
  } else {
    title.textContent = 'اینجا خالی است';
    text.textContent = 'در این مسیر آیتمی نیست؛ یک پوشه یا آیتم جدید بساز.';
    button.textContent = 'افزودن آیتم';
    button.addEventListener('click', () => openEditor());
  }
  empty.append(title, text, button);
}

export function render() {
  syncTagControls();
  renderBreadcrumb();
  const filtered = getFiltered();
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (currentPage < 1) currentPage = 1;
  if (currentPage > pages) currentPage = pages;
  renderEmpty(filtered.length);
  if (filtered.length === 0) return;
  renderGallery(filtered);
  renderPager(filtered.length);
}