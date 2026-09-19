// PDF内の文字を全文検索できるよう、保存時にテキストを抽出しておく。
// OCRではないので、スキャン画像だけのPDF(文字レイヤーが無いもの)は抽出できない。
import * as pdfjsLib from "../vendor/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;

const MAX_CHARS = 200000; // 1PDFあたりの抽出上限(巨大PDFでの処理時間・保存容量を抑える)

export async function extractPdfText(blob) {
  const loadingTask = pdfjsLib.getDocument({ data: await blob.arrayBuffer() });
  try {
    const doc = await loadingTask.promise;
    let text = "";
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((it) => it.str).join(" ") + "\n";
      if (text.length > MAX_CHARS) break;
    }
    return text.slice(0, MAX_CHARS).trim();
  } catch {
    return "";
  } finally {
    loadingTask.destroy();
  }
}
