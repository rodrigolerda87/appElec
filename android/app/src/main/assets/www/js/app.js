// app.js — lógica principal de la app (SPA sin frameworks).

import { kvGet, kvSet, listAll, itemGet, itemPut, itemDelete, uid } from './db.js';
import {
  getCatalog, saveCatalog, flatItems, searchItems, findItem,
  setItemPrice, resetItemPrice, analyzePdfUpdate, applyPdfUpdate, checkRemoteUpdate,
} from './catalog.js';
import { buildQuotePdf, computeTotals, formatARS } from './pdf-export.js';
import { buildPlanoPdf } from './plano-pdf.js';
import { PlanoCanvas, COLORES_CANALIZACION } from './plano-canvas.js';
import {
  calcularCaidaTension, SECCIONES_NORMALIZADAS,
  TIPOS_INMUEBLE, TIPOS_AMBIENTE, calcularInstalacion, calcularMateriales,
  bocasPorAmbiente, determinarGradoElectrificacion,
} from './calculos.js';

// ---------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------
const state = {
  catalog: null,
  business: null,
  prefs: null,
  clients: [],
  quotes: [],
  planos: [],
  draft: null,       // presupuesto en edición
  builderSearch: '',
  catalogSearch: '',
  pendingUpdate: null, // { diffs, periodoDetectado, sinCoincidencia }
  remoteCheck: null,   // resultado de checkRemoteUpdate()

  // Cálculos: Caída de tensión (calculadora en vivo, sin persistencia)
  caida: { tipoCircuito: 'monofasico', material: 'cobre', calcularPor: 'potencia', potenciaW: 2200, corrienteA: 10, longitudM: 15, factorPotencia: 1 },

  // Cálculos: Grado de electrificación — 'lista' o 'editor'
  electrifSubview: 'lista',
  electrifDraft: null, // { id, nombre, tipoInmuebleId }
  electrifCalc: null,  // último resultado calculado { instalacion, materiales }
  planoEngine: null,   // instancia de PlanoCanvas activa
};

const DEFAULT_BUSINESS = { id: 'business', nombre: '', responsable: '', telefono: '', direccion: '', email: '', cuit: '', logoDataUrl: '' };
const DEFAULT_PREFS = { id: 'prefs', ivaPorcDefault: 21, aplicaIvaDefault: false, proximoNumero: 1 };

function emptyQuote() {
  return {
    id: uid('q'),
    numero: null,
    fecha: new Date().toISOString(),
    cliente: { nombre: '', direccion: '', telefono: '', email: '' },
    items: [],
    descuentoPorc: 0,
    aplicaIva: state.prefs ? state.prefs.aplicaIvaDefault : false,
    ivaPorc: state.prefs ? state.prefs.ivaPorcDefault : 21,
    validezDias: 15,
    notas: 'Presupuesto sujeto a modificaciones según relevamiento en obra. Materiales sujetos a disponibilidad y variación de precios.',
    estado: 'borrador',
    creadoEn: new Date().toISOString(),
    actualizadoEn: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------
async function init() {
  state.catalog = await getCatalog();
  state.business = (await kvGet('business')) || { ...DEFAULT_BUSINESS };
  state.prefs = (await kvGet('prefs')) || { ...DEFAULT_PREFS };
  state.clients = await listAll('clients');
  state.quotes = await listAll('quotes');
  state.planos = await listAll('planos');

  const savedDraft = await kvGet('draft');
  state.draft = savedDraft || emptyQuote();

  document.getElementById('app-title').textContent = state.business.nombre || 'Pilo Presupuestos';
  document.getElementById('sidebar-foot').textContent = `Precios AAIERIC · ${state.catalog.periodo}`;

  wireNav();
  renderAll();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }

  // Chequeo automático: lee el snapshot que generó GitHub Actions (si la
  // app está alojada así) y avisa si hay precios distintos a los cargados.
  // Si no está disponible (app abierta como archivo local, sin conexión,
  // etc.) esto no hace ni dice nada — sigue andando todo igual.
  refreshRemoteCheck();
}

async function refreshRemoteCheck() {
  state.remoteCheck = await checkRemoteUpdate(state.catalog);
  renderUpdateBanner();
}

function renderUpdateBanner() {
  const host = document.getElementById('update-banner');
  if (!host) return;
  const rc = state.remoteCheck;
  if (!rc || !rc.diffs || !rc.diffs.length) { host.innerHTML = ''; return; }
  const fecha = rc.verificadoEn ? new Date(rc.verificadoEn).toLocaleDateString('es-AR') : '';
  host.innerHTML = `
    <div class="update-banner">
      <div class="icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/></svg>
      </div>
      <div class="text">
        AAIERIC actualizó <b>${rc.diffs.length} precio${rc.diffs.length === 1 ? '' : 's'}</b>${rc.periodoDetectado ? ` (${esc(rc.periodoDetectado)})` : ''}.
        <div class="sub">Detectado automáticamente${fecha ? ` el ${fecha}` : ''} — no hace falta que subas nada.</div>
      </div>
      <button class="btn btn-primary btn-sm" id="btn-review-remote">Revisar cambios</button>
    </div>
  `;
  host.querySelector('#btn-review-remote').onclick = () => openPdfDiffModal(rc, { fromRemote: true });
}

// Las pestañas de arriba (nav) agrupan varias vistas internas, para no
// llenar la barra de íconos. Tocar el grupo lleva a su vista por defecto;
// las sub-pestañas dentro de cada vista (subtabsHtml) navegan entre las
// vistas de un mismo grupo sin cambiar qué ícono está resaltado arriba.
const VIEW_GROUP = {
  home: 'home',
  builder: 'presupuestos', quotes: 'presupuestos',
  business: 'negocio', clients: 'negocio',
  catalog: 'precios',
  'calc-caida': 'calculos', 'calc-electrif': 'calculos',
};
const GROUP_DEFAULT = { home: 'home', presupuestos: 'builder', negocio: 'business', precios: 'catalog', calculos: 'calc-caida' };

function wireNav() {
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', () => showView(GROUP_DEFAULT[el.dataset.view] || el.dataset.view));
  });
}

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
  const group = VIEW_GROUP[name] || name;
  document.querySelectorAll('[data-view]').forEach(el => {
    el.classList.toggle('active', el.dataset.view === group);
  });
  renderView(name);
  window.scrollTo(0, 0);
}

function renderAll() { renderView('home'); }

function renderView(name) {
  if (name === 'home') renderHome();
  else if (name === 'builder') renderBuilder();
  else if (name === 'quotes') renderQuotesList();
  else if (name === 'clients') renderClients();
  else if (name === 'catalog') renderCatalog();
  else if (name === 'business') renderBusiness();
  else if (name === 'calc-caida') renderCaidaTension();
  else if (name === 'calc-electrif') renderElectrificacion();
}

// Barra de sub-pestañas para navegar entre vistas de un mismo grupo
// (ej: "Nuevo" / "Guardados" dentro de Presupuestos).
function subtabsHtml(items, current) {
  return `<div class="subtabs">${items.map(it =>
    `<button type="button" class="subtab-btn ${it.v === current ? 'active' : ''}" data-goto="${it.v}">${esc(it.label)}</button>`
  ).join('')}</div>`;
}
function wireGoto(el) {
  el.querySelectorAll('[data-goto]').forEach(b => { b.onclick = () => showView(b.dataset.goto); });
}

