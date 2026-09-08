// db.js — small IndexedDB wrapper. No external deps, works fully offline.

const DB_NAME = 'pilo-presupuestos';
const DB_VERSION = 2;

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('clients')) db.createObjectStore('clients', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('quotes')) db.createObjectStore('quotes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('planos')) db.createObjectStore('planos', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDB().then(db => db.transaction(storeName, mode).objectStore(storeName));
}

export async function kvGet(id) {
  const store = await tx('kv', 'readonly');
  return new Promise((resolve, reject) => {
    const r = store.get(id);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}

export async function kvSet(obj) {
  const store = await tx('kv', 'readwrite');
  return new Promise((resolve, reject) => {
    const r = store.put(obj);
    r.onsuccess = () => resolve(obj);
    r.onerror = () => reject(r.error);
  });
}

export async function listAll(storeName) {
  const store = await tx(storeName, 'readonly');
  return new Promise((resolve, reject) => {
    const r = store.getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}

export async function itemGet(storeName, id) {
  const store = await tx(storeName, 'readonly');
  return new Promise((resolve, reject) => {
    const r = store.get(id);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}

export async function itemPut(storeName, obj) {
  const store = await tx(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const r = store.put(obj);
    r.onsuccess = () => resolve(obj);
    r.onerror = () => reject(r.error);
  });
}

export async function itemDelete(storeName, id) {
  const store = await tx(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const r = store.delete(id);
    r.onsuccess = () => resolve(true);
    r.onerror = () => reject(r.error);
  });
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
