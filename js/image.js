// 写真はスマホカメラの生データだと数MB・数千px四方になり、そのままIndexedDBに保存して
// 複数枚まとめて描画するとモバイルSafari/PWAでレンダラーがクラッシュすることがある
// (「問題が繰り返し起きました」)。保存時に縮小・再圧縮し、表示時もさらに縮小版を使う。

async function loadBitmap(blobOrFile) {
  return createImageBitmap(blobOrFile);
}

function drawScaled(bitmap, maxDim) {
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  return canvas;
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

// 保存前に呼ぶ: 長辺1600pxまでに縮小してJPEG化する。失敗したら元のファイルをそのまま返す
export async function compressPhoto(file, { maxDim = 1600, quality = 0.82 } = {}) {
  try {
    const bitmap = await loadBitmap(file);
    const canvas = drawScaled(bitmap, maxDim);
    bitmap.close?.();
    const blob = await canvasToBlob(canvas, quality);
    if (!blob) return file;
    const base = (file.name || "photo").replace(/\.[^.]+$/, "");
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

// 表示用に一時的にさらに縮小した object URL を作る(呼び出し側で revoke すること)。
// 縮小に失敗した場合は元のBlobからそのまま作る。
export async function scaledObjectUrl(blob, maxDim = 480) {
  try {
    const bitmap = await loadBitmap(blob);
    if (Math.max(bitmap.width, bitmap.height) <= maxDim) {
      bitmap.close?.();
      return URL.createObjectURL(blob);
    }
    const canvas = drawScaled(bitmap, maxDim);
    bitmap.close?.();
    const scaledBlob = await canvasToBlob(canvas, 0.8);
    return URL.createObjectURL(scaledBlob || blob);
  } catch {
    return URL.createObjectURL(blob);
  }
}
