// pdf-export.js — genera el PDF del presupuesto con jsPDF, usando la
// misma identidad tipográfica y de color que la app (Space Grotesk +
// JetBrains Mono, navy + ámbar) en vez de las fuentes genéricas por defecto.

export function formatARS(n) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('es-AR');
}

const MARGIN = 16;
const PAGE_W = 210;
const PAGE_H = 297;
const CONTENT_W = PAGE_W - MARGIN * 2;

// Paleta (RGB 0-255), igual a las variables de la app.
const C = {
  navy: [13, 23, 40],
  navyText: [24, 34, 51],
  onNavy: [238, 243, 250],
  onNavyDim: [173, 189, 214],
  amber: [245, 166, 35],
  amberDark: [143, 91, 10],
  textDim: [92, 102, 117],
  textFaint: [139, 147, 163],
  border: [227, 231, 238],
  zebra: [246, 248, 250],
  cardBg: [244, 246, 249],
  white: [255, 255, 255],
};

let fontsRegistered = false;
async function ensureFonts(doc) {
  const F = await import('./pdf-fonts.js');
  const files = [
    ['SpaceGrotesk-Bold.ttf', F.SpaceGrotesk_Bold, 'SGBold'],
    ['SpaceGrotesk-SemiBold.ttf', F.SpaceGrotesk_SemiBold, 'SGSemiBold'],
    ['SpaceGrotesk-Medium.ttf', F.SpaceGrotesk_Medium, 'SGMedium'],
    ['JetBrainsMono-SemiBold.ttf', F.JetBrainsMono_SemiBold, 'JBMSemiBold'],
    ['JetBrainsMono-Regular.ttf', F.JetBrainsMono_Regular, 'JBMRegular'],
  ];
  for (const [file, data, family] of files) {
    doc.addFileToVFS(file, data);
    doc.addFont(file, family, 'normal');
  }
  fontsRegistered = true;
}

function newDoc() {
  const { jsPDF } = window.jspdf;
  return new jsPDF({ unit: 'mm', format: 'a4' });
}

function setColor(doc, method, rgb) { doc[method](rgb[0], rgb[1], rgb[2]); }

function ensureSpace(doc, y, needed) {
  if (y + needed > PAGE_H - 26) {
    doc.addPage();
    return 22;
  }
  return y;
}

/** Agrupa los ítems del presupuesto por categoría, preservando el orden
 * de primera aparición. Los ítems sin categoría (personalizados) van bajo
 * "Ítems adicionales". */
function groupItems(items) {
  const groups = [];
  const byName = new Map();
  for (const it of items) {
    const name = it.categoriaNombre || 'Ítems adicionales';
    if (!byName.has(name)) {
      const g = { nombre: name, items: [] };
      byName.set(name, g);
      groups.push(g);
    }
    byName.get(name).items.push(it);
  }
  return groups;
}

