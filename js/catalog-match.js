// catalog-match.js — funciones puras (sin DOM, sin `window`) para comparar
// el texto de un PDF de AAIERIC contra el catálogo. Las usa tanto la app
// (navegador) como el script de chequeo automático (Node, en GitHub Actions),
// así el criterio de "qué cambió" es siempre el mismo en los dos lugares.

export const BOILERPLATE = [
  'industriales y comerciales',
  'porlaseguridadelectrica',
  'aaieric.org.ar',
  'cuit 30-71354830-4',
  'igj 692/12',
];

export function normalize(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildNormText(rawText) {
  let text = rawText.replace(/\s+/g, ' ').trim();
  let norm = normalize(text);
  for (const b of BOILERPLATE) {
    norm = norm.split(normalize(b)).join(' ');
  }
  return norm;
}

export function findNumberAfter(normText, label, occurrence = 1, column = 0) {
  const nlabel = normalize(label);
  let idx = -1;
  for (let i = 0; i < occurrence; i++) {
    idx = normText.indexOf(nlabel, idx + 1);
    if (idx === -1) return null;
  }
  const start = idx + nlabel.length;
  const window = normText.slice(start, start + 300);
  const nums = window.match(/\d+/g);
  if (!nums || nums.length <= column) return null;
  return parseInt(nums[column], 10);
}

export function detectPeriodo(rawText) {
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const norm = rawText.toLowerCase();
  for (const mes of meses) {
    const re = new RegExp(mes + '\\s+(20\\d{2})');
    const m = norm.match(re);
    if (m) return `${mes[0].toUpperCase()}${mes.slice(1)} ${m[1]}`;
  }
  return null;
}

/**
 * Extrae, para cada ítem del catálogo con anclaje ("match"), el precio que
 * aparece en el texto dado. No compara contra nada — sólo lee.
 * @returns {{ precios: Record<string,number>, sinCoincidencia: string[] }}
 */
export function extractPricesFromText(catalog, rawText) {
  const normText = buildNormText(rawText);
  const precios = {};
  const sinCoincidencia = [];
  for (const cat of catalog.categorias) {
    for (const item of cat.items) {
      if (!item.match) { sinCoincidencia.push(item.id); continue; }
      const found = findNumberAfter(normText, item.match.label, item.match.occurrence || 1, item.match.column || 0);
      if (found === null) { sinCoincidencia.push(item.id); continue; }
      precios[item.id] = found;
    }
  }
  return { precios, sinCoincidencia };
}

/**
 * Compara precios recién leídos (de un PDF o de un snapshot ya calculado)
 * contra el precio "oficial" actual de cada ítem del catálogo
 * (precioBase si el usuario lo customizó, si no precio), y arma la lista
 * de diferencias para mostrar en la UI de revisión.
 */
export function diffPrices(catalog, preciosNuevos) {
  const diffs = [];
  for (const cat of catalog.categorias) {
    for (const item of cat.items) {
      const nuevo = preciosNuevos[item.id];
      if (nuevo === undefined) continue;
      const actualOficial = item.precioBase !== undefined ? item.precioBase : item.precio;
      if (nuevo !== actualOficial) {
        const ratio = actualOficial ? nuevo / actualOficial : 1;
        diffs.push({
          itemId: item.id,
          label: item.label,
          categoriaNombre: cat.nombre,
          precioActual: item.precio,
          precioNuevo: nuevo,
          sospechoso: ratio < 0.2 || ratio > 5,
        });
      }
    }
  }
  return diffs;
}
