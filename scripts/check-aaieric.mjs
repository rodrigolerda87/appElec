// scripts/check-aaieric.mjs
//
// Corre en GitHub Actions (ver .github/workflows/check-aaieric-precios.yml),
// NO en el navegador del usuario. Chequea la página oficial de AAIERIC,
// intenta leer el PDF de precios vigente, y guarda lo que encontró en
// dist/data/estado-aaieric.json. La app (en el navegador) lee ese archivo
// —que viaja con el propio sitio, sin problema de CORS— y le avisa a Uri
// si hay precios distintos a los que tiene cargados.
//
// Uso: node scripts/check-aaieric.mjs

import fs from 'fs';
import path from 'path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPricesFromText, detectPeriodo } from '../js/catalog-match.js';

const AAIERIC_URL = 'https://aaieric.org.ar/costos-mano-de-obra';
const CATALOG_PATH = path.resolve('data/aaieric-precios.json');
const ESTADO_PATH = path.resolve('data/estado-aaieric.json');

async function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8'));
  const nowIso = new Date().toISOString();

  let estado;
  try {
    const res = await fetch(AAIERIC_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PiloPresupuestosBot/1.0; +https://aaieric.org.ar)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} al pedir ${AAIERIC_URL}`);
    const buf = new Uint8Array(await res.arrayBuffer());

    const pdf = await pdfjsLib.getDocument({ data: buf, useSystemFonts: true }).promise;
    let rawText = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      rawText += ' ' + content.items.map((it) => it.str).join(' ');
    }

    const { precios, sinCoincidencia } = extractPricesFromText(catalog, rawText);
    const periodoDetectado = detectPeriodo(rawText);
    const totalItems = catalog.categorias.reduce((n, c) => n + c.items.length, 0);

    // Cordura mínima: si de repente no pudimos leer casi nada, es más
    // probable que AAIERIC haya cambiado el formato del PDF a que hayan
    // desaparecido todos los precios — no publicamos un estado roto.
    const preciosDetectados = Object.keys(precios).length;
    if (preciosDetectados < totalItems * 0.5) {
      throw new Error(`Sólo se pudieron leer ${preciosDetectados}/${totalItems} precios — probablemente cambió el formato del PDF de AAIERIC. Revisar manualmente.`);
    }

    estado = {
      verificadoEn: nowIso,
      fuente: AAIERIC_URL,
      periodoDetectado,
      precios,
      sinCoincidencia,
      huboError: false,
      mensajeError: null,
    };
    console.log(`OK: ${preciosDetectados}/${totalItems} precios leídos. Período detectado: ${periodoDetectado || '(no se pudo determinar)'}`);
  } catch (err) {
    console.error('Error al chequear AAIERIC:', err.message);
    // Guardamos igual un estado (con huboError=true) para que la app pueda,
    // si quiere, avisar que el chequeo automático viene fallando — pero
    // sin pisar los últimos precios buenos que se hayan detectado.
    const previo = fs.existsSync(ESTADO_PATH) ? JSON.parse(fs.readFileSync(ESTADO_PATH, 'utf-8')) : {};
    estado = {
      ...previo,
      verificadoEn: nowIso,
      fuente: AAIERIC_URL,
      huboError: true,
      mensajeError: err.message,
    };
  }

  fs.mkdirSync(path.dirname(ESTADO_PATH), { recursive: true });
  fs.writeFileSync(ESTADO_PATH, JSON.stringify(estado, null, 2) + '\n');
  console.log('Escrito:', ESTADO_PATH);
}

main().catch((err) => {
  console.error('Error inesperado:', err);
  process.exit(1);
});
