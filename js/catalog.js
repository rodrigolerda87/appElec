// catalog.js — precios AAIERIC: carga, búsqueda, edición y detección de
// actualizaciones (desde un PDF que suba el usuario, o desde el chequeo
// automático que corre solo en GitHub Actions — ver /scripts/check-aaieric.mjs).

import { kvGet, kvSet } from './db.js';
import { extractPricesFromText, diffPrices, detectPeriodo, normalize } from './catalog-match.js';

const CATALOG_KEY = 'catalog';

export async function getCatalog() {
  let cat = await kvGet(CATALOG_KEY);
  if (!cat) {
    const res = await fetch('./data/aaieric-precios.json');
    const seed = await res.json();
    cat = { id: CATALOG_KEY, ...seed };
    await kvSet(cat);
  }
  return cat;
}

export async function saveCatalog(cat) {
  cat.id = CATALOG_KEY;
  await kvSet(cat);
  return cat;
}

export function flatItems(catalog) {
  const out = [];
  for (const cat of catalog.categorias) {
    for (const item of cat.items) {
      out.push({ ...item, categoriaId: cat.id, categoriaNombre: cat.nombre });
    }
  }
  return out;
}

export function findItem(catalog, itemId) {
  for (const cat of catalog.categorias) {
    const item = cat.items.find(i => i.id === itemId);
    if (item) return { item, categoria: cat };
  }
  return null;
}

export function searchItems(catalog, query) {
  const q = normalize(query || '');
  const items = flatItems(catalog);
  if (!q) return items;
  return items.filter(i =>
    normalize(i.label).includes(q) || normalize(i.categoriaNombre).includes(q)
  );
}

export function setItemPrice(catalog, itemId, newPrice) {
  const found = findItem(catalog, itemId);
  if (!found) return catalog;
  const { item } = found;
  if (item.precioBase === undefined) item.precioBase = item.precio;
  item.precio = newPrice;
  item.overridden = newPrice !== item.precioBase;
  return catalog;
}

export function resetItemPrice(catalog, itemId) {
  const found = findItem(catalog, itemId);
  if (!found) return catalog;
  const { item } = found;
  if (item.precioBase !== undefined) item.precio = item.precioBase;
  item.overridden = false;
  return catalog;
}

// ---------------------------------------------------------------------
// Importar precios desde un PDF nuevo de AAIERIC (lo sube el usuario)
// ---------------------------------------------------------------------

// Extrae todo el texto de un PDF usando pdf.js (carga dinámica del módulo,
// así el resto de la app funciona aunque pdf.js no se necesite todavía).
async function extractPdfText(file) {
  const pdfjsLib = await import('../vendor/pdf.min.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = '../vendor/pdf.worker.min.mjs';
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let fullText = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    fullText += ' ' + content.items.map(it => it.str).join(' ');
  }
  return fullText;
}

/**
 * Analiza un PDF de AAIERIC subido a mano y devuelve la lista de cambios
 * detectados respecto al catálogo actual, sin aplicarlos todavía.
 * @returns {Promise<{diffs: Array, periodoDetectado: string|null, sinCoincidencia: Array}>}
 */
export async function analyzePdfUpdate(catalog, file) {
  const rawText = await extractPdfText(file);
  const { precios, sinCoincidencia: sinCoincidenciaIds } = extractPricesFromText(catalog, rawText);
  const diffs = diffPrices(catalog, precios);
  const sinCoincidencia = sinCoincidenciaIds.map(id => {
    const found = findItem(catalog, id);
    return found ? { itemId: id, label: found.item.label, categoriaNombre: found.categoria.nombre, precioActual: found.item.precio } : null;
  }).filter(Boolean);
  return { diffs, periodoDetectado: detectPeriodo(rawText), sinCoincidencia };
}

export function applyPdfUpdate(catalog, diffs, selectedItemIds, periodoDetectado) {
  const selected = new Set(selectedItemIds);
  for (const d of diffs) {
    if (!selected.has(d.itemId)) continue;
    const found = findItem(catalog, d.itemId);
    if (!found) continue;
    found.item.precio = d.precioNuevo;
    found.item.precioBase = d.precioNuevo;
    found.item.overridden = false;
  }
  if (periodoDetectado) catalog.periodo = periodoDetectado;
  catalog.actualizado = new Date().toISOString();
  return catalog;
}

// ---------------------------------------------------------------------
// Chequeo automático (lee el snapshot que generó GitHub Actions solo,
// sin que el usuario tenga que subir nada — ver LEEME.md)
// ---------------------------------------------------------------------

/**
 * Busca ./data/estado-aaieric.json (lo genera y actualiza un chequeo
 * automático diario corriendo en GitHub Actions, sólo si la app está
 * alojada en GitHub Pages) y arma el mismo tipo de diff que el import
 * manual, para mostrar en el mismo modal de revisión.
 */
export async function checkRemoteUpdate(catalog) {
  try {
    const res = await fetch('./data/estado-aaieric.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const snapshot = await res.json();
    if (!snapshot || !snapshot.precios) return null;
    const diffs = diffPrices(catalog, snapshot.precios);
    return {
      diffs,
      periodoDetectado: snapshot.periodoDetectado || null,
      verificadoEn: snapshot.verificadoEn || null,
      huboError: !!snapshot.huboError,
      sinCoincidencia: snapshot.sinCoincidencia || [],
    };
  } catch (e) {
    return null; // sin conexión, o la app no está alojada con este archivo — no pasa nada
  }
}
