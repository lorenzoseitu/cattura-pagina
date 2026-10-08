// Service worker: orchestra la cattura, così il lavoro continua anche se il popup si chiude.

importScripts('content-capture.js');

const MAX_FRAMES = 60; // oltre, la pagina viene troncata
const CAPTURE_INTERVAL_MS = 550; // Chrome ammette 2 catture al secondo

let busy = false;
let lastStatus = { text: '', state: 'idle' };
let lastCaptureAt = 0;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'background') return;
  if (msg.type === 'status') {
    sendResponse({ busy, ...lastStatus });
    return;
  }
  if (msg.type === 'capture') {
    if (busy) {
      sendResponse({ ok: false, error: 'Cattura già in corso' });
      return;
    }
    sendResponse({ ok: true });
    run(msg);
  }
});

// A download finito il documento offscreen (che tiene in vita il blob) non serve più.
chrome.downloads.onChanged.addListener(async (delta) => {
  if (!delta.state || delta.state.current === 'in_progress' || busy) return;
  const [item] = await chrome.downloads.search({ id: delta.id });
  if (!item || item.byExtensionId !== chrome.runtime.id) return;
  if (await hasOffscreen()) await chrome.offscreen.closeDocument().catch(() => {});
});

async function run({ tabId, area, format }) {
  busy = true;
  report('Preparo la cattura…', 'working');
  try {
    const tab = await chrome.tabs.get(tabId);
    await ensureOffscreen();
    const notes = area === 'full' ? await captureFull(tab, format) : await captureVisible(tab, format);

    report('Compongo il file…', 'working');
    const result = await toOffscreen({ type: 'finish' });
    await chrome.downloads.download({
      url: result.url,
      filename: fileName(tab, format),
      saveAs: false,
    });

    if (result.scaled) notes.push('immagine ridotta in scala perché troppo lunga');
    if (format === 'pdf' && result.pages > 1) notes.push(`${result.pages} pagine`);
    report(`Salvato in Download${notes.length ? ` (${notes.join(', ')})` : ''}`, 'done');
  } catch (err) {
    report(friendlyError(err), 'error');
  } finally {
    busy = false;
  }
}

async function captureVisible(tab, format) {
  await toOffscreen({ type: 'begin', mode: format, viewportWidth: tab.width || 1, totalHeight: null });
  await toOffscreen({ type: 'frame', dataUrl: await grab(tab), y: 0 });
  return [];
}

async function captureFull(tab, format) {
  const exec = async (func, args = []) => {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args });
    return injection.result;
  };
  const notes = [];

  try {
    const info = await exec(pagePrepare, [MAX_FRAMES]);
    const vh = info.viewportHeight;
    let total = Math.max(info.totalHeight, vh);
    if (total > vh * MAX_FRAMES) {
      total = vh * MAX_FRAMES;
      notes.push('pagina troncata perché troppo lunga');
    }

    const positions = [];
    for (let y = 0; y < total; y += vh) positions.push(Math.min(y, total - vh));

    await toOffscreen({
      type: 'begin',
      mode: format,
      viewportWidth: info.viewportWidth,
      totalHeight: total,
    });

    for (let i = 0; i < positions.length; i++) {
      report(`Cattura ${i + 1} di ${positions.length}…`, 'working');
      const hideMode = positions.length === 1 ? null : i === 0 ? 'bottom' : 'all';
      const y = await exec(pageStep, [positions[i], hideMode]);
      await toOffscreen({ type: 'frame', dataUrl: await grab(tab), y });
    }
  } finally {
    await exec(pageRestore).catch(() => {});
  }
  return notes;
}

// Una cattura della parte visibile, rispettando il limite di frequenza di Chrome.
async function grab(tab) {
  const wait = lastCaptureAt + CAPTURE_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));

  const current = await chrome.tabs.get(tab.id);
  if (!current.active) throw new Error('TAB_CHANGED');

  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  lastCaptureAt = Date.now();
  return dataUrl;
}

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS'],
    justification: 'Unire i fotogrammi catturati e generare il file JPG o PDF da scaricare.',
  });
}

async function toOffscreen(message) {
  const response = await chrome.runtime.sendMessage({ target: 'offscreen', ...message });
  if (!response || !response.ok) throw new Error((response && response.error) || 'Composizione non riuscita');
  return response;
}

function fileName(tab, format) {
  let host = '';
  try {
    host = new URL(tab.url).hostname;
  } catch {}
  const base =
    (tab.title || host || 'pagina')
      .replace(/[\\/:*?"<>|~\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s.]+|[\s.]+$/g, '')
      .slice(0, 80)
      .trim() || 'pagina';
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  return `${base}_${stamp}.${format}`;
}

function friendlyError(err) {
  const message = String((err && err.message) || err);
  if (message === 'TAB_CHANGED') return 'Cattura interrotta: la scheda non è più in primo piano';
  if (/cannot be scripted|Cannot access|chrome:\/\/|extensions gallery|activeTab/i.test(message)) {
    return 'Questa pagina non si può catturare (pagine interne di Chrome, Web Store, file locali senza permesso)';
  }
  return `Errore: ${message}`;
}

function report(text, state) {
  lastStatus = { text, state };
  const badge = { working: '…', done: 'OK', error: 'ERR', idle: '' }[state];
  chrome.action.setBadgeText({ text: badge });
  chrome.action.setBadgeBackgroundColor({ color: state === 'error' ? '#c62828' : '#2e7d32' });
  if (state === 'done' || state === 'error') {
    setTimeout(() => {
      if (!busy) chrome.action.setBadgeText({ text: '' });
    }, 5000);
  }
  chrome.runtime.sendMessage({ target: 'popup', text, state }).catch(() => {});
}
