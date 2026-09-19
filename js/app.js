import { store } from "./db.js";
import { exportToFile, importFromFile } from "./export.js";
import { warrantyStatus, escapeHtml, showToast } from "./util.js";

const els = {};
["app-screen", "export-btn", "import-input",
 "search-input", "category-chips", "item-list", "empty-message", "add-btn",
 "form-overlay", "form-title", "item-form", "form-error",
 "f-name", "f-category", "f-maker", "f-model", "f-purchase", "f-warranty", "f-memo",
 "category-options",
 "detail-overlay", "detail-name", "detail-edit-btn", "detail-delete-btn",
 "detail-badges", "detail-fields", "detail-memo",
 "photo-gallery", "camera-input", "gallery-input", "pdf-list", "pdf-input",
 "pdf-search-btn", "pdf-url-form", "pdf-url-input",
 "lightbox", "lightbox-img", "lightbox-close",
].forEach((id) => { els[id] = document.getElementById(id); });

const state = {
  items: [],
  categories: [],
  category: "",
  q: "",
  editingId: null,   // 説明書フォームが編集中のitem id (nullなら新規)
  detailId: null,    // 詳細表示中のitem id
};

let searchDebounce;
let gridObjectUrls = [];
let detailObjectUrls = [];

function revoke(urls) {
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls.length = 0;
}

async function init() {
  if (navigator.serviceWorker) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  bindEvents();
  loadItems();
}

function bindEvents() {
  els["search-input"].addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.q = els["search-input"].value.trim();
      loadItems();
    }, 250);
  });

  els["add-btn"].addEventListener("click", () => openForm(null));

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => { document.getElementById(btn.dataset.close).hidden = true; });
  });

  els["item-form"].addEventListener("submit", onSubmitForm);

  els["item-list"].addEventListener("click", (e) => {
    const card = e.target.closest(".item-card");
    if (card) openDetail(card.dataset.id);
  });

  els["detail-edit-btn"].addEventListener("click", () => {
    els["detail-overlay"].hidden = true;
    openForm(state._detailItem);
  });

  els["detail-delete-btn"].addEventListener("click", onDeleteItem);

  els["camera-input"].addEventListener("change", (e) => onFilesSelected(e, "photo"));
  els["gallery-input"].addEventListener("change", (e) => onFilesSelected(e, "photo"));
  els["pdf-input"].addEventListener("change", (e) => onFilesSelected(e, "pdf"));

  els["pdf-search-btn"].addEventListener("click", onSearchPdf);
  els["pdf-url-form"].addEventListener("submit", onImportPdfFromUrl);

  els["photo-gallery"].addEventListener("click", (e) => {
    const removeBtn = e.target.closest(".remove-btn");
    if (removeBtn) { onRemoveFile(removeBtn.dataset.fileId); return; }
    const photo = e.target.closest(".photo-item img");
    if (photo) openLightbox(photo.src);
  });
  els["pdf-list"].addEventListener("click", (e) => {
    const removeBtn = e.target.closest(".remove-btn");
    if (removeBtn) onRemoveFile(removeBtn.dataset.fileId);
  });

  els["lightbox-close"].addEventListener("click", () => { els.lightbox.hidden = true; });
  els.lightbox.addEventListener("click", (e) => { if (e.target === els.lightbox) els.lightbox.hidden = true; });

  els["export-btn"].addEventListener("click", async () => {
    try {
      const { itemCount } = await exportToFile();
      showToast(`${itemCount}件を書き出しました`);
    } catch (err) {
      showToast(err.message);
    }
  });

  els["import-input"].addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const { importedItems } = await importFromFile(file);
      showToast(`${importedItems}件を読み込みました`);
      loadItems();
    } catch (err) {
      showToast(err.message);
    }
  });
}

async function loadItems() {
  const { items, categories } = await store.listItems({ q: state.q, category: state.category });
  state.items = items;
  state.categories = categories;
  renderChips();
  renderGrid();
}

