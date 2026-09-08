// plano-pdf.js — informe en PDF del cálculo de Grado de Electrificación y
// Circuitos, con el plano marcado. Misma identidad visual que pdf-export.js.

const MARGIN = 16;
const PAGE_W = 210;
const PAGE_H = 297;
const CONTENT_W = PAGE_W - MARGIN * 2;

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

function newDoc() { const { jsPDF } = window.jspdf; return new jsPDF({ unit: 'mm', format: 'a4' }); }
function setColor(doc, method, rgb) { doc[method](rgb[0], rgb[1], rgb[2]); }
function ensureSpace(doc, y, needed) { if (y + needed > PAGE_H - 22) { doc.addPage(); return 20; } return y; }

export async function buildPlanoPdf({ plano, instalacion, materiales, business, snapshotDataUrl }) {
  const doc = newDoc();
  if (!fontsRegistered) await ensureFonts(doc);

  // ---------- Encabezado ----------
  const HEAD_H = 30;
  setColor(doc, 'setFillColor', C.navy);
  doc.rect(0, 0, PAGE_W, HEAD_H, 'F');
  setColor(doc, 'setFillColor', C.amber);
  doc.rect(0, HEAD_H - 1.4, PAGE_W, 1.4, 'F');

  doc.setFont('SGBold', 'normal');
  doc.setFontSize(15);
  setColor(doc, 'setTextColor', C.white);
  doc.text(business?.nombre || 'Instalaciones eléctricas', MARGIN, 14);
  doc.setFont('SGMedium', 'normal');
  doc.setFontSize(8.3);
  setColor(doc, 'setTextColor', C.onNavyDim);
  doc.text([business?.telefono, business?.direccion].filter(Boolean).join('   ·   '), MARGIN, 20);

  doc.setFont('SGBold', 'normal');
  doc.setFontSize(12.5);
  setColor(doc, 'setTextColor', C.amber);
  doc.text('GRADO DE ELECTRIFICACIÓN', PAGE_W - MARGIN, 13, { align: 'right' });
  doc.setFont('JBMRegular', 'normal');
  doc.setFontSize(8.5);
  setColor(doc, 'setTextColor', C.onNavy);
  doc.text('Informe de cálculo de circuitos', PAGE_W - MARGIN, 19, { align: 'right' });
  setColor(doc, 'setTextColor', C.onNavyDim);
  doc.text(new Date().toLocaleDateString('es-AR'), PAGE_W - MARGIN, 24.5, { align: 'right' });

  let y = HEAD_H + 9;

  // ---------- Datos del inmueble ----------
  const cardH = 22;
  setColor(doc, 'setFillColor', C.cardBg);
  doc.roundedRect(MARGIN, y, CONTENT_W, cardH, 2.4, 2.4, 'F');
  setColor(doc, 'setFillColor', C.amber);
  doc.roundedRect(MARGIN, y, 2.6, cardH, 1.3, 1.3, 'F');
  doc.rect(MARGIN + 1.3, y, 1.3, cardH, 'F');

  doc.setFont('SGSemiBold', 'normal');
  doc.setFontSize(7.2);
  setColor(doc, 'setTextColor', C.textFaint);
  doc.text('INMUEBLE', MARGIN + 8, y + 6.5);
  doc.setFont('SGSemiBold', 'normal');
  doc.setFontSize(11);
  setColor(doc, 'setTextColor', C.navyText);
  doc.text(`${plano.nombre || 'Sin nombre'} — ${plano.tipoInmuebleNombre || ''}`, MARGIN + 8, y + 12.5);
  doc.setFont('SGMedium', 'normal');
  doc.setFontSize(8.4);
  setColor(doc, 'setTextColor', C.textDim);
  doc.text(
    `Superficie: ${instalacion.superficieTotalM2.toFixed(1)} m²   ·   Grado: ${instalacion.grado.nombre}   ·   Potencia estimada: ${instalacion.grado.kva ? instalacion.grado.kva + ' kVA' : '—'}`,
    MARGIN + 8, y + 18
  );
  y += cardH + 8;

  // ---------- Imagen del plano ----------
  if (snapshotDataUrl) {
    try {
      const dims = await getImageDims(snapshotDataUrl);
      const maxW = CONTENT_W, maxH = 95;
      let w = maxW, h = (dims.h / dims.w) * w;
      if (h > maxH) { h = maxH; w = (dims.w / dims.h) * h; }
      const x = MARGIN + (CONTENT_W - w) / 2;
      y = ensureSpace(doc, y, h + 6);
      doc.addImage(snapshotDataUrl, x, y, w, h);
      setColor(doc, 'setDrawColor', C.border);
      doc.setLineWidth(0.3);
      doc.rect(x, y, w, h);
      y += h + 8;
    } catch (e) { /* si falla la imagen, seguimos con el informe igual */ }
  }

  // ---------- Tabla de ambientes ----------
  y = ensureSpace(doc, y, 14);
  doc.setFont('SGSemiBold', 'normal');
  doc.setFontSize(10.5);
  setColor(doc, 'setTextColor', C.navyText);
  doc.text('Ambientes y puntos mínimos de utilización', MARGIN, y);
  y += 6;

  const colX = { amb: MARGIN + 2, area: 105, iug: 128, tug: 150, tue: 172, tot: PAGE_W - MARGIN };
  function tableHeadAmb() {
    doc.setFont('SGSemiBold', 'normal');
    doc.setFontSize(7);
    setColor(doc, 'setTextColor', C.textFaint);
    doc.text('AMBIENTE', colX.amb, y);
    doc.text('ÁREA', colX.area, y, { align: 'right' });
    doc.text('IUG', colX.iug, y, { align: 'right' });
    doc.text('TUG', colX.tug, y, { align: 'right' });
    doc.text('TUE', colX.tue, y, { align: 'right' });
    doc.text('TOTAL', colX.tot, y, { align: 'right' });
    y += 2;
    setColor(doc, 'setDrawColor', C.navyText);
    doc.setLineWidth(0.35);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 5.5;
  }
  tableHeadAmb();
  instalacion.detalle.forEach((a, idx) => {
    y = ensureSpace(doc, y, 7);
    if (idx % 2 === 1) { setColor(doc, 'setFillColor', C.zebra); doc.rect(MARGIN, y - 4.2, CONTENT_W, 6.4, 'F'); }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    setColor(doc, 'setTextColor', C.navyText);
    doc.text(a.nombre || a.tipoAmbienteNombre || 'Ambiente', colX.amb, y);
    doc.setFont('JBMRegular', 'normal');
    doc.setFontSize(8.4);
    setColor(doc, 'setTextColor', C.textDim);
    doc.text(`${(a.areaM2 || 0).toFixed(1)} m²`, colX.area, y, { align: 'right' });
    doc.text(String(a.bocas.iug), colX.iug, y, { align: 'right' });
    doc.text(String(a.bocas.tug), colX.tug, y, { align: 'right' });
    doc.text(String(a.bocas.tue), colX.tue, y, { align: 'right' });
    setColor(doc, 'setTextColor', C.navyText);
    doc.text(String(a.bocas.total), colX.tot, y, { align: 'right' });
    y += 6.4;
  });
  y += 3;
  setColor(doc, 'setDrawColor', C.border);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 8;

  // ---------- Resumen de circuitos ----------
  y = ensureSpace(doc, y, 34);
  const bandH = 30;
  setColor(doc, 'setFillColor', C.navy);
  doc.roundedRect(MARGIN, y, CONTENT_W, bandH, 2.4, 2.4, 'F');
  const cols3 = [MARGIN + 6, MARGIN + CONTENT_W / 2 - 30, PAGE_W - MARGIN - 60];
  const chips = [
    ['Circuitos sugeridos', String(instalacion.circuitosSugeridos)],
    ['Bocas totales', String(instalacion.totalBocas)],
    ['Sección ramal ppal.', `${materiales.seccionRamalMm2} mm²`],
  ];
  chips.forEach(([label, value], i) => {
    doc.setFont('SGMedium', 'normal');
    doc.setFontSize(7.6);
    setColor(doc, 'setTextColor', C.onNavyDim);
    doc.text(label.toUpperCase(), cols3[i], y + 10);
    doc.setFont('JBMSemiBold', 'normal');
    doc.setFontSize(15);
    setColor(doc, 'setTextColor', C.amber);
    doc.text(value, cols3[i], y + 21);
  });
  y += bandH + 10;

  // ---------- Materiales estimados ----------
  y = ensureSpace(doc, y, 14);
  doc.setFont('SGSemiBold', 'normal');
  doc.setFontSize(10.5);
  setColor(doc, 'setTextColor', C.navyText);
  doc.text('Materiales estimados', MARGIN, y);
  y += 6;

  const matRows = [
    ['Cajas octogonales (luz)', materiales.cajasOctogonales],
    ['Cajas rectangulares (tomas)', materiales.cajasRectangulares],
    ['Módulos de toma', materiales.modulosToma],
    ['Módulos de llave/interruptor', materiales.modulosLlave],
    ['Tapas ciegas (repuesto)', materiales.tapasCiegas],
    ['Termomagnéticas', materiales.termomagneticas],
    ['Diferenciales (30 mA)', materiales.diferenciales],
    ['Tableros', materiales.tableros],
    ['Caño corrugado/PVC (canalizaciones)', `${materiales.metrosCanoCorrugado} m`],
    ['Cable por circuitos', materiales.metrosCableCircuitos],
  ];
  matRows.forEach(([label, value], idx) => {
    y = ensureSpace(doc, y, 7);
    if (idx % 2 === 1) { setColor(doc, 'setFillColor', C.zebra); doc.rect(MARGIN, y - 4.2, CONTENT_W, 6.4, 'F'); }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    setColor(doc, 'setTextColor', C.navyText);
    doc.text(String(label), MARGIN + 2, y);
    doc.setFont('JBMRegular', 'normal');
    setColor(doc, 'setTextColor', C.textDim);
    doc.text(String(value), PAGE_W - MARGIN, y, { align: 'right' });
    y += 6.4;
  });

  // ---------- Pie / disclaimer ----------
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    setColor(doc, 'setDrawColor', C.border);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, PAGE_H - 20, PAGE_W - MARGIN, PAGE_H - 20);
    doc.setFont('SGMedium', 'normal');
    doc.setFontSize(6.6);
    setColor(doc, 'setTextColor', C.textFaint);
    const disclaimer = doc.splitTextToSize(
      'Cálculo orientativo según criterios de la Reglamentación AEA 90364 (secciones 770/771). No reemplaza el proyecto ejecutivo ni la memoria técnica firmada por un instalador electricista matriculado.',
      CONTENT_W - 14
    );
    doc.text(disclaimer, MARGIN, PAGE_H - 15);
    doc.setFont('JBMRegular', 'normal');
    doc.setFontSize(7);
    doc.text(`${p} / ${pageCount}`, PAGE_W - MARGIN, PAGE_H - 15, { align: 'right' });
  }

  return doc;
}

function getImageDims(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.width, h: img.height });
    img.onerror = reject;
    img.src = dataUrl;
  });
}
