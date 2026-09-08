import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";


export const MAX_PDF_SIZE_BYTES = 10 * 1024 * 1024;

function pageText(items) {
  return items
    .map((item) => {
      if (!("str" in item)) return "";
      return item.str + (item.hasEOL ? "\n" : " ");
    })
    .join("")
    .replace(/[^\S\n]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function getTextContentSafariSafe(page) {
  const stream = page.streamTextContent();
  const reader = stream.getReader();

  const items = [];

  try {
    while (true) {
      const { value, done } = await reader.read();

      if (done) break;

      if (value?.items) {
        items.push(...value.items);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return items;
}

export async function extractPdfText(file) {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const data = new Uint8Array(await file.arrayBuffer());

  const loadingTask = pdfjsLib.getDocument({
    data,
    disableFontFace: true,
  });

  try {
    const pdf = await loadingTask.promise;
    const pages = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);

      const items = await getTextContentSafariSafe(page);
      const text = pageText(items);

      if (text) {
        pages.push(text);
      }

      page.cleanup();
    }

    return pages.join("\n\n").trim();
  } finally {
    await loadingTask.destroy();
  }
}