function renderChips() {
  const chips = ["", ...state.categories];
  els["category-chips"].innerHTML = chips.map((c) => `
    <button type="button" class="chip ${c === state.category ? "active" : ""}" data-cat="${escapeHtml(c)}">
      ${c === "" ? "すべて" : escapeHtml(c)}
    </button>`).join("");
  els["category-chips"].querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.category = btn.dataset.cat;
      loadItems();
    });
  });

  els["category-options"].innerHTML = state.categories
    .map((c) => `<option value="${escapeHtml(c)}">`).join("");
}

function renderGrid() {
  revoke(gridObjectUrls);
  els["empty-message"].hidden = state.items.length > 0;
  els["item-list"].innerHTML = state.items.map((item) => {
    const status = warrantyStatus(item.warrantyExpiry);
    let thumb;
    if (item.thumbnailBlob) {
      const url = URL.createObjectURL(item.thumbnailBlob);
      gridObjectUrls.push(url);
      thumb = `<div class="thumb" style="background-image:url('${url}')"></div>`;
    } else {
      thumb = `<div class="thumb">${item.fileCount > 0 ? "📄" : "📦"}</div>`;
    }
    return `
      <button type="button" class="item-card" data-id="${item.id}">
        ${thumb}
        <div class="info">
          <div class="name">${escapeHtml(item.name)}</div>
          <div class="meta">${escapeHtml(item.maker || "")}</div>
          <span class="badge category">${escapeHtml(item.category)}</span>
          ${status ? `<span class="badge ${status.level}">${escapeHtml(status.label)}</span>` : ""}
        </div>
      </button>`;
  }).join("");
}

function openForm(item) {
  state.editingId = item ? item.id : null;
  els["form-title"].textContent = item ? "説明書を編集" : "説明書を追加";
  els["form-error"].hidden = true;
  els["item-form"].reset();
  if (item) {
    els["f-name"].value = item.name || "";
    els["f-category"].value = item.category || "";
    els["f-maker"].value = item.maker || "";
    els["f-model"].value = item.modelNumber || "";
    els["f-purchase"].value = item.purchaseDate || "";
    els["f-warranty"].value = item.warrantyExpiry || "";
    els["f-memo"].value = item.memo || "";
  }
  els["form-overlay"].hidden = false;
}

async function onSubmitForm(e) {
  e.preventDefault();
  els["form-error"].hidden = true;
  const payload = {
    name: els["f-name"].value.trim(),
    category: els["f-category"].value.trim(),
    maker: els["f-maker"].value.trim(),
    modelNumber: els["f-model"].value.trim(),
    purchaseDate: els["f-purchase"].value || null,
    warrantyExpiry: els["f-warranty"].value || null,
    memo: els["f-memo"].value.trim(),
  };
  if (!payload.name) {
    els["form-error"].textContent = "名前は必須です";
    els["form-error"].hidden = false;
    return;
  }
  try {
    let item;
    if (state.editingId) {
      item = await store.updateItem(state.editingId, payload);
    } else {
      item = await store.createItem(payload);
    }
    els["form-overlay"].hidden = true;
    await loadItems();
    openDetail(item.id);
  } catch (err) {
    els["form-error"].textContent = err.message;
    els["form-error"].hidden = false;
  }
}

async function openDetail(id) {
  const item = await store.getItem(id);
  if (!item) { showToast("見つかりません"); return; }
  state.detailId = id;
  state._detailItem = item;
  renderDetail(item);
  els["detail-overlay"].hidden = false;
}

