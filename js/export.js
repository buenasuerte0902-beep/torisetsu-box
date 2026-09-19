import { store } from "./db.js";

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",", 2)[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64, mime) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime || "application/octet-stream" });
}

export async function exportToFile() {
  const { items, files } = await store.exportAll();
  const encodedFiles = await Promise.all(
    files.map(async (f) => ({
      id: f.id, itemId: f.itemId, kind: f.kind, originalName: f.originalName,
      mime: f.mime, uploadedAt: f.uploadedAt, data: await blobToBase64(f.blob),
    }))
  );
  const payload = {
    app: "torisetsu-box", version: 1, exportedAt: Date.now(),
    items, files: encodedFiles,
  };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `torisetsu-box-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { itemCount: items.length, fileCount: files.length };
}

export async function importFromFile(file) {
  const text = await file.text();
  const payload = JSON.parse(text);
  if (payload.app !== "torisetsu-box" || !Array.isArray(payload.items)) {
    throw new Error("取説BOXのエクスポートファイルではありません");
  }
  const files = (payload.files || []).map((f) => ({
    id: f.id, itemId: f.itemId, kind: f.kind, originalName: f.originalName,
    mime: f.mime, uploadedAt: f.uploadedAt, blob: base64ToBlob(f.data, f.mime),
  }));
  return store.importAll({ items: payload.items, files });
}
