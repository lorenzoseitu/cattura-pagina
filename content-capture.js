// Funzioni iniettate nella pagina con chrome.scripting.executeScript.
// Vengono serializzate una per una: ognuna deve bastare a se stessa.
// Lo stato tra una chiamata e l'altra vive in window.__catturaPagina.

// Prepara la pagina: nasconde la scrollbar, scorre fino in fondo per far caricare
// i contenuti lazy-load, torna in cima e restituisce le misure.
async function pagePrepare(maxSteps) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const height = () =>
    Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);

  if (!window.__catturaPagina) {
    window.__catturaPagina = {
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      changed: [],
      seen: new WeakSet(),
    };
    const style = document.createElement('style');
    style.id = '__cattura-pagina-style';
    style.textContent =
      'html::-webkit-scrollbar,body::-webkit-scrollbar{display:none!important}' +
      'html,body{scroll-behavior:auto!important}';
    document.documentElement.appendChild(style);
  }

  const vh = window.innerHeight;
  let y = 0;
  let steps = 0;
  while (y < height() - vh && steps < maxSteps) {
    y += vh;
    window.scrollTo(0, y);
    await sleep(120);
    steps++;
  }
  window.scrollTo(0, 0);
  await sleep(350);

  return {
    totalHeight: height(),
    viewportHeight: vh,
    viewportWidth: window.innerWidth,
  };
}

// Scorre a y e nasconde gli elementi che si ripeterebbero in ogni fotogramma.
// hideMode: null = niente, 'bottom' = solo i fixed ancorati in basso (primo fotogramma),
// 'all' = tutti i fixed, e gli sticky tornano nel flusso normale.
// Restituisce la posizione di scorrimento reale.
async function pageStep(y, hideMode) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const st = window.__catturaPagina;

  window.scrollTo(0, y);
  await sleep(150);

  if (st && hideMode) {
    const vh = window.innerHeight;
    for (const el of document.querySelectorAll('body *')) {
      if (st.seen.has(el)) continue;
      const position = getComputedStyle(el).position;
      if (position === 'fixed') {
        if (hideMode === 'bottom' && el.getBoundingClientRect().top < vh / 2) continue;
        st.seen.add(el);
        st.changed.push([el, el.getAttribute('style')]);
        el.style.setProperty('visibility', 'hidden', 'important');
      } else if (position === 'sticky' && hideMode === 'all') {
        st.seen.add(el);
        st.changed.push([el, el.getAttribute('style')]);
        el.style.setProperty('position', 'relative', 'important');
        el.style.setProperty('inset', 'auto', 'important');
      }
    }
    await sleep(120);
  }

  return window.scrollY;
}

// Rimette la pagina com'era.
function pageRestore() {
  const st = window.__catturaPagina;
  if (!st) return;
  for (let i = st.changed.length - 1; i >= 0; i--) {
    const [el, style] = st.changed[i];
    if (style === null) el.removeAttribute('style');
    else el.setAttribute('style', style);
  }
  const style = document.getElementById('__cattura-pagina-style');
  if (style) style.remove();
  window.scrollTo(st.scrollX, st.scrollY);
  delete window.__catturaPagina;
}
