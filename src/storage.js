// IndexedDB 持久化：保存代码片段与运行历史。

const DB_NAME = 'js-ast-studio';
const DB_VERSION = 1;
const STORE_SNIPPETS = 'snippets';
const STORE_HISTORY = 'history';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_SNIPPETS)) {
        db.createObjectStore(STORE_SNIPPETS, { keyPath: 'name' });
      }
      if (!db.objectStoreNames.contains(STORE_HISTORY)) {
        db.createObjectStore(STORE_HISTORY, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = fn(transaction.objectStore(store));
    transaction.oncomplete = () => resolve(request ? request.result : undefined);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function saveSnippet(name, source) {
  const db = await openDB();
  await tx(db, STORE_SNIPPETS, 'readwrite', (store) =>
    store.put({ name, source, updatedAt: Date.now() }));
}

export async function loadSnippet(name) {
  const db = await openDB();
  const record = await tx(db, STORE_SNIPPETS, 'readonly', (store) => store.get(name));
  return record ? record.source : null;
}

export async function listSnippets() {
  const db = await openDB();
  const records = await tx(db, STORE_SNIPPETS, 'readonly', (store) => store.getAll());
  return (records || []).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteSnippet(name) {
  const db = await openDB();
  await tx(db, STORE_SNIPPETS, 'readwrite', (store) => store.delete(name));
}

export async function addHistory(entry) {
  const db = await openDB();
  await tx(db, STORE_HISTORY, 'readwrite', (store) =>
    store.add({ ...entry, createdAt: Date.now() }));
}

export async function listHistory(limit = 20) {
  const db = await openDB();
  const records = await tx(db, STORE_HISTORY, 'readonly', (store) => store.getAll());
  return (records || []).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}
