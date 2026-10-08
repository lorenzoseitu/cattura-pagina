# Cattura pagina — estensione Chrome

Salva la pagina web aperta come **JPG** o **PDF**, solo la parte visibile oppure la pagina intera.
Nessuna libreria esterna, nessuna chiamata di rete: tutto resta sul computer.

## Browser

- **Chrome** su computer (versione 116 o successiva): provata, funziona.
- **Edge, Brave, Vivaldi, Opera, Arc**: usano lo stesso motore e le stesse estensioni di Chrome, quindi dovrebbe funzionare, ma non è stata provata. La pagina delle estensioni si apre con `edge://extensions`, `brave://extensions` e simili.
- **Firefox e Safari**: non funziona.
- **Telefono** (Android e iPhone): non funziona, Chrome su telefono non accetta estensioni.

## Installazione

1. Scarica l'estensione: in questa pagina GitHub clicca **Code → Download ZIP** e decomprimi il file
2. Apri `chrome://extensions`
3. Attiva **Modalità sviluppatore** (in alto a destra)
4. **Carica estensione non pacchettizzata** → scegli la cartella decompressa (quella che contiene `manifest.json`)
5. Fissa l'icona nella barra dal menu a puzzle

La cartella deve restare dov'è: se la sposti o la cancelli, l'estensione smette di funzionare.

Per aggiornare: scarica di nuovo lo ZIP, sostituisci la cartella, poi `chrome://extensions` → freccia di ricarica sulla scheda dell'estensione.

## Uso

Clic sull'icona, poi uno dei quattro pulsanti:

| | JPG | PDF |
|---|---|---|
| **Pagina intera** | un'immagine unica | una pagina continua |
| **Parte visibile** | quello che si vede | quello che si vede |

Il file finisce in Download con nome `titolo-pagina_AAAA-MM-GG_HHmm.jpg` (o `.pdf`).
Durante la cattura della pagina intera la scheda deve restare in primo piano: la pagina scorre da sola e alla fine torna dov'era.

Il PDF contiene un'immagine: è identico allo schermo, il testo non è selezionabile.

## Come funziona

- `popup.*` — i quattro pulsanti; passa la richiesta al service worker
- `background.js` — orchestra: scorre, cattura un fotogramma per schermata (2 al secondo, limite di Chrome), avvia il download
- `content-capture.js` — funzioni iniettate nella pagina: pre-scorrimento per il lazy-load, scrollbar nascosta, elementi `fixed` nascosti e `sticky` rimessi nel flusso dopo il primo fotogramma, ripristino finale
- `offscreen.*` — unisce i fotogrammi su canvas e produce JPEG o PDF
- `pdf.js` — scrittore PDF minimale, incorpora il JPEG così com'è

Permessi: `activeTab`, `scripting`, `downloads`, `offscreen`. L'estensione vede la scheda solo dopo il clic sull'icona.

## Limiti noti

- Pagine interne di Chrome (`chrome://`), Web Store e visualizzatore PDF non si possono catturare.
- File locali (`file://`): serve attivare "Consenti l'accesso agli URL dei file" nei dettagli dell'estensione.
- Siti che scorrono dentro un riquadro interno invece che sul documento (alcune web app): la pagina intera cattura solo la schermata.
- Animazioni che partono allo scorrimento possono comparire a metà.
- Pagine molto lunghe: il JPG oltre 16.000 px di altezza viene ridotto in scala; il PDF viene diviso in più pagine (il taglio può cadere a metà riga). Oltre 60 schermate la pagina viene troncata.
