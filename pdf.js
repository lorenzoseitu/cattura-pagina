// Scrittore PDF minimale: una pagina per ogni JPEG, incorporato così com'è (filtro DCTDecode).
// pages: [{ jpeg: Uint8Array, width: px, height: px }]
// Ogni pagina è larga pageWidthPt e alta in proporzione all'immagine.
function buildPdf(pages, pageWidthPt = 595.28) {
  const MAX_PAGE_PT = 14400; // limite del formato PDF
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let offset = 0;

  const push = (data) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    offset += bytes.length;
  };
  const startObj = (n) => {
    offsets[n] = offset;
    push(`${n} 0 obj\n`);
  };
  const num = (v) => String(Math.round(v * 100) / 100);

  push('%PDF-1.4\n%âãÏÓ\n');

  startObj(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  startObj(2);
  push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach((page, i) => {
    const pageObj = 3 + i * 3;
    const contentObj = pageObj + 1;
    const imageObj = pageObj + 2;

    let w = pageWidthPt;
    let h = (page.height / page.width) * w;
    if (h > MAX_PAGE_PT) {
      w = (w * MAX_PAGE_PT) / h;
      h = MAX_PAGE_PT;
    }

    startObj(pageObj);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(w)} ${num(h)}] ` +
        `/Resources << /XObject << /Im0 ${imageObj} 0 R >> >> /Contents ${contentObj} 0 R >>\nendobj\n`
    );

    const content = `q ${num(w)} 0 0 ${num(h)} 0 0 cm /Im0 Do Q`;
    startObj(contentObj);
    push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);

    startObj(imageObj);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`
    );
    push(page.jpeg);
    push('\nendstream\nendobj\n');
  });

  const count = 2 + pages.length * 3;
  const xrefOffset = offset;
  let xref = `xref\n0 ${count + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= count; n++) {
    xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const out = new Uint8Array(offset);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

if (typeof module !== 'undefined') module.exports = { buildPdf };
