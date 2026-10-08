const statusEl = document.getElementById('status');
const buttons = [...document.querySelectorAll('button')];

function show({ text, state }) {
  statusEl.textContent = text || '';
  statusEl.className = state || '';
  for (const b of buttons) b.disabled = state === 'working';
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.target === 'popup') show(msg);
});

// Se il popup viene riaperto a cattura in corso, riprende lo stato.
chrome.runtime.sendMessage({ target: 'background', type: 'status' }).then(
  (s) => s && s.busy && show(s),
  () => {}
);

for (const button of buttons) {
  button.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return show({ text: 'Nessuna scheda attiva', state: 'error' });

    show({ text: 'Preparo la cattura…', state: 'working' });
    const response = await chrome.runtime.sendMessage({
      target: 'background',
      type: 'capture',
      tabId: tab.id,
      area: button.dataset.area,
      format: button.dataset.format,
    });
    if (response && !response.ok) show({ text: response.error, state: 'error' });
  });
}
