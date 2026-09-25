// IndexedDB 持久化：保存 / 读取 / 删除代码片段
(function (root) {
  'use strict';
  const JSE = (root.JSE = root.JSE || {});

  const DB_NAME = 'jse-studio';
  const STORE = 'snippets';

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function toPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveSnippet(name, code) {
    const db = await openDb();
    try {
      return await toPromise(
        db.transaction(STORE, 'readwrite').objectStore(STORE)
          .add({ name, code, time: Date.now() })
      );
    } finally {
      db.close();
    }
  }

  async function listSnippets() {
    const db = await openDb();
    try {
      const all = await toPromise(db.transaction(STORE).objectStore(STORE).getAll());
      return all.sort((a, b) => b.time - a.time);
    } finally {
      db.close();
    }
  }

  async function deleteSnippet(id) {
    const db = await openDb();
    try {
      await toPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
    } finally {
      db.close();
    }
  }

  JSE.db = { saveSnippet, listSnippets, deleteSnippet };
})(typeof self !== 'undefined' ? self : globalThis);