function renderDetail(item) {
  revoke(detailObjectUrls);
  els["detail-name"].textContent = item.name;

  const status = warrantyStatus(item.warrantyExpiry);
  els["detail-badges"].innerHTML = `
    <span class="badge category">${escapeHtml(item.category)}</span>
    ${status ? `<span class="badge ${status.level}">${escapeHtml(status.label)}</span>` : ""}`;

  const fields = [
    ["メーカー", item.maker], ["型番", item.modelNumber],
    ["購入日", item.purchaseDate], ["保証期限", item.warrantyExpiry],
  ].filter(([, v]) => v);
  els["detail-fields"].innerHTML = fields
    .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join("");

  els["detail-memo"].textContent = item.memo || "";

  const photos = item.files.filter((f) => f.kind === "photo");
  els["photo-gallery"].innerHTML = photos.map((f) => {
    const url = URL.createObjectURL(f.blob);
    detailObjectUrls.push(url);
    return `
      <div class="photo-item">
        <img src="${url}" alt="">
        <button type="button" class="remove-btn" data-file-id="${f.id}" aria-label="削除">✕</button>
      </div>`;
  }).join("");

  const pdfs = item.files.filter((f) => f.kind === "pdf");
  els["pdf-list"].innerHTML = pdfs.map((f) => {
    const url = URL.createObjectURL(f.blob);
    detailObjectUrls.push(url);
    return `
      <li>
        <a href="${url}" target="_blank" rel="noopener">${escapeHtml(f.originalName || "PDF")}</a>
        <button type="button" class="remove-btn" data-file-id="${f.id}" aria-label="削除">🗑</button>
      </li>`;
  }).join("") || `<li class="muted">まだPDFがありません</li>`;
}

async function onFilesSelected(e, kind) {
  const files = Array.from(e.target.files || []);
  e.target.value = "";
  if (!files.length || !state.detailId) return;
  for (const file of files) {
    try {
      await store.addFile(state.detailId, kind, file);
    } catch (err) {
      showToast(err.message);
    }
  }
  const item = await store.getItem(state.detailId);
  state._detailItem = item;
  renderDetail(item);
  loadItems();
}

function onSearchPdf() {
  const item = state._detailItem;
  if (!item) return;
  const maker = (item.maker || "").trim();
  const model = (item.modelNumber || "").trim();
  const subject = [maker, model].filter(Boolean).join(" ") || item.name;
  const query = `${subject} 取扱説明書 PDF`;
  window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, "_blank", "noopener");
}

async function onImportPdfFromUrl(e) {
  e.preventDefault();
  const url = els["pdf-url-input"].value.trim();
  if (!url || !state.detailId) return;
  const btn = els["pdf-url-form"].querySelector("button[type=submit]");
  btn.disabled = true;
  btn.textContent = "取得中…";
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ダウンロードに失敗しました (${res.status})`);
    const blob = await res.blob();
    const head = await blob.slice(0, 5).text();
    if (!head.startsWith("%PDF")) throw new Error("PDFファイルではないようです");

    let filename = "manual.pdf";
    try {
      const last = new URL(url).pathname.split("/").filter(Boolean).pop();
      if (last) filename = decodeURIComponent(last);
    } catch { /* URL解析に失敗した場合は既定のファイル名を使う */ }
    if (!filename.toLowerCase().endsWith(".pdf")) filename += ".pdf";

    const file = new File([blob], filename, { type: "application/pdf" });
    await store.addFile(state.detailId, "pdf", file);
    els["pdf-url-input"].value = "";
    const item = await store.getItem(state.detailId);
    state._detailItem = item;
    renderDetail(item);
    loadItems();
    showToast("PDFを取り込みました");
  } catch {
    showToast("自動取得できませんでした。リンク先でPDFをダウンロードし「PDFを追加」から選んでください。");
  } finally {
    btn.disabled = false;
    btn.textContent = "取り込む";
  }
}

async function onRemoveFile(fileId) {
  if (!confirm("この写真/PDFを削除しますか？")) return;
  await store.deleteFile(fileId);
  const item = await store.getItem(state.detailId);
  state._detailItem = item;
  renderDetail(item);
  loadItems();
}

async function onDeleteItem() {
  if (!confirm("この説明書を削除しますか？写真・PDFもすべて削除されます。")) return;
  await store.deleteItem(state.detailId);
  els["detail-overlay"].hidden = true;
  loadItems();
}

function openLightbox(src) {
  els["lightbox-img"].src = src;
  els.lightbox.hidden = false;
}

init();
