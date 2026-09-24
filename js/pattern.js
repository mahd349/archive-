// js/pattern.js
import { $, toast } from './utils.js';
import {
  hashPassword,
  deriveAesKey,
  encryptJSON,
  decryptJSON,
  safeEqual,
  randomSaltHex
} from './crypto.js';
import { settings, saveSettings, verifyPassword, setCryptoKey } from './state.js';
import { startApp } from './app.js';

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

function createPad(container, onComplete) {
  container.innerHTML = '';
  const dots = [];
  for (let i = 0; i < 9; i++) {
    const dot = document.createElement('div');
    dot.className = 'pattern-dot';
    dot.dataset.i = String(i);
    container.appendChild(dot);
    dots.push(dot);
  }
  let seq = [];
  let drawing = false;
  const reset = () => {
    seq = [];
    dots.forEach(d => d.classList.remove('on'));
  };
  const addDot = (dot) => {
    const idx = Number(dot.dataset.i);
    if (seq.includes(idx)) return;
    seq.push(idx);
    dot.classList.add('on');
  };
  const dotAt = (event) => {
    const el = document.elementFromPoint(event.clientX, event.clientY);
    const dot = el && el.closest ? el.closest('.pattern-dot') : null;
    return dot && container.contains(dot) ? dot : null;
  };
  container.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    drawing = true;
    reset();
    const dot = dotAt(event);
    if (dot) addDot(dot);
  });
  container.addEventListener('pointermove', (event) => {
    if (!drawing) return;
    const dot = dotAt(event);
    if (dot) addDot(dot);
  });
  window.addEventListener('pointerup', () => {
    if (!drawing) return;
    drawing = false;
    const str = seq.join('-');
    const ok = seq.length >= 4;
    setTimeout(() => reset(), ok ? 260 : 120);
    if (ok) onComplete(str);
  });
  window.addEventListener('pointercancel', () => {
    drawing = false;
    reset();
  });
}

function lockShowTab(which) {
  const pass = which === 'pass';
  $('#lockForm').hidden = !pass;
  $('#lockPatternWrap').hidden = pass;
  $('#lockTabPass').classList.toggle('primary', pass);
  $('#lockTabPattern').classList.toggle('primary', !pass);
  $('#lockError').textContent = '';
}

export function syncLockMode() {
  const hasPattern = !!(settings.encryptionEnabled && settings.patternEnabled);
  $('#lockTabs').hidden = !hasPattern;
  $('#lockForm').hidden = false;
  $('#lockPatternWrap').hidden = true;
  if (hasPattern) lockShowTab('pass');
  updatePatternStatus();
}

async function unlockWithPattern(str) {
  try {
    const iterations = settings.iterations || 120000;
    const candidate = await hashPassword(str, settings.patternSalt, iterations);
    if (!safeEqual(candidate, settings.patternHash)) throw new Error('bad pattern');
    const patternKey = await deriveAesKey(str, settings.patternSalt, iterations);
    const vault = await decryptJSON(base64ToBytes(settings.patternVault), patternKey);
    setCryptoKey(await deriveAesKey(vault.p, settings.salt, iterations));
    await startApp();
  } catch {
    $('#lockError').textContent = 'الگو اشتباه است.';
  }
}

let enrollFirst = null;

async function enrollComplete(str) {
  if (enrollFirst === null) {
    enrollFirst = str;
    $('#patternHint').textContent = 'حالا همان الگو را دوباره بکش.';
    return;
  }
  if (enrollFirst !== str) {
    enrollFirst = null;
    $('#patternHint').textContent = 'دو الگو یکسان نبود؛ از اول بکش.';
    return;
  }
  const pass = $('#patternPassInput').value;
  const ok = await verifyPassword(pass);
  if (!ok) {
    toast('رمز عبور فعلی اشتباه است', 'error');
    return;
  }
  const iterations = settings.iterations || 120000;
  const salt = randomSaltHex();
  const hash = await hashPassword(str, salt, iterations);
  const key = await deriveAesKey(str, salt, iterations);
  const vault = bytesToBase64(await encryptJSON({ p: pass }, key));
  settings.patternEnabled = true;
  settings.patternSalt = salt;
  settings.patternHash = hash;
  settings.patternVault = vault;
  saveSettings();
  enrollFirst = null;
  $('#settingsPatternPad').hidden = true;
  $('#patternHint').hidden = true;
  $('#patternPassInput').hidden = true;
  $('#patternPassInput').value = '';
  updatePatternStatus();
  syncLockMode();
  toast('الگو ثبت شد؛ از این به بعد با الگو هم می‌توانی باز کنی');
}

function removePattern() {
  settings.patternEnabled = false;
  settings.patternSalt = null;
  settings.patternHash = null;
  settings.patternVault = null;
  saveSettings();
  updatePatternStatus();
  syncLockMode();
  toast('الگو حذف شد');
}

function updatePatternStatus() {
  const status = $('#patternStatus');
  if (status) {
    status.textContent = settings.patternEnabled
      ? 'الگو فعال است (در کنار رمز عبور).'
      : 'الگو ثبت نشده؛ ورود فقط با رمز عبور.';
  }
  const removeBtn = $('#removePatternBtn');
  if (removeBtn) removeBtn.disabled = !settings.patternEnabled;
}

$('#lockTabPass').addEventListener('click', () => lockShowTab('pass'));
$('#lockTabPattern').addEventListener('click', () => lockShowTab('pattern'));
createPad($('#lockPatternPad'), unlockWithPattern);
createPad($('#settingsPatternPad'), enrollComplete);
$('#setPatternBtn').addEventListener('click', () => {
  if (!settings.encryptionEnabled) {
    toast('اول رمز عبور و رمزنگاری را فعال کن', 'error');
    return;
  }
  enrollFirst = null;
  $('#settingsPatternPad').hidden = false;
  $('#patternHint').hidden = false;
  $('#patternPassInput').hidden = false;
  $('#patternHint').textContent = 'الگو را دو بار یکسان بکش (حداقل ۴ نقطه).';
});
$('#removePatternBtn').addEventListener('click', removePattern);
$('#settingsBtn').addEventListener('click', updatePatternStatus);
updatePatternStatus();
