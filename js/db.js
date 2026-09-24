// js/db.js
export const DB_NAME = 'personal-archive-db';
export const DB_VERSION = 2;

let db = null;

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txComplete(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const tx = request.transaction;
      let itemsStore;
      if (!database.objectStoreNames.contains('items')) {
        itemsStore = database.createObjectStore('items', { keyPath: 'id' });
      } else {
        itemsStore = tx.objectStore('items');
      }
      if (!itemsStore.indexNames.contains('parentId')) itemsStore.createIndex('parentId', 'parentId');
      if (!itemsStore.indexNames.contains('kind')) itemsStore.createIndex('kind', 'kind');
      if (!itemsStore.indexNames.contains('updatedAt')) itemsStore.createIndex('updatedAt', 'updatedAt');
      if (!database.objectStoreNames.contains('blobs')) {
        database.createObjectStore('blobs', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}

function getDB() {
  if (!db) throw new Error('دیتابیس باز نشده است.');
  return db;
}

export async function getAllRawItems() {
  const tx = getDB().transaction('items', 'readonly');
  return promisifyRequest(tx.objectStore('items').getAll());
}

export async function putRawItem(record) {
  const tx = getDB().transaction('items', 'readwrite');
  tx.objectStore('items').put(record);
  return txComplete(tx);
}

export async function deleteRawItem(id) {
  const tx = getDB().transaction('items', 'readwrite');
  tx.objectStore('items').delete(id);
  return txComplete(tx);
}

export async function getRawBlob(id) {
  const tx = getDB().transaction('blobs', 'readonly');
  return promisifyRequest(tx.objectStore('blobs').get(id));
}

export async function putRawBlob(record) {
  const tx = getDB().transaction('blobs', 'readwrite');
  tx.objectStore('blobs').put(record);
  return txComplete(tx);
}

export async function deleteRawBlob(id) {
  const tx = getDB().transaction('blobs', 'readwrite');
  tx.objectStore('blobs').delete(id);
  return txComplete(tx);
}

export async function clearRawAll() {
  const tx = getDB().transaction(['items', 'blobs'], 'readwrite');
  tx.objectStore('items').clear();
  tx.objectStore('blobs').clear();
  return txComplete(tx);
}