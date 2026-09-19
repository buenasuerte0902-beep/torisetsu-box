const DB_NAME = "torisetsu-box";
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const items = db.createObjectStore("items", { keyPath: "id" });
      items.createIndex("category", "category");
      items.createIndex("updatedAt", "updatedAt");
      const files = db.createObjectStore("files", { keyPath: "id" });
      files.createIndex("itemId", "itemId");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, stores, mode) {
  return db.transaction(stores, mode);
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function newId() {
  return crypto.randomUUID();
}

export const store = {
  async listItems({ q, category } = {}) {
    const db = await openDb();
    const all = await reqToPromise(tx(db, ["items"], "readonly").objectStore("items").getAll());
    const allFiles = await reqToPromise(tx(db, ["files"], "readonly").objectStore("files").getAll());
    const filesByItem = new Map();
    for (const f of allFiles) {
      if (!filesByItem.has(f.itemId)) filesByItem.set(f.itemId, []);
      filesByItem.get(f.itemId).push(f);
    }

    let items = all;
    if (category) items = items.filter((i) => i.category === category);
    if (q) {
      const needle = q.toLowerCase();
      items = items.filter((i) => {
        const metaMatch = [i.name, i.maker, i.modelNumber, i.memo]
          .some((v) => (v || "").toLowerCase().includes(needle));
        if (metaMatch) return true;
        const files = filesByItem.get(i.id) || [];
        return files.some((f) => f.kind === "pdf" && (f.text || "").toLowerCase().includes(needle));
      });
    }
    items.sort((a, b) => b.updatedAt - a.updatedAt);

    const categories = [...new Set(["家電", "家具", "その他", ...all.map((i) => i.category)])].sort();

    return {
      items: items.map((i) => {
        const files = (filesByItem.get(i.id) || []).sort((a, b) => a.uploadedAt - b.uploadedAt);
        const photo = files.find((f) => f.kind === "photo");
        return { ...i, fileCount: files.length, thumbnailBlob: photo ? photo.blob : null };
      }),
      categories,
    };
  },

  async createItem(fields) {
    const db = await openDb();
    const now = Date.now();
    const item = {
      id: newId(),
      name: fields.name,
      category: fields.category || "その他",
      maker: fields.maker || null,
      modelNumber: fields.modelNumber || null,
      purchaseDate: fields.purchaseDate || null,
      warrantyExpiry: fields.warrantyExpiry || null,
      memo: fields.memo || null,
      createdAt: now,
      updatedAt: now,
    };
    await reqToPromise(tx(db, ["items"], "readwrite").objectStore("items").add(item));
    return item;
  },

  async updateItem(id, fields) {
    const db = await openDb();
    const t = tx(db, ["items"], "readwrite");
    const existing = await reqToPromise(t.objectStore("items").get(id));
    if (!existing) throw new Error("見つかりません");
    const updated = { ...existing, ...fields, updatedAt: Date.now() };
    await reqToPromise(t.objectStore("items").put(updated));
    return updated;
  },

  async getItem(id) {
    const db = await openDb();
    const item = await reqToPromise(tx(db, ["items"], "readonly").objectStore("items").get(id));
    if (!item) return null;
    const files = await reqToPromise(
      tx(db, ["files"], "readonly").objectStore("files").index("itemId").getAll(id)
    );
    files.sort((a, b) => a.uploadedAt - b.uploadedAt);
    return { ...item, files };
  },

  async deleteItem(id) {
    const db = await openDb();
    const t = tx(db, ["items", "files"], "readwrite");
    const files = await reqToPromise(t.objectStore("files").index("itemId").getAll(id));
    for (const f of files) t.objectStore("files").delete(f.id);
    t.objectStore("items").delete(id);
    await new Promise((resolve, reject) => {
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  },

  async addFile(itemId, kind, file, { text } = {}) {
    const db = await openDb();
    const record = {
      id: newId(),
      itemId,
      kind,
      blob: file,
      originalName: file.name || "",
      mime: file.type || "",
      uploadedAt: Date.now(),
      text: text ?? null, // PDF全文検索用に抽出したテキスト。未抽出/写真ならnull
    };
    const t = tx(db, ["files", "items"], "readwrite");
    t.objectStore("files").add(record);
    const item = await reqToPromise(t.objectStore("items").get(itemId));
    if (item) t.objectStore("items").put({ ...item, updatedAt: Date.now() });
    await new Promise((resolve, reject) => {
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
    return record;
  },

  async deleteFile(id) {
    const db = await openDb();
    await reqToPromise(tx(db, ["files"], "readwrite").objectStore("files").delete(id));
  },

  // 古いバージョンで保存されたPDF(textフィールドが無い)に、後から抽出したテキストを付ける
  async updateFileText(id, text) {
    const db = await openDb();
    const t = tx(db, ["files"], "readwrite");
    const rec = await reqToPromise(t.objectStore("files").get(id));
    if (rec) t.objectStore("files").put({ ...rec, text });
    await new Promise((resolve, reject) => {
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  },

  async exportAll() {
    const db = await openDb();
    const items = await reqToPromise(tx(db, ["items"], "readonly").objectStore("items").getAll());
    const files = await reqToPromise(tx(db, ["files"], "readonly").objectStore("files").getAll());
    return { items, files };
  },

  async importAll({ items, files }) {
    const db = await openDb();
    const t = tx(db, ["items", "files"], "readwrite");
    const existingItemIds = new Set(await reqToPromise(t.objectStore("items").getAllKeys()));
    const existingFileIds = new Set(await reqToPromise(t.objectStore("files").getAllKeys()));
    let importedItems = 0, importedFiles = 0;
    for (const item of items || []) {
      if (existingItemIds.has(item.id)) continue;
      t.objectStore("items").add(item);
      importedItems++;
    }
    for (const file of files || []) {
      if (existingFileIds.has(file.id)) continue;
      t.objectStore("files").add(file);
      importedFiles++;
    }
    await new Promise((resolve, reject) => {
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
    return { importedItems, importedFiles };
  },
};
