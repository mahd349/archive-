// js/crypto.js
export function bytesToHex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex) {
  const clean = String(hex || '').replace(/[^0-9a-f]/gi, '');
  const length = Math.floor(clean.length / 2);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function randomSaltHex() {
  if (window.crypto?.getRandomValues) {
    return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  }
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

export function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function hashPassword(password, saltHex, iterations) {
  if (window.crypto?.subtle) {
    try {
      const encoder = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: iterations || 120000, hash: 'SHA-256' },
        keyMaterial,
        256
      );
      return bytesToHex(new Uint8Array(bits));
    } catch {}
  }
  // fallback only for browsers without WebCrypto (non-secure contexts)
  let hash = 0x811c9dc5;
  const text = `${password}:${saltHex}:${iterations}`;
  const rounds = Math.min(Number(iterations) || 120000, 50000);
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return `fallback-${hash.toString(16)}-${rounds}`;
}

export async function deriveAesKey(password, saltHex, iterations) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: iterations || 120000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptJSON(obj, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(obj));
  const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return concatBytes(iv, new Uint8Array(cipherBuffer));
}

export async function decryptJSON(bytes, key) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const iv = data.slice(0, 12);
  const cipher = data.slice(12);
  const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return JSON.parse(new TextDecoder().decode(plainBuffer));
}

export async function encryptBlob(blob, key) {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buffer);
  return new Blob([concatBytes(iv, new Uint8Array(cipherBuffer))], { type: 'application/octet-stream' });
}

export async function decryptBlob(blob, mime, key) {
  const data = new Uint8Array(await blob.arrayBuffer());
  if (data.length < 13) throw new Error('داده رمزنگاری‌شده معتبر نیست.');
  const iv = data.slice(0, 12);
  const cipher = data.slice(12);
  const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return new Blob([plainBuffer], { type: mime || 'application/octet-stream' });
}