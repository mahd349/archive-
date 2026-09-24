// js/settings.js
import { $, defaultTitle, formatDate, toast } from './utils.js';
import { exportBackup, importBackup, permanentDeleteItem, restoreItem } from './repo.js';
import { settings, getAllItems, refreshTags } from './state.js';
import { render, setPage } from './render.js';

function updateSettingsUI() {
  const supported = !!window.crypto?.subtle;
  if (!supported) {
    $('#lockStatus').textContent = 'مرورگر از رمزنگاری داخلی پشتیبانی نمی‌کند.';
  } else if (settings.encryptionEnabled) {
    $('#lockStatus').textContent = 'رمزنگاری و قفل با رمز فعال است.';
  } else {
    $('#lockStatus').textContent = 'داده‌ها در حال حاضر رمزنگاری نیستند.';
  }
  $('#lockDisabledFields').hidden = settings.encryptionEnabled || !supported;
  $('#lockEnabledFields').hidden = !settings.encryptionEnabled;
  for (const id of ['#currentPass', '#newPass', '#confirmPass', '#newPassChange', '#confirmPassChange']) {
    $(id).value = '';
  }
}

function renderTrash() {
  const list = $('#trashList');
  const info = $('#trashInfo');
  const emptyBtn = $('#emptyTrashBtn');
  const trash = getAllItems().filter(item => item.isDeleted);
  list.innerHTML = '';
  emptyBtn.disabled = trash.length === 0;
  if (!trash.length) {
    info.textContent = 'سطل زباله خالی است.';
    return;
  }
  info.textContent = `${new Intl.NumberFormat('fa-IR').format(trash.length)} آیتم در سطل زباله است.`;
  for (const item of trash) {
    const row = document.createElement('div');
    row.className = 'trash-item';
    const title = document.createElement('div');
    title.className = 'trash-title';
    title.textContent = defaultTitle(item);
    const meta = document.createElement('div');
    meta.className = 'trash-meta';
    meta.textContent = formatDate(item.deletedAt || item.updatedAt || item.createdAt);
    const actions = document.createElement('div');
    actions.className = 'trash-actions';
    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.className = 'btn';
    restoreBtn.textContent = 'بازیابی';
    restoreBtn.addEventListener('click', async () => {
      try {
        await restoreItem(item.id);
        renderTrash();
        render();
        toast('آیتم بازیابی شد');
      } catch {
        toast('بازیابی ممکن نشد', 'error');
      }
    });
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn danger';
    deleteBtn.textContent = 'حذف قطعی';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm('این آیتم برای همیشه حذف شود؟')) return;
      try {
        await permanentDeleteItem(item.id);
        renderTrash();
        render();
        toast('آیتم برای همیشه حذف شد');
      } catch {
        toast('حذف قطعی ممکن نشد', 'error');
      }
    });
    actions.append(restoreBtn, deleteBtn);
    row.append(title, meta, actions);
    list.appendChild(row);
  }
}

export function openSettings() {
  updateSettingsUI();
  renderTrash();
  $('#settingsDialog').showModal();
}

$('#settingsCloseBtn').addEventListener('click', () => $('#settingsDialog').close());
$('#closeSettingsBtn').addEventListener('click', () => $('#settingsDialog').close());
$('#settingsDialog').addEventListener('click', (event) => {
  if (event.target === $('#settingsDialog')) $('#settingsDialog').close();
});
$('#exportBtn').addEventListener('click', async () => {
  try {
    await exportBackup();
    toast('فایل بکاپ ساخته شد');
  } catch (err) {
    console.error(err);
    toast('خطا در ساخت بکاپ', 'error');
  }
});
$('#importInput').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  event.target.value = '';
  if (!confirm('همه داده‌های فعلی با فایل پشتیبان جایگزین می‌شوند. ادامه بدهم؟')) return;
  try {
    await importBackup(file);
    refreshTags();
    setPage(1);
    render();
    renderTrash();
    toast('بازیابی کامل شد');
  } catch (err) {
    console.error(err);
    toast(`خطا در بازیابی: ${err.message || 'نامشخص'}`, 'error');
  }
});
$('#emptyTrashBtn').addEventListener('click', async () => {
  const trash = getAllItems().filter(item => item.isDeleted);
  if (!trash.length) return;
  if (!confirm('همه آیتم‌های داخل سطل زباله برای همیشه حذف شوند؟')) return;
  try {
    for (const item of trash) await permanentDeleteItem(item.id);
    render();
    renderTrash();
    toast('سطل زباله خالی شد');
  } catch {
    toast('خطا در خالی کردن سطل زباله', 'error');
  }
});
$('#enablePassBtn').addEventListener('click', async () => {
  const pass = $('#newPass').value;
  const confirmPass = $('#confirmPass').value;
  if (pass.length < 4) return toast('رمز باید حداقل ۴ کاراکتر باشد.', 'error');
  if (pass !== confirmPass) return toast('تکرار رمز مطابقت ندارد.', 'error');
  try {
    toast('در حال رمزنگاری داده‌ها...');
    await import('./repo.js').then(m => m.enableEncryption(pass));
    updateSettingsUI();
    toast('رمز و رمزنگاری فعال شد');
  } catch (err) {
    console.error(err);
    toast(err.message || 'خطا در فعال‌سازی رمزنگاری', 'error');
  }
});
$('#changePassBtn').addEventListener('click', async () => {
  const current = $('#currentPass').value;
  const pass = $('#newPassChange').value;
  const confirmPass = $('#confirmPassChange').value;
  if (pass.length < 4) return toast('رمز جدید باید حداقل ۴ کاراکتر باشد.', 'error');
  if (pass !== confirmPass) return toast('تکرار رمز جدید مطابقت ندارد.', 'error');
  try {
    toast('در حال تغییر رمز و رمزنگاری دوباره...');
    await import('./repo.js').then(m => m.changeEncryptionPassword(current, pass));
    updateSettingsUI();
    toast('رمز تغییر کرد');
  } catch (err) {
    console.error(err);
    toast(err.message || 'خطا در تغییر رمز', 'error');
  }
});
$('#disablePassBtn').addEventListener('click', async () => {
  const current = $('#currentPass').value;
  try {
    toast('در حال رمزگشایی داده‌ها...');
    await import('./repo.js').then(m => m.disableEncryption(current));
    updateSettingsUI();
    toast('رمز و رمزنگاری غیرفعال شد');
  } catch (err) {
    console.error(err);
    toast(err.message || 'خطا در غیرفعال‌سازی رمزنگاری', 'error');
  }
});