// ---------------------------------------------------------------------
// Toast + Modal helpers
// ---------------------------------------------------------------------
function toast(msg, type = '') {
  const host = document.getElementById('toast-host');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function openModal(innerHtml, opts = {}) {
  closeModal();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'active-modal';
  backdrop.innerHTML = `<div class="modal ${opts.wide ? 'modal-wide' : ''}">${innerHtml}</div>`;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
  document.getElementById('modal-host').appendChild(backdrop);
  return backdrop;
}
function closeModal() {
  const m = document.getElementById('active-modal');
  if (m) m.remove();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Muestra un spinner en el botón mientras dura una acción async (guardar,
// exportar, compartir), para que quede claro que está trabajando.
async function withLoading(button, fn) {
  if (!button || button.classList.contains('is-loading')) return;
  button.classList.add('is-loading');
  try {
    await fn();
  } finally {
    button.classList.remove('is-loading');
  }
}

// ---------------------------------------------------------------------
// VIEW: Nuevo presupuesto (builder)
// ---------------------------------------------------------------------
let draftSaveTimer = null;
function persistDraft() {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(async () => {
    state.draft.actualizadoEn = new Date().toISOString();
    await kvSet({ id: 'draft', ...state.draft });
  }, 250);
}

function renderBuilder() {
  const el = document.getElementById('view-builder');
  const q = state.draft;
  const totals = computeTotals(q);

  el.innerHTML = `
    ${subtabsHtml([{ v: 'builder', label: 'Nuevo presupuesto' }, { v: 'quotes', label: 'Guardados' }], 'builder')}
    <div class="page-head">
      <div>
        <h1 class="page-title">Nuevo presupuesto</h1>
        <p class="page-sub">Armá el presupuesto con los ítems de AAIERIC o cargá los tuyos.</p>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost" id="btn-new-quote">Vaciar</button>
        <button class="btn btn-primary" id="btn-save-quote">Guardar presupuesto</button>
      </div>
    </div>

    <div class="builder-grid">
      <div>
        <div class="card">
          <div class="card-title">Cliente</div>
          <div class="grid-2">
            <div class="field"><label>Nombre</label><input id="c-nombre" value="${esc(q.cliente.nombre)}" placeholder="Nombre y apellido"></div>
            <div class="field"><label>Teléfono</label><input id="c-telefono" value="${esc(q.cliente.telefono)}" placeholder="341 ..."></div>
            <div class="field"><label>Dirección</label><input id="c-direccion" value="${esc(q.cliente.direccion)}" placeholder="Obra / domicilio"></div>
            <div class="field"><label>Email</label><input id="c-email" value="${esc(q.cliente.email)}" placeholder="opcional"></div>
          </div>
          <button class="btn btn-sm" id="btn-pick-client">Elegir cliente guardado</button>
        </div>

        <div class="card">
          <div class="card-title">Agregar ítems del listado AAIERIC</div>
          <div class="search-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            <input id="builder-search" placeholder="Buscar por nombre (ej: toma doble, tablero, jornal...)" value="${esc(state.builderSearch)}">
          </div>
          <div class="catalog-list" id="builder-results" style="margin-top:10px;"></div>
          <button class="btn btn-sm" id="btn-add-custom" style="margin-top:12px;">+ Ítem personalizado (material, etc.)</button>
        </div>

        <div class="card">
          <div class="card-title">Ítems del presupuesto <span class="badge badge-muted">${q.items.length}</span></div>
          <div id="line-items">${renderLineItems(q)}</div>
        </div>

        <div class="card">
          <div class="card-title">Totales</div>
          <div class="totals-row">
            <span>Subtotal</span><span class="num">$ ${formatARS(totals.subtotal)}</span>
          </div>
          <div class="totals-row">
            <span>Descuento %</span>
            <input id="t-descuento" type="number" min="0" max="100" value="${q.descuentoPorc || 0}">
          </div>
          <div class="totals-row">
            <span class="check-row"><input type="checkbox" id="t-iva" ${q.aplicaIva ? 'checked' : ''}> IVA %</span>
            <input id="t-iva-porc" type="number" min="0" max="100" value="${q.ivaPorc || 21}" ${q.aplicaIva ? '' : 'disabled'}>
          </div>
          <div class="totals-row total">
            <span>Total</span><span class="num">$ ${formatARS(totals.total)}</span>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Notas / condiciones</div>
          <textarea id="q-notas" rows="3">${esc(q.notas)}</textarea>
          <div class="grid-2" style="margin-top:12px;">
            <div class="field"><label>Validez (días)</label><input id="q-validez" type="number" min="0" value="${q.validezDias || 15}"></div>
          </div>
        </div>
      </div>

      <div class="paper-wrap">
        <div class="paper" id="paper-preview"></div>
        <div class="preview-actions">
          <button class="btn btn-primary btn-block" id="btn-export-pdf">Exportar PDF</button>
          <button class="btn btn-block" id="btn-share-wa">Compartir por WhatsApp</button>
        </div>
      </div>
    </div>
  `;

  renderPaperPreview();
  renderBuilderResults();

  // ---- eventos ----
  el.querySelector('#c-nombre').oninput = e => { q.cliente.nombre = e.target.value; renderPaperPreview(); persistDraft(); };
  el.querySelector('#c-telefono').oninput = e => { q.cliente.telefono = e.target.value; renderPaperPreview(); persistDraft(); };
  el.querySelector('#c-direccion').oninput = e => { q.cliente.direccion = e.target.value; renderPaperPreview(); persistDraft(); };
  el.querySelector('#c-email').oninput = e => { q.cliente.email = e.target.value; renderPaperPreview(); persistDraft(); };
  el.querySelector('#btn-pick-client').onclick = openPickClientModal;

  el.querySelector('#builder-search').oninput = e => { state.builderSearch = e.target.value; renderBuilderResults(); };
  el.querySelector('#btn-add-custom').onclick = openCustomItemModal;

  el.querySelector('#t-descuento').oninput = e => { q.descuentoPorc = Number(e.target.value) || 0; renderPaperPreview(); updateTotalsOnly(); persistDraft(); };
  el.querySelector('#t-iva').onchange = e => { q.aplicaIva = e.target.checked; renderBuilder(); persistDraft(); };
  el.querySelector('#t-iva-porc').oninput = e => { q.ivaPorc = Number(e.target.value) || 0; renderPaperPreview(); updateTotalsOnly(); persistDraft(); };
  el.querySelector('#q-notas').oninput = e => { q.notas = e.target.value; renderPaperPreview(); persistDraft(); };
  el.querySelector('#q-validez').oninput = e => { q.validezDias = Number(e.target.value) || 0; renderPaperPreview(); persistDraft(); };

  el.querySelector('#btn-new-quote').onclick = () => {
    if (q.items.length && !confirm('¿Vaciar el presupuesto actual? Se perderán los ítems cargados.')) return;
    state.draft = emptyQuote();
    persistDraft();
    renderBuilder();
  };
  const saveBtn = el.querySelector('#btn-save-quote');
  const exportBtn = el.querySelector('#btn-export-pdf');
  const shareBtn = el.querySelector('#btn-share-wa');
  saveBtn.onclick = () => withLoading(saveBtn, saveDraftAsQuote);
  exportBtn.onclick = () => withLoading(exportBtn, () => exportCurrentPdf(false));
  shareBtn.onclick = () => withLoading(shareBtn, () => exportCurrentPdf(true));

  wireLineItemEvents();
  wireGoto(el);
}

function renderLineItems(q) {
  if (!q.items.length) {
    return `<div class="empty-state" style="padding:26px 10px;">
      <p style="margin:0;">Todavía no agregaste ítems. Buscá arriba en el listado de AAIERIC o cargá uno personalizado.</p>
    </div>`;
  }
  return q.items.map(it => `
    <div class="line-item" data-id="${it.id}">
      <div class="desc">${esc(it.descripcion)}${it.origen === 'personalizado' ? '<span class="src">Ítem personalizado</span>' : ''}</div>
      <div class="qty-stepper">
        <button type="button" class="qty-btn li-qty-dec" aria-label="Restar">−</button>
        <input class="qty-input li-qty" type="text" inputmode="numeric" pattern="[0-9]*" value="${it.cantidad}">
        <button type="button" class="qty-btn li-qty-inc" aria-label="Sumar">+</button>
      </div>
      <input class="price-input li-price" type="number" min="0" value="${it.precioUnitario}">
      <div class="num mono" style="text-align:right;">$ ${formatARS(it.cantidad * it.precioUnitario)}</div>
      <button class="icon-btn li-remove" title="Quitar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
      </button>
    </div>
  `).join('');
}

function wireLineItemEvents() {
  const q = state.draft;
  document.querySelectorAll('#line-items .line-item').forEach(row => {
    const id = row.dataset.id;
    const item = q.items.find(i => i.id === id);
    const onQtyChange = (newVal) => {
      item.cantidad = Math.max(0, newVal);
      row.querySelector('.li-qty').value = item.cantidad;
      refreshLineRow(row, item);
      renderPaperPreview(); updateTotalsOnly(); persistDraft();
    };
    row.querySelector('.li-qty').oninput = e => {
      const digits = e.target.value.replace(/[^0-9]/g, '');
      if (digits !== e.target.value) e.target.value = digits;
      onQtyChange(Number(digits) || 0);
    };
    row.querySelector('.li-qty-dec').onclick = () => onQtyChange((item.cantidad || 0) - 1);
    row.querySelector('.li-qty-inc').onclick = () => onQtyChange((item.cantidad || 0) + 1);
    row.querySelector('.li-price').oninput = e => {
      item.precioUnitario = Math.max(0, Number(e.target.value) || 0);
      refreshLineRow(row, item);
      renderPaperPreview(); updateTotalsOnly(); persistDraft();
    };
    row.querySelector('.li-remove').onclick = () => {
      q.items = q.items.filter(i => i.id !== id);
      document.getElementById('line-items').innerHTML = renderLineItems(q);
      wireLineItemEvents();
      renderPaperPreview(); updateTotalsOnly(); persistDraft();
      const badge = document.querySelector('#view-builder .card-title span.badge');
      if (badge) badge.textContent = q.items.length;
    };
  });
}

function refreshLineRow(row, item) {
  row.querySelector('.num.mono').textContent = `$ ${formatARS(item.cantidad * item.precioUnitario)}`;
}

function updateTotalsOnly() {
  const q = state.draft;
  const totals = computeTotals(q);
  const rows = document.querySelectorAll('#view-builder .totals-row .num');
  if (rows[0]) rows[0].textContent = `$ ${formatARS(totals.subtotal)}`;
  const totalEl = document.querySelector('#view-builder .totals-row.total .num');
  if (totalEl) totalEl.textContent = `$ ${formatARS(totals.total)}`;
}

function renderBuilderResults() {
  const host = document.getElementById('builder-results');
  if (!host) return;
  const results = searchItems(state.catalog, state.builderSearch).slice(0, state.builderSearch ? 40 : 12);
  if (!results.length) {
    host.innerHTML = `<div style="padding:14px;color:var(--text-faint);font-size:12.5px;">Sin resultados.</div>`;
    return;
  }
  let lastCat = null;
  host.innerHTML = results.map(it => {
    const groupHtml = it.categoriaNombre !== lastCat ? `<div class="catalog-group-label">${esc(it.categoriaNombre)}</div>` : '';
    lastCat = it.categoriaNombre;
    return `${groupHtml}<div class="catalog-row" data-id="${it.id}">
      <div><div class="name">${esc(it.label)}</div><div class="unit">por ${esc(it.unidad)}</div></div>
      <div class="price">$ ${formatARS(it.precio)}</div>
    </div>`;
  }).join('');
  host.querySelectorAll('.catalog-row').forEach(row => {
    row.onclick = () => addCatalogItemToDraft(row.dataset.id);
  });
}

function addCatalogItemToDraft(itemId) {
  const found = findItem(state.catalog, itemId);
  if (!found) return;
  const q = state.draft;
  const existing = q.items.find(i => i.catalogItemId === itemId);
  if (existing) {
    existing.cantidad += 1;
  } else {
    q.items.push({
      id: uid('li'),
      descripcion: found.item.label,
      cantidad: 1,
      precioUnitario: found.item.precio,
      origen: 'catalogo',
      catalogItemId: itemId,
      categoriaNombre: found.categoria.nombre,
    });
  }
  document.getElementById('line-items').innerHTML = renderLineItems(q);
  wireLineItemEvents();
  renderPaperPreview(); updateTotalsOnly(); persistDraft();
  const badge = document.querySelector('#view-builder .card-title span.badge');
  if (badge) badge.textContent = q.items.length;
  toast('Ítem agregado', 'success');
}

function openCustomItemModal() {
  const html = `
    <div class="modal-head"><h3>Ítem personalizado</h3><button class="icon-btn" id="m-close">✕</button></div>
    <div class="field"><label>Descripción</label><input id="ci-desc" placeholder="Ej: Caño corrugado 20mm (material aparte)"></div>
    <div class="grid-2">
      <div class="field"><label>Cantidad</label><input id="ci-cant" type="number" min="0" value="1"></div>
      <div class="field"><label>Precio unitario</label><input id="ci-precio" type="number" min="0" value="0"></div>
    </div>
    <button class="btn btn-primary btn-block" id="ci-add">Agregar al presupuesto</button>
  `;
  const modal = openModal(html);
  modal.querySelector('#m-close').onclick = closeModal;
  modal.querySelector('#ci-add').onclick = () => {
    const desc = modal.querySelector('#ci-desc').value.trim();
    if (!desc) { toast('Poné una descripción', 'error'); return; }
    const cantidad = Number(modal.querySelector('#ci-cant').value) || 0;
    const precioUnitario = Number(modal.querySelector('#ci-precio').value) || 0;
    state.draft.items.push({ id: uid('li'), descripcion: desc, cantidad, precioUnitario, origen: 'personalizado' });
    document.getElementById('line-items').innerHTML = renderLineItems(state.draft);
    wireLineItemEvents();
    renderPaperPreview(); updateTotalsOnly(); persistDraft();
    closeModal();
    toast('Ítem agregado', 'success');
  };
}

function openPickClientModal() {
  const html = `
    <div class="modal-head"><h3>Elegir cliente</h3><button class="icon-btn" id="m-close">✕</button></div>
    ${state.clients.length ? state.clients.map(c => `
      <div class="list-row" data-id="${c.id}">
        <div><div class="title">${esc(c.nombre)}</div><div class="meta">${esc(c.telefono || c.direccion || '')}</div></div>
      </div>
    `).join('') : '<p style="color:var(--text-dim);font-size:13px;">No tenés clientes guardados todavía. Podés cargarlos desde la sección Clientes.</p>'}
  `;
  const modal = openModal(html);
  modal.querySelector('#m-close').onclick = closeModal;
  modal.querySelectorAll('.list-row').forEach(row => {
    row.onclick = () => {
      const c = state.clients.find(x => x.id === row.dataset.id);
      state.draft.cliente = { nombre: c.nombre, direccion: c.direccion, telefono: c.telefono, email: c.email };
      persistDraft();
      closeModal();
      renderBuilder();
    };
  });
}

function renderPaperPreview() {
  const host = document.getElementById('paper-preview');
  if (!host) return;
  const q = state.draft;
  const b = state.business;
  const totals = computeTotals(q);

  host.innerHTML = `
    <div class="paper-head">
      <div style="display:flex;gap:10px;align-items:flex-start;">
        ${b.logoDataUrl ? `<img class="paper-logo" src="${b.logoDataUrl}">` : ''}
        <div>
          <div class="paper-biz-name">${esc(b.nombre || 'Tu negocio (completá en "Mi negocio")')}</div>
          <div class="paper-biz-meta">
            ${esc(b.responsable || '')}${b.responsable ? '<br>' : ''}
            ${esc(b.telefono || '')}${b.telefono && b.direccion ? ' · ' : ''}${esc(b.direccion || '')}
          </div>
        </div>
      </div>
      <div class="paper-doc-type">
        <div class="k">Presupuesto</div>
        <div class="v">N.° ${q.numero || 'borrador'}</div>
        <div class="v">${new Date(q.fecha).toLocaleDateString('es-AR')}</div>
      </div>
    </div>

    <div class="paper-section-label">Cliente</div>
    <div class="paper-client">
      <b>${esc(q.cliente.nombre || 'Consumidor final')}</b><br>
      ${[q.cliente.direccion, q.cliente.telefono, q.cliente.email].filter(Boolean).map(esc).join(' · ')}
    </div>

    <div class="paper-section-label">Detalle</div>
    <table>
      <thead><tr><th>Descripción</th><th style="text-align:right;">Cant.</th><th style="text-align:right;">P. unit.</th><th style="text-align:right;">Subtotal</th></tr></thead>
      <tbody>
        ${q.items.length ? q.items.map(it => `
          <tr>
            <td>${esc(it.descripcion)}</td>
            <td class="num">${it.cantidad}</td>
            <td class="num">$ ${formatARS(it.precioUnitario)}</td>
            <td class="num">$ ${formatARS(it.cantidad * it.precioUnitario)}</td>
          </tr>
        `).join('') : ''}
      </tbody>
    </table>
    ${!q.items.length ? '<div class="paper-empty">Sin ítems cargados todavía</div>' : ''}

    <div class="paper-totals">
      <div class="totals-row"><span>Subtotal</span><span class="num">$ ${formatARS(totals.subtotal)}</span></div>
      ${totals.descuento > 0 ? `<div class="totals-row"><span>Descuento (${q.descuentoPorc}%)</span><span class="num">- $ ${formatARS(totals.descuento)}</span></div>` : ''}
      ${q.aplicaIva ? `<div class="totals-row"><span>IVA (${q.ivaPorc}%)</span><span class="num">$ ${formatARS(totals.iva)}</span></div>` : ''}
      <div class="totals-row total"><span>Total</span><span class="num">$ ${formatARS(totals.total)}</span></div>
    </div>

    ${q.notas ? `<div class="paper-notes">${esc(q.notas)}</div>` : ''}
    <div class="paper-foot">Presupuesto de referencia según costos sugeridos AAIERIC · Válido por ${q.validezDias || 15} días</div>
  `;
}

async function saveDraftAsQuote() {
  const q = state.draft;
  if (!q.items.length) { toast('Agregá al menos un ítem antes de guardar', 'error'); return; }
  if (!q.numero) {
    q.numero = String(state.prefs.proximoNumero).padStart(4, '0');
    state.prefs.proximoNumero += 1;
    await kvSet(state.prefs);
  }
  q.estado = q.estado === 'borrador' ? 'guardado' : q.estado;
  q.actualizadoEn = new Date().toISOString();
  await itemPut('quotes', q);
  state.quotes = await listAll('quotes');

  // guarda/actualiza cliente si tiene nombre y no existe todavía
  if (q.cliente.nombre) {
    const existing = state.clients.find(c => c.nombre.trim().toLowerCase() === q.cliente.nombre.trim().toLowerCase());
    if (!existing) {
      const c = { id: uid('cli'), ...q.cliente, notas: '', creadoEn: new Date().toISOString() };
      await itemPut('clients', c);
      state.clients = await listAll('clients');
    }
  }

  toast(`Presupuesto N.° ${q.numero} guardado`, 'success');
  renderPaperPreview();
  document.querySelector('#view-builder .page-sub').textContent = `Presupuesto N.° ${q.numero} guardado.`;
}

async function exportCurrentPdf(share) {
  const q = state.draft;
  if (!q.items.length) { toast('Agregá al menos un ítem antes de exportar', 'error'); return; }
  await saveDraftAsQuote();
  await exportQuotePdf(q, share);
}

// ---------------------------------------------------------------------
// Puente con la app Android (sólo existe cuando corre empaquetada como
// APK, no cuando corre como PWA en el navegador — ahí no hace nada raro).
// ---------------------------------------------------------------------
function androidBridge() {
  return (typeof window !== 'undefined' && window.AndroidBridge) ? window.AndroidBridge : null;
}

async function savePdfFile(doc, filename) {
  const bridge = androidBridge();
  if (bridge && bridge.saveBase64Pdf) {
    const base64 = doc.output('datauristring').split(',')[1];
    bridge.saveBase64Pdf(base64, filename);
    return;
  }
  doc.save(filename);
}

async function sharePdfFile(doc, filename, text) {
  const bridge = androidBridge();
  if (bridge && bridge.shareBase64Pdf) {
    const base64 = doc.output('datauristring').split(',')[1];
    bridge.shareBase64Pdf(base64, filename, text || '');
    return true;
  }
  return false;
}

async function exportQuotePdf(quote, share) {
  const doc = await buildQuotePdf(quote, state.business);
  const filename = `presupuesto-${quote.numero || 'borrador'}.pdf`;

  if (share) {
    const totals = computeTotals(quote);
    const shareText = `Presupuesto N.° ${quote.numero || ''} — ${state.business.nombre || ''}\nTotal: $ ${formatARS(totals.total)}`;

    // 1) Empaquetada como APK: comparte el PDF real por el selector nativo de Android.
    const sharedNatively = await sharePdfFile(doc, filename, shareText);
    if (sharedNatively) return;

    // 2) Navegador con Web Share API (Android/Chrome): adjunta el PDF directo.
    if (navigator.share) {
      try {
        const blob = doc.output('blob');
        const file = new File([blob], filename, { type: 'application/pdf' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: `Presupuesto N.° ${quote.numero || ''}`,
            text: `Presupuesto de ${state.business.nombre || 'instalaciones eléctricas'} para ${quote.cliente.nombre || 'cliente'}.`,
          });
          return;
        }
      } catch (e) { /* el usuario canceló o no se pudo compartir el archivo, seguimos con el respaldo */ }
    }

    // 3) Respaldo (PC / navegadores sin Web Share): descarga + abre WhatsApp con el texto.
    await savePdfFile(doc, filename);
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText + '\n(Adjuntá el PDF que se acaba de descargar)')}`, '_blank');
    toast('PDF descargado — adjuntalo en WhatsApp', '');
    return;
  }

  await savePdfFile(doc, filename);
  toast('PDF descargado', 'success');
}

// ---------------------------------------------------------------------
// VIEW: Presupuestos guardados
// ---------------------------------------------------------------------
function renderQuotesList() {
  const el = document.getElementById('view-quotes');
  const quotes = [...state.quotes].sort((a, b) => new Date(b.actualizadoEn) - new Date(a.actualizadoEn));

  el.innerHTML = `
    ${subtabsHtml([{ v: 'builder', label: 'Nuevo presupuesto' }, { v: 'quotes', label: 'Guardados' }], 'quotes')}
    <div class="page-head">
      <div><h1 class="page-title">Presupuestos</h1><p class="page-sub">${quotes.length} guardado${quotes.length === 1 ? '' : 's'}</p></div>
    </div>
    <div id="quotes-list"></div>
  `;
  wireGoto(el);
  const host = document.getElementById('quotes-list');
  if (!quotes.length) {
    host.innerHTML = emptyState('Todavía no guardaste presupuestos', 'Los que guardes desde "Nuevo presupuesto" van a aparecer acá.');
    return;
  }
  host.innerHTML = quotes.map(q => {
    const totals = computeTotals(q);
    return `
    <div class="list-row" data-id="${q.id}">
      <div>
        <div class="title">N.° ${q.numero} — ${esc(q.cliente.nombre || 'Consumidor final')}</div>
        <div class="meta">${new Date(q.actualizadoEn).toLocaleDateString('es-AR')} · ${q.items.length} ítem${q.items.length === 1 ? '' : 's'} · ${estadoSelect(q)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:14px;">
        <div class="amount">$ ${formatARS(totals.total)}</div>
        <div class="row-actions">
          <button class="icon-btn q-dup" title="Duplicar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          <button class="icon-btn q-pdf" title="Descargar PDF" style="color:var(--text-dim);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
          </button>
          <button class="icon-btn q-del" title="Eliminar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
          </button>
        </div>
      </div>
    </div>`;
  }).join('');

  host.querySelectorAll('.list-row').forEach(row => {
    const q = state.quotes.find(x => x.id === row.dataset.id);
    row.addEventListener('click', (e) => {
      if (e.target.closest('.q-pdf') || e.target.closest('.q-del') || e.target.closest('.q-dup') || e.target.closest('.estado-select')) return;
      state.draft = JSON.parse(JSON.stringify(q));
      persistDraft();
      showView('builder');
    });
    row.querySelector('.q-pdf').onclick = (e) => { e.stopPropagation(); exportQuotePdf(q, false); };
    row.querySelector('.q-dup').onclick = async (e) => {
      e.stopPropagation();
      const copy = JSON.parse(JSON.stringify(q));
      copy.id = uid('q');
      copy.numero = null;
      copy.fecha = new Date().toISOString();
      copy.estado = 'borrador';
      copy.creadoEn = new Date().toISOString();
      copy.actualizadoEn = new Date().toISOString();
      state.draft = copy;
      persistDraft();
      showView('builder');
      toast('Presupuesto duplicado — revisá los datos y guardalo', 'success');
    };
    const sel = row.querySelector('.estado-select');
    sel.onclick = (e) => e.stopPropagation();
    sel.onchange = async (e) => {
      q.estado = e.target.value;
      q.actualizadoEn = new Date().toISOString();
      await itemPut('quotes', q);
      state.quotes = await listAll('quotes');
      sel.className = `estado-select estado-${q.estado}`;
      toast('Estado actualizado', 'success');
    };
    row.querySelector('.q-del').onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`¿Eliminar el presupuesto N.° ${q.numero}?`)) return;
      await itemDelete('quotes', q.id);
      state.quotes = await listAll('quotes');
      renderQuotesList();
      toast('Presupuesto eliminado', '');
    };
  });
}

function estadoSelect(q) {
  const opciones = [
    ['borrador', 'Borrador'], ['guardado', 'Guardado'], ['enviado', 'Enviado'],
    ['aceptado', 'Aceptado'], ['rechazado', 'Rechazado'],
  ];
  const actual = q.estado || 'guardado';
  return `<select class="estado-select estado-${actual}">
    ${opciones.map(([v, label]) => `<option value="${v}" ${v === actual ? 'selected' : ''}>${label}</option>`).join('')}
  </select>`;
}

function emptyState(title, sub) {
  return `<div class="empty-state">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 12h6m-6 4h6M9 8h1M4 4h16v16H4z"/></svg>
    <h3>${esc(title)}</h3><p>${esc(sub)}</p>
  </div>`;
}

// ---------------------------------------------------------------------
// VIEW: Clientes
// ---------------------------------------------------------------------
function renderClients() {
  const el = document.getElementById('view-clients');
  const clients = [...state.clients].sort((a, b) => a.nombre.localeCompare(b.nombre));

  el.innerHTML = `
    ${subtabsHtml([{ v: 'business', label: 'Mi negocio' }, { v: 'clients', label: 'Clientes' }], 'clients')}
    <div class="page-head">
      <div><h1 class="page-title">Clientes</h1><p class="page-sub">${clients.length} guardado${clients.length === 1 ? '' : 's'}</p></div>
      <button class="btn btn-primary" id="btn-new-client">+ Nuevo cliente</button>
    </div>
    <div id="clients-list"></div>
  `;
  wireGoto(el);
  const host = document.getElementById('clients-list');
  if (!clients.length) {
    host.innerHTML = emptyState('Todavía no cargaste clientes', 'Se agregan solos cuando guardás un presupuesto, o los podés crear acá.');
  } else {
    host.innerHTML = clients.map(c => `
      <div class="list-row" data-id="${c.id}">
        <div><div class="title">${esc(c.nombre)}</div><div class="meta">${esc([c.telefono, c.direccion].filter(Boolean).join(' · '))}</div></div>
        <div class="row-actions">
          <button class="icon-btn c-del" title="Eliminar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
          </button>
        </div>
      </div>
    `).join('');
    host.querySelectorAll('.list-row').forEach(row => {
      const c = state.clients.find(x => x.id === row.dataset.id);
      row.addEventListener('click', e => { if (!e.target.closest('.c-del')) openClientModal(c); });
      row.querySelector('.c-del').onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`¿Eliminar a ${c.nombre}?`)) return;
        await itemDelete('clients', c.id);
        state.clients = await listAll('clients');
        renderClients();
      };
    });
  }
  document.getElementById('btn-new-client').onclick = () => openClientModal(null);
}

function openClientModal(client) {
  const c = client || { id: uid('cli'), nombre: '', telefono: '', direccion: '', email: '', notas: '' };
  const html = `
    <div class="modal-head"><h3>${client ? 'Editar cliente' : 'Nuevo cliente'}</h3><button class="icon-btn" id="m-close">✕</button></div>
    <div class="field"><label>Nombre</label><input id="cl-nombre" value="${esc(c.nombre)}"></div>
    <div class="grid-2">
      <div class="field"><label>Teléfono</label><input id="cl-telefono" value="${esc(c.telefono)}"></div>
      <div class="field"><label>Email</label><input id="cl-email" value="${esc(c.email)}"></div>
    </div>
    <div class="field"><label>Dirección</label><input id="cl-direccion" value="${esc(c.direccion)}"></div>
    <div class="field"><label>Notas</label><textarea id="cl-notas" rows="2">${esc(c.notas || '')}</textarea></div>
    <button class="btn btn-primary btn-block" id="cl-save">Guardar cliente</button>
  `;
  const modal = openModal(html);
  modal.querySelector('#m-close').onclick = closeModal;
  modal.querySelector('#cl-save').onclick = async () => {
    c.nombre = modal.querySelector('#cl-nombre').value.trim();
    if (!c.nombre) { toast('Poné un nombre', 'error'); return; }
    c.telefono = modal.querySelector('#cl-telefono').value.trim();
    c.email = modal.querySelector('#cl-email').value.trim();
    c.direccion = modal.querySelector('#cl-direccion').value.trim();
    c.notas = modal.querySelector('#cl-notas').value.trim();
    if (!c.creadoEn) c.creadoEn = new Date().toISOString();
    await itemPut('clients', c);
    state.clients = await listAll('clients');
    closeModal();
    renderClients();
    toast('Cliente guardado', 'success');
  };
}

// ---------------------------------------------------------------------
// VIEW: Precios AAIERIC
// ---------------------------------------------------------------------
function catalogSubtitle() {
  const rc = state.remoteCheck;
  let extra = '';
  if (rc && rc.verificadoEn) {
    const fecha = new Date(rc.verificadoEn).toLocaleDateString('es-AR');
    extra = rc.huboError
      ? ` · <span style="color:var(--danger);">el chequeo automático del ${fecha} no pudo leer la web de AAIERIC</span>`
      : ` · último chequeo automático: ${fecha}`;
  }
  return `${state.catalog.periodo} · ${flatItems(state.catalog).length} ítems · fuente: aaieric.org.ar${extra}`;
}

function renderCatalog() {
  const el = document.getElementById('view-catalog');
  el.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Precios AAIERIC</h1>
        <p class="page-sub">${catalogSubtitle()}</p>
      </div>
      <div style="display:flex;gap:8px;">
        <input type="file" id="pdf-file" accept="application/pdf" style="display:none;">
        <button class="btn btn-ghost" id="btn-check-now" title="Volver a mirar el último chequeo automático">Ver estado automático</button>
        <button class="btn btn-primary" id="btn-update-pdf">Actualizar desde un PDF</button>
      </div>
    </div>

    <div class="card">
      <div class="search-box">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        <input id="catalog-search" placeholder="Buscar ítem..." value="${esc(state.catalogSearch)}">
      </div>
      <div id="catalog-full-list" style="margin-top:12px;"></div>
    </div>
  `;
  renderCatalogList();
  el.querySelector('#catalog-search').oninput = e => { state.catalogSearch = e.target.value; renderCatalogList(); };
  el.querySelector('#btn-update-pdf').onclick = () => el.querySelector('#pdf-file').click();
  el.querySelector('#pdf-file').onchange = handlePdfUpload;
  el.querySelector('#btn-check-now').onclick = async () => {
    await refreshRemoteCheck();
    document.querySelector('#view-catalog .page-sub').textContent = catalogSubtitle();
    if (state.remoteCheck && state.remoteCheck.diffs && state.remoteCheck.diffs.length) {
      openPdfDiffModal(state.remoteCheck, { fromRemote: true });
    } else if (state.remoteCheck) {
      toast(state.remoteCheck.huboError ? 'El chequeo automático viene fallando — probá subiendo el PDF a mano' : 'Sin cambios pendientes', '');
    } else {
      toast('El chequeo automático sólo funciona si la app está alojada (ver LEEME.md)', '');
    }
  };
}

function renderCatalogList() {
  const host = document.getElementById('catalog-full-list');
  if (!host) return;
  const results = searchItems(state.catalog, state.catalogSearch);
  let lastCat = null;
  host.innerHTML = results.map(it => {
    const groupHtml = it.categoriaNombre !== lastCat ? `<div class="catalog-group-label" style="position:static;">${esc(it.categoriaNombre)}</div>` : '';
    lastCat = it.categoriaNombre;
    return `${groupHtml}
      <div class="catalog-row" style="cursor:default;">
        <div><div class="name">${esc(it.label)} ${it.overridden ? '<span class="overridden-dot" title="Precio editado manualmente"></span>' : ''}</div><div class="unit">por ${esc(it.unidad)}</div></div>
        <input class="amount-input cat-price" data-id="${it.id}" type="number" min="0" value="${it.precio}" style="width:110px;text-align:right;">
      </div>`;
  }).join('');
  host.querySelectorAll('.cat-price').forEach(inp => {
    inp.onchange = async () => {
      const val = Number(inp.value) || 0;
      setItemPrice(state.catalog, inp.dataset.id, val);
      await saveCatalog(state.catalog);
      renderCatalogList();
      toast('Precio actualizado', 'success');
    };
  });
}

async function handlePdfUpload(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  toast('Leyendo PDF...', '');
  try {
    const result = await analyzePdfUpdate(state.catalog, file);
    state.pendingUpdate = result;
    openPdfDiffModal(result);
  } catch (err) {
    console.error(err);
    toast('No se pudo leer el PDF. Probá con el archivo oficial de AAIERIC.', 'error');
  }
}

function openPdfDiffModal({ diffs, periodoDetectado, sinCoincidencia }, opts = {}) {
  sinCoincidencia = sinCoincidencia || [];
  if (!diffs.length) {
    const m = openModal(`
      <div class="modal-head"><h3>Sin cambios</h3><button class="icon-btn" id="m-close">✕</button></div>
      <p style="color:var(--text-dim);font-size:13.5px;">No se detectaron precios distintos a los que ya tenés cargados${sinCoincidencia.length ? ` (${sinCoincidencia.length} ítems no se pudieron leer y quedan para edición manual)` : ''}.</p>
    `);
    m.querySelector('#m-close').onclick = closeModal;
    return;
  }
  const html = `
    <div class="modal-head"><h3>Revisar cambios de precios</h3><button class="icon-btn" id="m-close">✕</button></div>
    <p style="color:var(--text-dim);font-size:13px;margin-top:-6px;">
      ${opts.fromRemote ? 'Detectado automáticamente desde la web de AAIERIC. ' : ''}
      ${periodoDetectado ? `Período: <b style="color:var(--text);">${esc(periodoDetectado)}</b>. ` : ''}
      Se detectaron ${diffs.length} cambios. Desmarcá los que no quieras aplicar.
      ${sinCoincidencia.length ? `<br>${sinCoincidencia.length} ítems no se pudieron leer automáticamente — quedan para edición manual.` : ''}
    </p>
    <div style="max-height:340px;overflow-y:auto;border:1px solid var(--border-soft);border-radius:10px;margin-top:10px;">
      ${diffs.map(d => `
        <div class="diff-row">
          <input type="checkbox" class="diff-check" data-id="${d.itemId}" ${d.sospechoso ? '' : 'checked'}>
          <div>${esc(d.label)}${d.sospechoso ? ' <span class="badge badge-danger">revisar</span>' : ''}</div>
          <div class="old">$ ${formatARS(d.precioActual)}</div>
          <div class="arrow">→</div>
          <div class="new">$ ${formatARS(d.precioNuevo)}</div>
        </div>
      `).join('')}
    </div>
    <button class="btn btn-primary btn-block" id="apply-diffs" style="margin-top:14px;">Aplicar cambios seleccionados</button>
  `;
  const modal = openModal(html, { wide: true });
  modal.querySelector('#m-close').onclick = closeModal;
  modal.querySelector('#apply-diffs').onclick = async () => {
    const selected = Array.from(modal.querySelectorAll('.diff-check:checked')).map(c => c.dataset.id);
    applyPdfUpdate(state.catalog, diffs, selected, periodoDetectado);
    await saveCatalog(state.catalog);
    document.getElementById('sidebar-foot').textContent = `Precios AAIERIC · ${state.catalog.periodo}`;
    closeModal();
    if (document.getElementById('catalog-full-list')) {
      renderCatalogList();
      document.querySelector('#view-catalog .page-sub').textContent = catalogSubtitle();
    }
    toast(`${selected.length} precios actualizados`, 'success');
    refreshRemoteCheck();
  };
}

// ---------------------------------------------------------------------
// VIEW: Mi negocio
// ---------------------------------------------------------------------
function renderBusiness() {
  const el = document.getElementById('view-business');
  const b = state.business;
  const p = state.prefs;
  el.innerHTML = `
    ${subtabsHtml([{ v: 'business', label: 'Mi negocio' }, { v: 'clients', label: 'Clientes' }], 'business')}
    <div class="page-head">
      <div><h1 class="page-title">Mi negocio</h1><p class="page-sub">Estos datos aparecen en el encabezado de tus presupuestos.</p></div>
    </div>

    <div class="card">
      <div class="card-title">Datos del negocio</div>
      <div class="grid-2">
        <div class="field"><label>Nombre / marca</label><input id="b-nombre" value="${esc(b.nombre)}" placeholder="Ej: Lerda Instalaciones Eléctricas"></div>
        <div class="field"><label>Responsable</label><input id="b-responsable" value="${esc(b.responsable)}" placeholder="Tu nombre"></div>
        <div class="field"><label>Teléfono</label><input id="b-telefono" value="${esc(b.telefono)}"></div>
        <div class="field"><label>Email</label><input id="b-email" value="${esc(b.email)}"></div>
        <div class="field"><label>Dirección</label><input id="b-direccion" value="${esc(b.direccion)}"></div>
        <div class="field"><label>CUIT (opcional)</label><input id="b-cuit" value="${esc(b.cuit)}"></div>
      </div>
      <div class="field">
        <label>Logo</label>
        <div class="logo-drop" id="logo-drop">
          ${b.logoDataUrl ? `<img class="logo-preview" src="${b.logoDataUrl}"><br>` : ''}
          ${b.logoDataUrl ? 'Tocá para cambiar el logo' : 'Tocá para subir tu logo (PNG o JPG)'}
        </div>
        <input type="file" id="logo-file" accept="image/*" style="display:none;">
      </div>
      <button class="btn btn-primary" id="b-save">Guardar datos</button>
    </div>

    <div class="card">
      <div class="card-title">Preferencias de presupuesto</div>
      <div class="grid-2">
        <div class="field"><label>IVA % por defecto</label><input id="p-iva" type="number" min="0" value="${p.ivaPorcDefault}"></div>
        <div class="field">
          <label>Aplicar IVA por defecto</label>
          <div class="check-row" style="padding-top:9px;"><input type="checkbox" id="p-aplica-iva" ${p.aplicaIvaDefault ? 'checked' : ''}> <label style="margin:0;">Sí</label></div>
        </div>
      </div>
      <div class="hint">Próximo número de presupuesto: <b class="mono">${String(p.proximoNumero).padStart(4, '0')}</b></div>
      <button class="btn" id="p-save" style="margin-top:12px;">Guardar preferencias</button>
    </div>
  `;

  wireGoto(el);
  el.querySelector('#logo-drop').onclick = () => el.querySelector('#logo-file').click();
  el.querySelector('#logo-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    b.logoDataUrl = dataUrl;
    await kvSet(b);
    renderBusiness();
    toast('Logo actualizado', 'success');
  };

  el.querySelector('#b-save').onclick = async () => {
    b.nombre = el.querySelector('#b-nombre').value.trim();
    b.responsable = el.querySelector('#b-responsable').value.trim();
    b.telefono = el.querySelector('#b-telefono').value.trim();
    b.email = el.querySelector('#b-email').value.trim();
    b.direccion = el.querySelector('#b-direccion').value.trim();
    b.cuit = el.querySelector('#b-cuit').value.trim();
    await kvSet(b);
    document.getElementById('app-title').textContent = b.nombre || 'Pilo Presupuestos';
    toast('Datos guardados', 'success');
  };

  el.querySelector('#p-save').onclick = async () => {
    p.ivaPorcDefault = Number(el.querySelector('#p-iva').value) || 0;
    p.aplicaIvaDefault = el.querySelector('#p-aplica-iva').checked;
    await kvSet(p);
    toast('Preferencias guardadas', 'success');
  };
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Igual que fileToDataUrl, pero si es un PDF renderiza la primera página a
// imagen (con pdf.js, el mismo que ya usa la app para leer los precios de
// AAIERIC) para poder dibujar encima como con cualquier foto.
async function fileToPlanoDataUrl(file) {
  const esPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!esPdf) return fileToDataUrl(file);

  const pdfjsLib = await import('../vendor/pdf.min.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = '../vendor/pdf.worker.min.mjs';
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 }); // buena resolución para marcar detalle
  const tmp = document.createElement('canvas');
  tmp.width = viewport.width;
  tmp.height = viewport.height;
  await page.render({ canvasContext: tmp.getContext('2d'), viewport }).promise;
  return tmp.toDataURL('image/png');
}

// ---------------------------------------------------------------------
// VIEW: Inicio
// ---------------------------------------------------------------------
const INSTITUCIONALES = [
  { nombre: 'AEA · Reglamentación 90364', img: 'https://aea.org.ar/wp-content/uploads/2020/04/90364Conjunto.jpg', url: 'https://aea.org.ar/reglamentaciones/digitales/' },
  { nombre: 'AAIERIC', img: 'https://www.aaieric.org.ar/images/comunicados/Logo%20de%20AAIERIC%20Prensa%20Facebook.jpg', url: 'https://aaieric.org.ar/' },
  { nombre: 'Prysmian · Cables', img: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ4ehbkRBQMQaD9EFJcQ0hxvhtThNDUF-yldW0v73qKUJQJRMs2v4k8l9uy&s=10', url: 'https://ar.prysmian.com/es' },
  { nombre: 'Schneider Electric', img: 'https://www.se.com/dam-assets/2hgFSDSuWfHGU9uzMz3I-g/FoPovHKlWpMiU0341m8gZQ/BUILDER.IO%7CSquare/se_logo_social_shared_image_004_BUILDER.IOSquare.webp', url: 'https://www.se.com/ar/es/' },
  { nombre: 'IRAM · Normas', img: 'https://upload.wikimedia.org/wikipedia/commons/e/eb/Positiva_COLOR_fondo-blanco.jpg', url: 'https://www.iram.org.ar/' },
];
const COMERCIOS_LOCALES = [
  { nombre: 'Don Roberto', img: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSU2o5Nr9m3oile5nXuXH_kpDXHB2byoW8NeQ49W-TORk5Uch0bywbA6zs&s=10' },
  { nombre: 'Electroavenida', img: 'https://media.licdn.com/dms/image/v2/D4D0BAQGjyYo--Yh0OA/company-logo_200_200/company-logo_200_200/0/1684328245032?e=2147483647&v=beta&t=C718asNiywZ1hYdqRKdpx6sCVVMI_BOJp-uJC2mU0zE' },
  { nombre: 'Distribuidora Baudracco', img: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSi8Bq64vQ2bBdFY8bBe-3hpyN4umwh4C24HU0l99NB_I-NCtCtEhZPNbqo&s=10' },
  { nombre: 'Mecan', img: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTrMrLVXt1bVQI8d03lFQGaqRiqfkoXtCw5Y7J3S5H1txoWckAlx9lWygr6&s=10' },
];

function acSlide(item, i, linked) {
  const img = `<img src="${esc(item.img)}" alt="${esc(item.nombre)}" loading="lazy" onerror="this.parentElement.classList.add('img-fallback')">`;
  const inner = `<div class="ac-slide-img" data-fallback="${esc(item.nombre)}">${img}</div><div class="ac-slide-label">${esc(item.nombre)}</div>`;
  return linked && item.url
    ? `<div class="ac-slide" data-i="${i}"><a href="${esc(item.url)}" target="_blank" rel="noopener">${inner}</a></div>`
    : `<div class="ac-slide" data-i="${i}">${inner}</div>`;
}
function autoCarouselHtml(id, items, linked) {
  return `
    <div class="auto-carousel" id="${id}">
      <div class="ac-track">${items.map((it, i) => acSlide(it, i, linked)).join('')}</div>
      <button class="ac-arrow ac-prev" type="button" aria-label="Anterior">‹</button>
      <button class="ac-arrow ac-next" type="button" aria-label="Siguiente">›</button>
      <div class="ac-dots">${items.map((_, i) => `<button class="ac-dot ${i === 0 ? 'active' : ''}" type="button" data-i="${i}"></button>`).join('')}</div>
    </div>`;
}

let homeCarouselTimers = [];
function initAutoCarousel(id, intervalMs = 4500) {
  const root = document.getElementById(id);
  if (!root) return;
  const track = root.querySelector('.ac-track');
  const slides = [...root.querySelectorAll('.ac-slide')];
  const dots = [...root.querySelectorAll('.ac-dot')];
  if (!slides.length) return;
  let idx = 0, timer = null;

  function go(i, silent) {
    idx = (i + slides.length) % slides.length;
    track.style.transform = `translateX(-${idx * 100}%)`;
    dots.forEach((d, di) => d.classList.toggle('active', di === idx));
    if (!silent) resetTimer();
  }
  function resetTimer() {
    clearInterval(timer);
    timer = setInterval(() => go(idx + 1, true), intervalMs);
    homeCarouselTimers.push(timer);
  }
  root.querySelector('.ac-prev').onclick = () => go(idx - 1);
  root.querySelector('.ac-next').onclick = () => go(idx + 1);
  dots.forEach(d => { d.onclick = () => go(Number(d.dataset.i)); });

  let dragX = null;
  track.addEventListener('pointerdown', e => { dragX = e.clientX; });
  track.addEventListener('pointerup', e => {
    if (dragX === null) return;
    const dx = e.clientX - dragX;
    dragX = null;
    if (Math.abs(dx) > 40) go(idx + (dx < 0 ? 1 : -1));
  });

  go(0, true);
  resetTimer();
}

function renderHome() {
  homeCarouselTimers.forEach(clearInterval);
  homeCarouselTimers = [];
  const el = document.getElementById('view-home');
  el.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Hola${state.business.responsable ? ', ' + esc(state.business.responsable.split(' ')[0]) : ''}</h1>
        <p class="page-sub">Presupuestos, precios y cálculos de instalación, todo en un mismo lugar y sin conexión.</p>
      </div>
    </div>

    <div class="card home-pitch">
      <div class="card-title">Qué podés hacer acá</div>
      <div class="pitch-grid">
        <div class="pitch-item"><b>Presupuestos</b><span>armá y exportá presupuestos con los costos sugeridos de AAIERIC.</span></div>
        <div class="pitch-item"><b>Precios</b><span>listado AAIERIC siempre actualizado, editable a mano.</span></div>
        <div class="pitch-item"><b>Cálculos</b><span>caída de tensión, grado de electrificación y circuitos según AEA 90364.</span></div>
        <div class="pitch-item"><b>Negocio</b><span>tus datos, tu logo y tus clientes, listos para cada PDF.</span></div>
      </div>
    </div>

    <div class="card-title" style="margin-top:22px;">Normativa y referencias</div>
    ${autoCarouselHtml('carousel-institucional', INSTITUCIONALES, true)}

    <div class="card-title" style="margin-top:22px;">Comercios de Venado Tuerto</div>
    ${autoCarouselHtml('carousel-comercios', COMERCIOS_LOCALES, false)}
  `;
  initAutoCarousel('carousel-institucional');
  initAutoCarousel('carousel-comercios');
}

// ---------------------------------------------------------------------
// VIEW: Cálculos · Caída de Tensión
// ---------------------------------------------------------------------
function renderCaidaTension() {
  const el = document.getElementById('view-calc-caida');
  const f = state.caida;
  const r = calcularCaidaTension(f);

  el.innerHTML = `
    ${subtabsHtml([{ v: 'calc-caida', label: 'Caída de Tensión' }, { v: 'calc-electrif', label: 'Grado de Electrificación' }], 'calc-caida')}
    <div class="page-head">
      <div><h1 class="page-title">Caída de Tensión</h1><p class="page-sub">Según AEA 90364 · límite orientativo 3% (5% en ramales/motores).</p></div>
    </div>

    <div class="builder-grid">
      <div class="card">
        <div class="card-title">Datos del circuito</div>
        <div class="grid-2">
          <div class="field"><label>Tipo de circuito</label>
            <select id="cd-tipo">
              <option value="monofasico" ${f.tipoCircuito === 'monofasico' ? 'selected' : ''}>Monofásico 220V</option>
              <option value="trifasico" ${f.tipoCircuito === 'trifasico' ? 'selected' : ''}>Trifásico 380V</option>
            </select>
          </div>
          <div class="field"><label>Material</label>
            <select id="cd-material">
              <option value="cobre" ${f.material === 'cobre' ? 'selected' : ''}>Cobre</option>
              <option value="aluminio" ${f.material === 'aluminio' ? 'selected' : ''}>Aluminio</option>
            </select>
          </div>
        </div>
        <div class="field"><label>Calcular por</label>
          <select id="cd-calcularpor">
            <option value="potencia" ${f.calcularPor === 'potencia' ? 'selected' : ''}>Potencia (W)</option>
            <option value="corriente" ${f.calcularPor === 'corriente' ? 'selected' : ''}>Corriente (A)</option>
          </select>
        </div>
        <div id="cd-por-field">${caidaPorFieldHtml(f)}</div>
        <div class="field"><label>Longitud del cable, medidor/tablero → carga (m)</label><input id="cd-longitud" type="number" min="0" value="${f.longitudM}"></div>
        <div class="field"><label>Factor de potencia</label><input id="cd-fp" type="number" min="0.5" max="1" step="0.05" value="${f.factorPotencia}"></div>
        <div class="hint">Cargá potencia o corriente, no las dos — la app calcula la que falta.</div>
      </div>

      <div class="card">
        <div class="card-title">Resultado</div>
        <div id="cd-result">${caidaResultHtml(r)}</div>
      </div>
    </div>
  `;
  wireGoto(el);

  const updateResult = () => {
    document.getElementById('cd-result').innerHTML = caidaResultHtml(calcularCaidaTension(f));
  };
  el.querySelector('#cd-tipo').onchange = e => { f.tipoCircuito = e.target.value; updateResult(); };
  el.querySelector('#cd-material').onchange = e => { f.material = e.target.value; updateResult(); };
  el.querySelector('#cd-calcularpor').onchange = e => {
    f.calcularPor = e.target.value;
    document.getElementById('cd-por-field').innerHTML = caidaPorFieldHtml(f);
    wirePorField();
    updateResult();
  };
  el.querySelector('#cd-longitud').oninput = e => { f.longitudM = Number(e.target.value) || 0; updateResult(); };
  el.querySelector('#cd-fp').oninput = e => { f.factorPotencia = Number(e.target.value) || 1; updateResult(); };

  function wirePorField() {
    const potInput = document.getElementById('cd-potencia');
    if (potInput) potInput.oninput = e => { f.potenciaW = Number(e.target.value) || 0; updateResult(); };
    const corInput = document.getElementById('cd-corriente');
    if (corInput) corInput.oninput = e => { f.corrienteA = Number(e.target.value) || 0; updateResult(); };
  }
  wirePorField();
}

function caidaPorFieldHtml(f) {
  return f.calcularPor === 'potencia'
    ? `<div class="field"><label>Potencia (W)</label><input id="cd-potencia" type="number" min="0" value="${f.potenciaW}"></div>`
    : `<div class="field"><label>Corriente (A)</label><input id="cd-corriente" type="number" min="0" value="${f.corrienteA}"></div>`;
}

function caidaResultHtml(r) {
  return `
    <div class="kv"><span>Corriente</span><b class="mono">${r.corriente.toFixed(2)} A</b></div>
    <div class="kv"><span>Sección mínima recomendada</span><b class="mono">${r.seccionSugerida} mm²</b></div>
    <div class="kv"><span>Caída de tensión estimada</span><b class="mono">${r.caidaV.toFixed(2)} V (${r.caidaPorc.toFixed(2)}%)</b></div>
    <div class="kv"><span>Cumple 3% (iluminación/tomas)</span>${r.cumple3 ? '<span class="badge badge-success">Sí</span>' : '<span class="badge badge-danger">No</span>'}</div>
    <div class="kv"><span>Cumple 5% (ramal/motores)</span>${r.cumple5 ? '<span class="badge badge-success">Sí</span>' : '<span class="badge badge-danger">No</span>'}</div>
    <div class="hint" style="margin-top:12px;">Secciones normalizadas de referencia: ${SECCIONES_NORMALIZADAS.join(', ')} mm².</div>
    <p class="hint">Cálculo orientativo. Para tramos críticos, verificá siempre contra el proyecto ejecutivo.</p>
  `;
}

// ---------------------------------------------------------------------
// VIEW: Cálculos · Grado de Electrificación y Circuitos
// ---------------------------------------------------------------------
const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>';
const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

function renderElectrificacion() {
  if (state.electrifSubview === 'editor') renderElectrifEditor();
  else renderElectrifLista();
}

function nuevoElectrifDraft() {
  return { id: uid('plano'), nombre: '', tipoInmuebleId: 'vivienda', creadoEn: new Date().toISOString() };
}

function renderElectrifLista() {
  const el = document.getElementById('view-calc-electrif');
  const planos = [...state.planos].sort((a, b) => new Date(b.actualizadoEn || b.creadoEn) - new Date(a.actualizadoEn || a.creadoEn));
  el.innerHTML = `
    ${subtabsHtml([{ v: 'calc-caida', label: 'Caída de Tensión' }, { v: 'calc-electrif', label: 'Grado de Electrificación' }], 'calc-electrif')}
    <div class="page-head">
      <div><h1 class="page-title">Grado de Electrificación y Circuitos</h1><p class="page-sub">${planos.length} guardado${planos.length === 1 ? '' : 's'} · según AEA 90364</p></div>
      <button class="btn btn-primary" id="btn-new-plano">+ Nuevo cálculo</button>
    </div>
    <div id="planos-list"></div>
  `;
  wireGoto(el);
  const host = document.getElementById('planos-list');
  if (!planos.length) {
    host.innerHTML = emptyState('Todavía no hiciste ningún cálculo', 'Subí un plano, marcá los ambientes y la app te calcula el grado de electrificación, los circuitos y los materiales.');
  } else {
    host.innerHTML = planos.map(p => `
      <div class="list-row" data-id="${p.id}">
        <div>
          <div class="title">${esc(p.nombre || 'Sin nombre')}</div>
          <div class="meta">${esc(p.tipoInmuebleNombre || '')} · ${(p.superficieTotalM2 || 0).toFixed(1)} m²${p.gradoNombre ? ' · Grado ' + esc(p.gradoNombre) : ''}</div>
        </div>
        <div class="row-actions">
          <button class="icon-btn plano-del" title="Eliminar">${ICON_TRASH}</button>
        </div>
      </div>
    `).join('');
    host.querySelectorAll('.list-row').forEach(row => {
      const p = state.planos.find(x => x.id === row.dataset.id);
      row.addEventListener('click', e => { if (!e.target.closest('.plano-del')) abrirPlanoExistente(p); });
      row.querySelector('.plano-del').onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`¿Eliminar "${p.nombre || 'este cálculo'}"?`)) return;
        await itemDelete('planos', p.id);
        state.planos = await listAll('planos');
        renderElectrifLista();
        toast('Cálculo eliminado', '');
      };
    });
  }
  document.getElementById('btn-new-plano').onclick = () => {
    state.electrifDraft = nuevoElectrifDraft();
    state.planoEngine = null;
    state.electrifCalc = null;
    state.electrifSubview = 'editor';
    showView('calc-electrif');
  };
}

function abrirPlanoExistente(p) {
  state.electrifDraft = { id: p.id, nombre: p.nombre, tipoInmuebleId: p.tipoInmuebleId, creadoEn: p.creadoEn };
  // "motor" temporal que sólo sabe devolver los datos guardados — renderElectrifEditor
  // lo usa para hidratar una instancia real de PlanoCanvas apenas arranca.
  state.planoEngine = { serialize: () => p.datos };
  state.electrifCalc = null;
  state.electrifSubview = 'editor';
  showView('calc-electrif');
}

function renderElectrifEditor() {
  const el = document.getElementById('view-calc-electrif');
  const draft = state.electrifDraft || (state.electrifDraft = nuevoElectrifDraft());
  const savedData = state.planoEngine ? state.planoEngine.serialize() : null;
  const yaGuardado = state.planos.some(p => p.id === draft.id);

  el.innerHTML = `
    ${subtabsHtml([{ v: 'calc-caida', label: 'Caída de Tensión' }, { v: 'calc-electrif', label: 'Grado de Electrificación' }], 'calc-electrif')}
    <div class="page-head">
      <div style="flex:1;">
        <button class="btn btn-ghost btn-sm" id="btn-back-planos">← Guardados</button>
        <h1 class="page-title" style="margin-top:8px;">
          <input id="pl-nombre" value="${esc(draft.nombre)}" placeholder="Nombre del cálculo (ej: Casa Uruguay)" style="font:inherit;font-weight:700;border:none;background:transparent;padding:0;width:100%;color:inherit;">
        </h1>
      </div>
      <div class="field" style="min-width:220px;margin:0;">
        <label>Tipo de inmueble</label>
        <select id="pl-tipo">
          ${TIPOS_INMUEBLE.map(t => `<option value="${t.id}" ${t.id === draft.tipoInmuebleId ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="card" id="electrif-upload-card" style="${savedData && savedData.imageDataUrl ? 'display:none;' : ''}">
      <div class="card-title">Subí el plano</div>
      <div class="logo-drop" id="plano-drop">Tocá para elegir una foto, imagen o PDF del plano</div>
      <input type="file" id="plano-file" accept="image/*,.pdf,application/pdf" style="display:none;">
      <p class="hint">Después vas a poder marcar la escala, dibujar cada ambiente y trazar las canalizaciones directamente sobre esta imagen. Si subís un PDF, se usa la primera página.</p>
    </div>

    <div id="electrif-canvas-area" style="${savedData && savedData.imageDataUrl ? '' : 'display:none;'}">
      <div class="card">
        <div class="plano-toolbar">
          <div class="toolbar-modes">
            <button class="btn btn-sm mode-btn" data-mode="calibrar">📏 Escala</button>
            <button class="btn btn-sm mode-btn" data-mode="ambiente">▭ Ambiente</button>
            <button class="btn btn-sm mode-btn" data-mode="canalizacion">〰 Canalización</button>
            <button class="btn btn-sm mode-btn active" data-mode="ver">👁 Ver</button>
          </div>
          <div class="toolbar-actions" id="toolbar-actions"></div>
        </div>
        <div class="zoom-controls">
          <button class="btn btn-sm" id="zoom-out" title="Alejar">−</button>
          <span class="zoom-level" id="zoom-level">100%</span>
          <button class="btn btn-sm" id="zoom-in" title="Acercar">+</button>
          <button class="btn btn-sm btn-ghost" id="zoom-reset">Restablecer</button>
          <span class="hint" style="margin-left:auto;">Pellizcá con dos dedos para hacer zoom · en modo "Ver" arrastrá para mover el plano</span>
        </div>
        <div id="plano-canvas-wrap"><canvas id="plano-canvas"></canvas></div>
        <p class="hint" id="scale-hint" style="margin-top:8px;"></p>
      </div>

      <div class="card">
        <div class="card-title">Ambientes <span class="badge badge-muted" id="rooms-count">0</span></div>
        <div id="electrif-rooms-list"></div>
      </div>

      <div class="card">
        <div class="card-title">Canalizaciones <span class="badge badge-muted" id="canal-count">0</span></div>
        <div id="electrif-canal-list"></div>
      </div>

      <div class="card">
        <button class="btn btn-primary btn-block" id="btn-calcular">Calcular instalación</button>
        <div id="electrif-results"></div>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;margin-bottom:40px;">
        <button class="btn btn-primary" id="btn-save-plano">Guardar cálculo</button>
        <button class="btn" id="btn-pdf-plano">Exportar PDF</button>
        ${yaGuardado ? '<button class="btn btn-danger" id="btn-del-plano">Eliminar</button>' : ''}
      </div>
    </div>
  `;
  wireGoto(el);

  document.getElementById('btn-back-planos').onclick = () => { state.electrifSubview = 'lista'; showView('calc-electrif'); };
  document.getElementById('pl-nombre').oninput = e => { draft.nombre = e.target.value; };
  document.getElementById('pl-tipo').onchange = e => { draft.tipoInmuebleId = e.target.value; };

  // --- Motor de canvas: instancia nueva atada al <canvas> recién creado ---
  const canvas = document.getElementById('plano-canvas');
  const engine = new PlanoCanvas(canvas, {
    onRoomClosed: (room) => openRoomTypeModal(room, engine),
    onCalibration: (pixelDist, resetFn) => openCalibrationModal(pixelDist, (metros) => {
      engine.setPixelsPerMeter(pixelDist / metros);
      engine.setMode('ver');
      setActiveMode('ver');
    }, resetFn),
    onChange: () => refreshPanels(),
    onZoomChange: (pct) => { const el = document.getElementById('zoom-level'); if (el) el.textContent = `${pct}%`; },
  });
  state.planoEngine = engine;

  document.getElementById('zoom-in').onclick = () => { engine.zoomBy(1.4); updateZoomLabel(); };
  document.getElementById('zoom-out').onclick = () => { engine.zoomBy(1 / 1.4); updateZoomLabel(); };
  document.getElementById('zoom-reset').onclick = () => { engine.resetView(); updateZoomLabel(); };
  function updateZoomLabel() { document.getElementById('zoom-level').textContent = `${engine.zoomPercent()}%`; }

  function showCanvasArea() {
    document.getElementById('electrif-upload-card').style.display = 'none';
    document.getElementById('electrif-canvas-area').style.display = '';
  }

  if (savedData && savedData.imageDataUrl) {
    engine.loadFromData(savedData).then(refreshPanels);
  }

  // --- Subida de plano (foto, imagen o PDF) ---
  document.getElementById('plano-drop').onclick = () => document.getElementById('plano-file').click();
  document.getElementById('plano-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const dropEl = document.getElementById('plano-drop');
    const original = dropEl.textContent;
    dropEl.textContent = 'Procesando el plano…';
    dropEl.style.pointerEvents = 'none';
    try {
      const dataUrl = await fileToPlanoDataUrl(file);
      await engine.setImage(dataUrl);
      showCanvasArea();
      refreshPanels();
    } catch (err) {
      console.error(err);
      toast('No se pudo leer ese archivo. Probá con otra foto, imagen o PDF.', 'error');
      dropEl.textContent = original;
      dropEl.style.pointerEvents = '';
    }
  };

  // --- Modos de dibujo ---
  function setActiveMode(mode) {
    el.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    renderToolbarActions(mode);
  }
  el.querySelectorAll('.mode-btn').forEach(b => {
    b.onclick = () => { engine.setMode(b.dataset.mode); setActiveMode(b.dataset.mode); };
  });

  function renderToolbarActions(mode) {
    const host = document.getElementById('toolbar-actions');
    if (mode === 'ambiente') {
      host.innerHTML = `
        <div class="field" style="margin:0;min-width:170px;">
          <select id="ta-tipo-ambiente" title="Tipo de ambiente que estás marcando">
            ${TIPOS_AMBIENTE.map(t => `<option value="${t.id}" ${t.id === engine.tipoAmbienteActivo ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-sm" id="ta-close-room">Cerrar ambiente</button>
        <button class="btn btn-sm btn-ghost" id="ta-undo">Deshacer punto</button>
      `;
      host.querySelector('#ta-tipo-ambiente').onchange = e => engine.setTipoAmbienteActivo(e.target.value);
      host.querySelector('#ta-close-room').onclick = () => engine.closeActiveRoom();
      host.querySelector('#ta-undo').onclick = () => engine.undoLastPoint();
    } else if (mode === 'canalizacion') {
      host.innerHTML = `
        <div class="color-swatches">
          ${COLORES_CANALIZACION.map(c => `<button class="color-swatch ${c.hex === engine.currentColor ? 'active' : ''}" data-color="${c.hex}" style="background:${c.hex}" title="${esc(c.nombre)}"></button>`).join('')}
        </div>
        <button class="btn btn-sm" id="ta-finish-curve">Finalizar trazo</button>
        <button class="btn btn-sm btn-ghost" id="ta-undo">Deshacer punto</button>
      `;
      host.querySelectorAll('.color-swatch').forEach(sw => sw.onclick = () => {
        engine.setCurrentColor(sw.dataset.color);
        host.querySelectorAll('.color-swatch').forEach(s => s.classList.toggle('active', s === sw));
      });
      host.querySelector('#ta-finish-curve').onclick = () => engine.finishActiveCurve();
      host.querySelector('#ta-undo').onclick = () => engine.undoLastPoint();
    } else {
      host.innerHTML = '';
    }
  }
  setActiveMode('ver');

  // --- Paneles (ambientes / canalizaciones / escala) ---
  function refreshPanels() {
    document.getElementById('scale-hint').textContent = engine.hasScale()
      ? `Escala definida: ${engine.pixelsPerMeter.toFixed(1)} px/m. Podés volver a calibrarla cuando quieras desde el modo "Escala".`
      : 'Todavía no marcaste la escala — hacé zoom para ubicar bien los dos puntos, usá el modo "Escala" y tocá una medida conocida (ej: el ancho de una puerta, 0,80 m) antes de dibujar ambientes.';
    document.getElementById('electrif-rooms-list').innerHTML = ambientesListHtml(engine);
    document.getElementById('rooms-count').textContent = engine.rooms.length;
    document.getElementById('electrif-canal-list').innerHTML = canalizacionesListHtml(engine);
    document.getElementById('canal-count').textContent = engine.canalizaciones.length;
    document.querySelectorAll('#electrif-rooms-list [data-room]').forEach(row => {
      const room = engine.rooms.find(r => r.id === row.dataset.room);
      if (!room) return;
      row.querySelector('.room-edit').onclick = () => openRoomTypeModal(room, engine);
      row.querySelector('.room-del').onclick = () => engine.deleteRoom(room.id);
    });
    document.querySelectorAll('#electrif-canal-list [data-canal]').forEach(row => {
      const canal = engine.canalizaciones.find(c => c.id === row.dataset.canal);
      if (!canal) return;
      row.querySelector('.canal-del').onclick = () => engine.deleteCanalizacion(canal.id);
    });
  }
  refreshPanels();

  // --- Calcular / Guardar / Exportar / Eliminar ---
  document.getElementById('btn-calcular').onclick = () => {
    if (!engine.rooms.length) { toast('Marcá al menos un ambiente antes de calcular', 'error'); return; }
    const superficieTotal = engine.superficieTotalM2();
    const instalacion = calcularInstalacion(engine.rooms, superficieTotal);
    const materiales = calcularMateriales({ instalacion, canalizaciones: engine.canalizaciones });
    state.electrifCalc = { instalacion, materiales };
    document.getElementById('electrif-results').innerHTML = electrifResultsHtml(instalacion, materiales);
  };

  const saveBtn = document.getElementById('btn-save-plano');
  saveBtn.onclick = () => withLoading(saveBtn, () => guardarPlano(draft, engine));

  const pdfBtn = document.getElementById('btn-pdf-plano');
  pdfBtn.onclick = () => withLoading(pdfBtn, () => exportarPlanoPdf(draft, engine));

  const delBtn = document.getElementById('btn-del-plano');
  if (delBtn) delBtn.onclick = async () => {
    if (!confirm(`¿Eliminar "${draft.nombre || 'este cálculo'}"?`)) return;
    await itemDelete('planos', draft.id);
    state.planos = await listAll('planos');
    state.electrifSubview = 'lista';
    showView('calc-electrif');
    toast('Cálculo eliminado', '');
  };
}

function ambientesListHtml(engine) {
  if (!engine.rooms.length) return '<p class="hint">Todavía no marcaste ambientes. Elegí el modo "Ambiente" arriba y tocá las esquinas sobre el plano (cerrá tocando cerca del primer punto, o con el botón "Cerrar ambiente").</p>';
  const grado = determinarGradoElectrificacion(engine.superficieTotalM2());
  return engine.rooms.map(r => {
    const b = bocasPorAmbiente(r.tipoAmbienteId, r.areaM2, grado.id);
    return `
    <div class="list-row" data-room="${r.id}">
      <div>
        <div class="title">${esc(r.nombre || 'Ambiente')}</div>
        <div class="meta">${(r.areaM2 || 0).toFixed(1)} m² · IUG ${b.iug} · TUG ${b.tug}${b.tue ? ` · TUE ${b.tue}` : ''}</div>
      </div>
      <div class="row-actions">
        <button class="icon-btn room-edit" title="Editar">${ICON_EDIT}</button>
        <button class="icon-btn room-del" title="Eliminar">${ICON_TRASH}</button>
      </div>
    </div>`;
  }).join('');
}

function canalizacionesListHtml(engine) {
  if (!engine.canalizaciones.length) return '<p class="hint">Sin canalizaciones marcadas todavía. Elegí el modo "Canalización", un color, y tocá el recorrido sobre el plano.</p>';
  return engine.canalizaciones.map(c => `
    <div class="list-row" data-canal="${c.id}">
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="color-dot" style="background:${c.color};"></span>
        <div class="title">${(c.largoM || 0).toFixed(1)} m</div>
      </div>
      <button class="icon-btn canal-del" title="Eliminar">${ICON_TRASH}</button>
    </div>
  `).join('');
}

function electrifResultsHtml(instalacion, materiales) {
  return `
    <div class="kv"><span>Superficie total</span><b class="mono">${instalacion.superficieTotalM2.toFixed(1)} m²</b></div>
    <div class="kv"><span>Grado de electrificación</span><b>${instalacion.grado.nombre}</b></div>
    <div class="kv"><span>Potencia estimada</span><b class="mono">${instalacion.grado.kva ? instalacion.grado.kva + ' kVA' : '—'}</b></div>
    <div class="kv"><span>Bocas totales (IUG/TUG/TUE)</span><b class="mono">${instalacion.totalIug}/${instalacion.totalTug}/${instalacion.totalTue}</b></div>
    <div class="kv"><span>Circuitos sugeridos</span><b class="mono">${instalacion.circuitosSugeridos}</b></div>
    <div class="kv"><span>Sección ramal medidor→tablero</span><b class="mono">${materiales.seccionRamalMm2} mm²</b></div>
    <div class="card-title" style="margin-top:16px;">Materiales estimados</div>
    <div class="kv"><span>Cajas octogonales</span><b class="mono">${materiales.cajasOctogonales}</b></div>
    <div class="kv"><span>Cajas rectangulares</span><b class="mono">${materiales.cajasRectangulares}</b></div>
    <div class="kv"><span>Módulos de toma</span><b class="mono">${materiales.modulosToma}</b></div>
    <div class="kv"><span>Módulos de llave</span><b class="mono">${materiales.modulosLlave}</b></div>
    <div class="kv"><span>Tapas ciegas</span><b class="mono">${materiales.tapasCiegas}</b></div>
    <div class="kv"><span>Termomagnéticas</span><b class="mono">${materiales.termomagneticas}</b></div>
    <div class="kv"><span>Diferenciales (30 mA)</span><b class="mono">${materiales.diferenciales}</b></div>
    <div class="kv"><span>Tableros</span><b class="mono">${materiales.tableros}</b></div>
    <div class="kv"><span>Caño corrugado/PVC</span><b class="mono">${materiales.metrosCanoCorrugado} m</b></div>
    <div class="kv"><span>Cable por circuitos</span><b class="mono">${materiales.metrosCableCircuitos}</b></div>
    <p class="hint" style="margin-top:10px;">Cálculo orientativo según AEA 90364. No reemplaza el proyecto ejecutivo firmado por el instalador matriculado.</p>
  `;
}

function openRoomTypeModal(room, engine) {
  const html = `
    <div class="modal-head"><h3>Tipo de ambiente</h3><button class="icon-btn" id="m-close">✕</button></div>
    <div class="field"><label>Ambiente</label>
      <select id="rm-tipo">
        ${TIPOS_AMBIENTE.map(t => `<option value="${t.id}" ${t.id === room.tipoAmbienteId ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>Nombre (opcional)</label><input id="rm-nombre" value="${esc(room.nombre)}" placeholder="ej: Dormitorio 1"></div>
    <div class="hint">Área detectada: ${(room.areaM2 || 0).toFixed(1)} m²${room.areaM2 ? '' : ' (definí la escala para ver el área real)'}</div>
    <button class="btn btn-primary btn-block" id="rm-save" style="margin-top:14px;">Guardar</button>
  `;
  const modal = openModal(html);
  modal.querySelector('#m-close').onclick = closeModal;
  modal.querySelector('#rm-save').onclick = () => {
    const tipoId = modal.querySelector('#rm-tipo').value;
    const tipo = TIPOS_AMBIENTE.find(t => t.id === tipoId);
    const nombre = modal.querySelector('#rm-nombre').value.trim() || (tipo ? tipo.nombre : 'Ambiente');
    engine.updateRoom(room.id, { tipoAmbienteId: tipoId, nombre });
    closeModal();
  };
}

function openCalibrationModal(pixelDist, onConfirm, onCancel) {
  const html = `
    <div class="modal-head"><h3>Calibrar escala</h3><button class="icon-btn" id="m-close">✕</button></div>
    <p class="hint">Marcaste dos puntos sobre el plano. ¿Qué distancia real representan (en metros)? Por ejemplo, el ancho de una puerta suele ser 0,80 m.</p>
    <div class="field"><label>Distancia real (m)</label><input id="cal-metros" type="number" min="0.01" step="0.01" value="0.80"></div>
    <button class="btn btn-primary btn-block" id="cal-save">Confirmar</button>
  `;
  const modal = openModal(html);
  modal.querySelector('#m-close').onclick = () => { onCancel && onCancel(); closeModal(); };
  modal.querySelector('#cal-save').onclick = () => {
    const metros = Number(modal.querySelector('#cal-metros').value) || 0;
    if (metros <= 0) { toast('Poné una distancia válida', 'error'); return; }
    onConfirm(metros);
    closeModal();
  };
}

async function guardarPlano(draft, engine) {
  if (!engine.image) { toast('Subí un plano antes de guardar', 'error'); return; }
  const superficieTotal = engine.superficieTotalM2();
  const instalacion = calcularInstalacion(engine.rooms, superficieTotal);
  const record = {
    id: draft.id,
    nombre: draft.nombre || 'Sin nombre',
    tipoInmuebleId: draft.tipoInmuebleId,
    tipoInmuebleNombre: (TIPOS_INMUEBLE.find(t => t.id === draft.tipoInmuebleId) || {}).nombre || '',
    superficieTotalM2: superficieTotal,
    gradoNombre: instalacion.grado.nombre,
    creadoEn: draft.creadoEn || new Date().toISOString(),
    actualizadoEn: new Date().toISOString(),
    datos: engine.serialize(),
  };
  await itemPut('planos', record);
  state.planos = await listAll('planos');
  toast('Cálculo guardado', 'success');
}

async function exportarPlanoPdf(draft, engine) {
  if (!engine.rooms.length) { toast('Marcá al menos un ambiente antes de exportar', 'error'); return; }
  const superficieTotal = engine.superficieTotalM2();
  const instalacion = calcularInstalacion(engine.rooms, superficieTotal);
  const materiales = calcularMateriales({ instalacion, canalizaciones: engine.canalizaciones });
  const plano = {
    nombre: draft.nombre || 'Sin nombre',
    tipoInmuebleNombre: (TIPOS_INMUEBLE.find(t => t.id === draft.tipoInmuebleId) || {}).nombre || '',
  };
  const doc = await buildPlanoPdf({ plano, instalacion, materiales, business: state.business, snapshotDataUrl: engine.snapshotDataUrl() });
  const filename = `grado-electrificacion-${(draft.nombre || 'calculo').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;
  await savePdfFile(doc, filename);
  toast('PDF exportado', 'success');
}

// ---------------------------------------------------------------------
init();
