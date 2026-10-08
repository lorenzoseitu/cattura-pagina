// Documento offscreen: riceve i fotogrammi dal service worker, li unisce su canvas
// e restituisce il blob URL del JPG o del PDF finito.

const MAX_SIDE = 16000; // un canvas di Chrome arriva a 16.384 px per lato
const MAX_AREA = 200e6; // e a circa 268 milioni di pixel in tutto
const PDF_SEGMENT_AREA = 100e6;
const PDF_SEGMENT_HEIGHT = 12000;
const JPEG_QUALITY = 0.92;

let job = null;
let lastUrl = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return;
  handle(msg).then(
    (result) => sendResponse({ ok: true, ...result }),
    (err) => sendResponse({ ok: false, error: String((err && err.message) || err) })
  );
  return true;
});

async function handle(msg) {
  if (msg.type === 'begin') return begin(msg);
  if (msg.type === 'frame') return addFrame(msg);
  if (msg.type === 'finish') return finish();
  throw new Error(`Messaggio sconosciuto: ${msg.type}`);
}

function begin({ mode, viewportWidth, totalHeight }) {
  if (lastUrl) {
    URL.revokeObjectURL(lastUrl);
    lastUrl = null;
  }
  // totalHeight in pixel CSS; null = alta quanto il primo fotogramma
  job = { mode, viewportWidth, totalHeight, segments: null, maxBottom: 0 };
  return {};
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Fotogramma non leggibile'));
    img.src = dataUrl;
  });
}

// Alla prima immagine si conosce la scala reale (pixel dello schermo per pixel CSS)
// e si decide come dividere l'uscita in segmenti.
function setup(img) {
  const scale = img.naturalWidth / job.viewportWidth;
  const fullW = img.naturalWidth;
  const fullH = job.totalHeight ? Math.round(job.totalHeight * scale) : img.naturalHeight;

  let factor = 1;
  let segmentHeight;
  if (job.mode === 'pdf') {
    segmentHeight = Math.max(1000, Math.min(PDF_SEGMENT_HEIGHT, Math.floor(PDF_SEGMENT_AREA / fullW)));
  } else {
    // JPG: un file solo, ridotto in scala se supera i limiti del canvas
    factor = Math.min(1, MAX_SIDE / fullH, MAX_SIDE / fullW, Math.sqrt(MAX_AREA / (fullW * fullH)));
    segmentHeight = Infinity;
  }

  job.scale = scale;
  job.factor = factor;
  job.width = Math.max(1, Math.round(fullW * factor));
  job.height = Math.max(1, Math.round(fullH * factor));
  job.segments = [];
  for (let start = 0; start < job.height; start += segmentHeight) {
    job.segments.push({
      start,
      end: Math.min(job.height, start + segmentHeight),
      canvas: null,
      result: null,
    });
  }
}

function segmentContext(seg) {
  if (!seg.canvas) {
    seg.canvas = document.createElement('canvas');
    seg.canvas.width = job.width;
    seg.canvas.height = seg.end - seg.start;
    const ctx = seg.canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, seg.canvas.width, seg.canvas.height);
  }
  return seg.canvas.getContext('2d');
}

function toJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Immagine troppo grande per essere salvata'))),
      'image/jpeg',
      JPEG_QUALITY
    );
  });
}

// Chiude un segmento: lo taglia all'altezza finale, lo converte in JPEG e libera il canvas.
function finalize(seg, finalHeight) {
  if (seg.result) return;
  const height = Math.min(seg.end, finalHeight) - seg.start;
  if (height <= 0 || !seg.canvas) {
    seg.result = Promise.resolve(null);
    return;
  }
  let canvas = seg.canvas;
  if (height < canvas.height) {
    const cropped = document.createElement('canvas');
    cropped.width = canvas.width;
    cropped.height = height;
    cropped.getContext('2d').drawImage(canvas, 0, 0);
    canvas.width = 0;
    canvas = cropped;
  }
  const width = canvas.width;
  seg.result = toJpeg(canvas).then((blob) => {
    canvas.width = 0;
    return { blob, width, height };
  });
  seg.canvas = null;
}

async function addFrame({ dataUrl, y }) {
  if (!job) throw new Error('Nessuna cattura in corso');
  const img = await loadImage(dataUrl);
  if (!job.segments) setup(img);

  const top = Math.round(y * job.scale * job.factor);
  const drawHeight = Math.ceil(img.naturalHeight * job.factor);
  const bottom = top + drawHeight;

  for (const seg of job.segments) {
    if (seg.result || seg.end <= top || seg.start >= bottom) continue;
    segmentContext(seg).drawImage(img, 0, top - seg.start, job.width, drawHeight);
  }
  job.maxBottom = Math.max(job.maxBottom, bottom);

  // I fotogrammi arrivano dall'alto verso il basso: i segmenti già superati sono completi.
  for (const seg of job.segments) {
    if (seg.end <= top) finalize(seg, job.height);
  }
  return {};
}

async function finish() {
  if (!job || !job.segments) throw new Error('Nessun fotogramma ricevuto');
  const finalHeight = Math.min(job.height, job.maxBottom);
  for (const seg of job.segments) finalize(seg, finalHeight);
  const parts = (await Promise.all(job.segments.map((s) => s.result))).filter(Boolean);
  if (!parts.length) throw new Error('Nessuna immagine prodotta');

  let blob;
  if (job.mode === 'pdf') {
    const pages = [];
    for (const part of parts) {
      pages.push({
        jpeg: new Uint8Array(await part.blob.arrayBuffer()),
        width: part.width,
        height: part.height,
      });
    }
    blob = new Blob([buildPdf(pages)], { type: 'application/pdf' });
  } else {
    blob = parts[0].blob;
  }

  const result = {
    url: URL.createObjectURL(blob),
    pages: parts.length,
    scaled: job.factor < 1,
    width: job.width,
    height: finalHeight,
    bytes: blob.size,
  };
  lastUrl = result.url;
  job = null;
  return result;
}