export async function buildQuotePdf(quote, business) {
  const doc = newDoc();
  if (!fontsRegistered) await ensureFonts(doc);

  const colX = { desc: MARGIN + 2, cant: 122, precio: 142, subtotal: PAGE_W - MARGIN };

  // ---------- Encabezado (banda navy) ----------
  doc.setFont('SGMedium', 'normal');
  doc.setFontSize(8.3);
  const metaBits = [business.responsable, business.telefono, business.direccion].filter(Boolean);
  const metaLines = metaBits.length ? doc.splitTextToSize(metaBits.join('   ·   '), 118) : [];
  const secondLineBits = [business.email, business.cuit ? `CUIT ${business.cuit}` : null].filter(Boolean);
  const secondLines = secondLineBits.length ? doc.splitTextToSize(secondLineBits.join('   ·   '), 118) : [];

  const HEAD_H = Math.max(34, 26 + (metaLines.length + secondLines.length) * 4.4);
  setColor(doc, 'setFillColor', C.navy);
  doc.rect(0, 0, PAGE_W, HEAD_H, 'F');
  setColor(doc, 'setFillColor', C.amber);
  doc.rect(0, HEAD_H - 1.4, PAGE_W, 1.4, 'F');

  let textX = MARGIN;
  if (business.logoDataUrl) {
    try {
      const dims = await getImageDims(business.logoDataUrl);
      const chip = 20;
      setColor(doc, 'setFillColor', C.white);
      doc.roundedRect(MARGIN, 7, chip, chip, 2.2, 2.2, 'F');
      const maxW = chip - 4, maxH = chip - 4;
      let w = maxW, h = (dims.h / dims.w) * w;
      if (h > maxH) { h = maxH; w = (dims.w / dims.h) * h; }
      doc.addImage(business.logoDataUrl, MARGIN + (chip - w) / 2, 7 + (chip - h) / 2, w, h);
      textX = MARGIN + chip + 6;
    } catch (e) { /* logo inválido, seguimos sin él */ }
  }

  doc.setFont('SGBold', 'normal');
  doc.setFontSize(16);
  setColor(doc, 'setTextColor', C.white);
  doc.text(business.nombre || 'Instalaciones eléctricas', textX, 16);

  let metaY = 22.5;
  doc.setFont('SGMedium', 'normal');
  doc.setFontSize(8.3);
  setColor(doc, 'setTextColor', C.onNavyDim);
  if (metaLines.length) { doc.text(metaLines, textX, metaY); metaY += metaLines.length * 4.4; }
  if (secondLines.length) { doc.text(secondLines, textX, metaY); }

  doc.setFont('SGBold', 'normal');
  doc.setFontSize(13);
  setColor(doc, 'setTextColor', C.amber);
  doc.text('PRESUPUESTO', PAGE_W - MARGIN, 13, { align: 'right' });
  doc.setFont('JBMRegular', 'normal');
  doc.setFontSize(8.5);
  setColor(doc, 'setTextColor', C.onNavy);
  doc.text(`N.° ${quote.numero || '—'}`, PAGE_W - MARGIN, 19, { align: 'right' });
  setColor(doc, 'setTextColor', C.onNavyDim);
  doc.text(formatDate(quote.fecha), PAGE_W - MARGIN, 23.6, { align: 'right' });
  if (quote.validezDias) {
    doc.text(`Válido ${quote.validezDias} días`, PAGE_W - MARGIN, 28.2, { align: 'right' });
  }

  let y = HEAD_H + 10;

  // ---------- Tarjeta de cliente ----------
  const cardH = 20;
  setColor(doc, 'setFillColor', C.cardBg);
  doc.roundedRect(MARGIN, y, CONTENT_W, cardH, 2.4, 2.4, 'F');
  setColor(doc, 'setFillColor', C.amber);
  doc.roundedRect(MARGIN, y, 2.6, cardH, 1.3, 1.3, 'F');
  doc.rect(MARGIN + 1.3, y, 1.3, cardH, 'F');

  doc.setFont('SGSemiBold', 'normal');
  doc.setFontSize(7.2);
  setColor(doc, 'setTextColor', C.textFaint);
  doc.text('CLIENTE', MARGIN + 8, y + 6.5);

  const c = quote.cliente || {};
  doc.setFont('SGSemiBold', 'normal');
  doc.setFontSize(11);
  setColor(doc, 'setTextColor', C.navyText);
  doc.text(c.nombre || 'Consumidor final', MARGIN + 8, y + 12.5);

  const clientMeta = [c.direccion, c.telefono, c.email].filter(Boolean).join('   ·   ');
  if (clientMeta) {
    doc.setFont('SGMedium', 'normal');
    doc.setFontSize(8.2);
    setColor(doc, 'setTextColor', C.textDim);
    doc.text(clientMeta, MARGIN + 8, y + 17, { maxWidth: CONTENT_W - 16 });
  }

  y += cardH + 9;

  // ---------- Tabla de ítems, agrupada por categoría ----------
  function tableHeader() {
    doc.setFont('SGSemiBold', 'normal');
    doc.setFontSize(7);
    setColor(doc, 'setTextColor', C.textFaint);
    doc.text('DESCRIPCIÓN', colX.desc, y);
    doc.text('CANT.', colX.cant, y, { align: 'right' });
    doc.text('P. UNIT.', colX.precio + 14, y, { align: 'right' });
    doc.text('SUBTOTAL', colX.subtotal, y, { align: 'right' });
    y += 2.2;
    setColor(doc, 'setDrawColor', C.navyText);
    doc.setLineWidth(0.35);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 5.5;
  }

  function categoryLabel(nombre) {
    y = ensureSpace(doc, y, 9);
    doc.setFont('SGSemiBold', 'normal');
    doc.setFontSize(8.3);
    setColor(doc, 'setTextColor', C.amberDark);
    doc.text(nombre.toUpperCase(), MARGIN, y);
    y += 1.6;
    doc.setDrawColor(C.border[0], C.border[1], C.border[2]);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 5.2;
  }

  const items = quote.items || [];
  if (!items.length) {
    tableHeader();
    doc.setFont('SGMedium', 'normal');
    doc.setFontSize(9.5);
    setColor(doc, 'setTextColor', C.textFaint);
    doc.text('Sin ítems cargados.', PAGE_W / 2, y + 6, { align: 'center' });
    y += 16;
  } else {
    tableHeader();
    const groups = groupItems(items);
    groups.forEach((group, gi) => {
      categoryLabel(group.nombre);
      group.items.forEach((it, idx) => {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        const descLines = doc.splitTextToSize(it.descripcion || '', 98);
        const rowH = Math.max(6.4, descLines.length * 4.1 + 2.2);
        y = ensureSpace(doc, y, rowH + 2);

        if (idx % 2 === 1) {
          setColor(doc, 'setFillColor', C.zebra);
          doc.rect(MARGIN, y - 4.4, CONTENT_W, rowH, 'F');
        }

        setColor(doc, 'setTextColor', C.navyText);
        doc.text(descLines, colX.desc, y);
        doc.setFont('JBMRegular', 'normal');
        doc.setFontSize(8.6);
        doc.text(String(it.cantidad), colX.cant, y, { align: 'right' });
        setColor(doc, 'setTextColor', C.textDim);
        doc.text(formatARS(it.precioUnitario), colX.precio + 14, y, { align: 'right' });
        setColor(doc, 'setTextColor', C.navyText);
        doc.text(formatARS(it.cantidad * it.precioUnitario), colX.subtotal, y, { align: 'right' });
        y += rowH;
      });
      if (gi < groups.length - 1) y += 2.5;
    });
  }

  y += 3;
  setColor(doc, 'setDrawColor', C.border);
  doc.setLineWidth(0.2);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 8;

  // ---------- Totales ----------
  const totals = computeTotals(quote);
  y = ensureSpace(doc, y, 46);
  const totalsX1 = 122, totalsX2 = PAGE_W - MARGIN;

  function miniRow(label, value) {
    doc.setFont('SGMedium', 'normal');
    doc.setFontSize(8.6);
    setColor(doc, 'setTextColor', C.textDim);
    doc.text(label, totalsX1, y);
    doc.setFont('JBMRegular', 'normal');
    setColor(doc, 'setTextColor', C.navyText);
    doc.text(value, totalsX2, y, { align: 'right' });
    y += 5.4;
  }

  miniRow('Subtotal', `$ ${formatARS(totals.subtotal)}`);
  if (totals.descuento > 0) miniRow(`Descuento (${quote.descuentoPorc || 0}%)`, `- $ ${formatARS(totals.descuento)}`);
  if (quote.aplicaIva) miniRow(`IVA (${quote.ivaPorc || 21}%)`, `$ ${formatARS(totals.iva)}`);

  y += 1.5;
  const totalBandH = 13.5;
  setColor(doc, 'setFillColor', C.navy);
  doc.roundedRect(totalsX1 - 6, y, (totalsX2 - totalsX1) + 6, totalBandH, 2.2, 2.2, 'F');
  doc.setFont('SGBold', 'normal');
  doc.setFontSize(10.5);
  setColor(doc, 'setTextColor', C.amber);
  doc.text('TOTAL', totalsX1, y + 8.6);
  doc.setFont('JBMSemiBold', 'normal');
  doc.setFontSize(13.5);
  setColor(doc, 'setTextColor', C.white);
  doc.text(`$ ${formatARS(totals.total)}`, totalsX2, y + 8.8, { align: 'right' });
  y += totalBandH + 9;

  // ---------- Notas ----------
  if (quote.notas) {
    y = ensureSpace(doc, y, 24);
    doc.setFont('SGSemiBold', 'normal');
    doc.setFontSize(7.2);
    setColor(doc, 'setTextColor', C.textFaint);
    doc.text('CONDICIONES / NOTAS', MARGIN, y);
    y += 4.6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.4);
    setColor(doc, 'setTextColor', C.textDim);
    const noteLines = doc.splitTextToSize(quote.notas, CONTENT_W - 4);
    doc.text(noteLines, MARGIN, y);
    y += noteLines.length * 4.1;
  }

  // ---------- Pie de página ----------
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    setColor(doc, 'setDrawColor', C.border);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, PAGE_H - 18, PAGE_W - MARGIN, PAGE_H - 18);
    doc.setFont('SGMedium', 'normal');
    doc.setFontSize(7);
    setColor(doc, 'setTextColor', C.textFaint);
    doc.text(
      'Presupuesto de referencia según costos sugeridos AAIERIC · Válido según condiciones indicadas.',
      MARGIN, PAGE_H - 13
    );
    doc.setFont('JBMRegular', 'normal');
    doc.text(`${p} / ${pageCount}`, PAGE_W - MARGIN, PAGE_H - 13, { align: 'right' });
  }

  return doc;
}

export function computeTotals(quote) {
  const items = quote.items || [];
  const subtotal = items.reduce((s, it) => s + (Number(it.cantidad) || 0) * (Number(it.precioUnitario) || 0), 0);
  const descuentoPorc = Number(quote.descuentoPorc) || 0;
  const descuento = subtotal * (descuentoPorc / 100);
  const base = subtotal - descuento;
  const ivaPorc = Number(quote.ivaPorc) || 0;
  const iva = quote.aplicaIva ? base * (ivaPorc / 100) : 0;
  const total = base + iva;
  return { subtotal, descuento, base, iva, total };
}

function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-AR');
}

function getImageDims(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.width, h: img.height });
    img.onerror = reject;
    img.src = dataUrl;
  });
}
