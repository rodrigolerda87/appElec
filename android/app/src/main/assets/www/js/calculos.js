// calculos.js — motor de cálculos normativos (AEA 90364).
// Todo esto es lógica pura (sin DOM), fácil de testear y de ajustar si
// aparece un caso que no matchea con lo que necesita Uri en obra.
//
// IMPORTANTE: estos valores son una simplificación orientativa de la
// Reglamentación AEA 90364 (secciones 770/771), pensada para dar un punto
// de partida rápido en obra. No reemplazan el proyecto ejecutivo firmado
// por un instalador matriculado — eso se aclara también en la UI y en el PDF.

// ---------------------------------------------------------------------
// Caída de tensión
// ---------------------------------------------------------------------

// Resistividad a 70°C (temperatura de operación normal del PVC), Ω·mm²/m
export const RESISTIVIDAD = { cobre: 0.0225, aluminio: 0.036 };

export const SECCIONES_NORMALIZADAS = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240];

/**
 * Calcula la caída de tensión (o la sección mínima necesaria) de un tramo.
 * input: { tipoCircuito: 'monofasico'|'trifasico', material: 'cobre'|'aluminio',
 *          calcularPor: 'potencia'|'corriente', potenciaW, corrienteA,
 *          longitudM, factorPotencia, seccionMm2 (opcional, si se quiere
 *          verificar una sección puntual en vez de que la sugiera) }
 */
export function calcularCaidaTension(input) {
  const {
    tipoCircuito = 'monofasico',
    material = 'cobre',
    calcularPor = 'potencia',
    potenciaW = 0,
    corrienteA = 0,
    longitudM = 0,
    factorPotencia = 1,
    seccionMm2 = null,
  } = input;

  const rho = RESISTIVIDAD[material] || RESISTIVIDAD.cobre;
  const tensionNominal = tipoCircuito === 'trifasico' ? 380 : 220;
  const fp = Math.min(1, Math.max(0.5, Number(factorPotencia) || 1));

  let corriente = Number(corrienteA) || 0;
  if (calcularPor === 'potencia') {
    const p = Number(potenciaW) || 0;
    corriente = tipoCircuito === 'trifasico'
      ? p / (Math.sqrt(3) * tensionNominal * fp)
      : p / (tensionNominal * fp);
  }

  const k = tipoCircuito === 'trifasico' ? Math.sqrt(3) : 2;
  const L = Number(longitudM) || 0;

  // Sección mínima para no pasar el 3% (o la que se pida verificar)
  const limitePorc = 3;
  const limiteV = tensionNominal * (limitePorc / 100);
  const seccionMinimaCalc = (k * corriente * L * rho) / limiteV;
  const seccionSugerida = SECCIONES_NORMALIZADAS.find(s => s >= seccionMinimaCalc) || SECCIONES_NORMALIZADAS[SECCIONES_NORMALIZADAS.length - 1];

  const seccionAVerificar = seccionMm2 ? Number(seccionMm2) : seccionSugerida;
  const caidaV = (k * corriente * L * rho) / seccionAVerificar;
  const caidaPorc = (caidaV / tensionNominal) * 100;

  return {
    tensionNominal,
    corriente,
    seccionMinimaCalc,
    seccionSugerida,
    seccionVerificada: seccionAVerificar,
    caidaV,
    caidaPorc,
    cumple3: caidaPorc <= 3,
    cumple5: caidaPorc <= 5,
  };
}

// ---------------------------------------------------------------------
// Tipos de inmueble y grado de electrificación (AEA 90364-7-770/771)
// ---------------------------------------------------------------------

export const TIPOS_INMUEBLE = [
  { id: 'vivienda', nombre: 'Vivienda unifamiliar', norma: 'AEA 90364-7-770' },
  { id: 'departamento', nombre: 'Departamento en propiedad horizontal', norma: 'AEA 90364-7-771' },
  { id: 'local', nombre: 'Local comercial / oficina', norma: 'AEA 90364-7-771' },
  { id: 'galpon', nombre: 'Galpón / depósito / taller', norma: 'AEA 90364-7-771' },
];

// Grados según AEA 90364-7-770 (viviendas ≤63A). Se usa también como
// referencia orientativa para los demás tipos de inmueble, aclarando en
// la UI que en esos casos la 771 exige criterio de proyecto adicional.
const GRADOS = [
  { id: 'minimo', nombre: 'Mínimo', hastaM2: 60, kva: 3.7, circuitosMin: 2, seccionRamalMm2: 6 },
  { id: 'medio', nombre: 'Medio', hastaM2: 130, kva: 7, circuitosMin: 3, seccionRamalMm2: 10 },
  { id: 'elevado', nombre: 'Elevado', hastaM2: 200, kva: 11, circuitosMin: 5, seccionRamalMm2: 16 },
  { id: 'superior', nombre: 'Superior', hastaM2: Infinity, kva: null, circuitosMin: 6, seccionRamalMm2: 16 },
];

export function determinarGradoElectrificacion(superficieM2) {
  const s = Number(superficieM2) || 0;
  return GRADOS.find(g => s <= g.hastaM2) || GRADOS[GRADOS.length - 1];
}

export function listaGrados() { return GRADOS; }

// ---------------------------------------------------------------------
// Puntos mínimos de utilización por ambiente (simplificado de AEA 770/771)
// Formato: { iug, tug, tue } = bocas mínimas de Iluminación de Uso General,
// Tomacorrientes de Uso General y Tomas de Uso Específico.
// ---------------------------------------------------------------------

export const TIPOS_AMBIENTE = [
  { id: 'estar_comedor', nombre: 'Estar / comedor', iug: 1, tug: 3, tue: 0 },
  { id: 'dormitorio', nombre: 'Dormitorio', iug: 1, tug: 3, tue: 0 },
  { id: 'cocina', nombre: 'Cocina', iug: 1, tug: 3, tue: 2 },
  { id: 'lavadero', nombre: 'Lavadero', iug: 1, tug: 1, tue: 1 },
  { id: 'bano', nombre: 'Baño', iug: 1, tug: 1, tue: 0 },
  { id: 'pasillo', nombre: 'Pasillo / circulación', iug: 1, tug: 0, tue: 0 },
  { id: 'garage', nombre: 'Garage / cochera', iug: 1, tug: 1, tue: 0 },
  { id: 'exterior', nombre: 'Galería / patio / exterior', iug: 1, tug: 1, tue: 0 },
  { id: 'deposito', nombre: 'Depósito / taller / galpón', iug: 1, tug: 2, tue: 0 },
  { id: 'oficina', nombre: 'Oficina / local', iug: 1, tug: 2, tue: 0 },
  { id: 'otro', nombre: 'Otro ambiente', iug: 1, tug: 1, tue: 0 },
];

export function bocasPorAmbiente(tipoAmbienteId, superficieM2) {
  const tipo = TIPOS_AMBIENTE.find(t => t.id === tipoAmbienteId) || TIPOS_AMBIENTE[TIPOS_AMBIENTE.length - 1];
  let { iug, tug, tue } = tipo;
  const s = Number(superficieM2) || 0;

  // Ajustes por superficie: pasillos largos y ambientes grandes piden más bocas.
  if (tipo.id === 'pasillo' && s > 5) iug += Math.floor(s / 5);
  if (tipo.id === 'estar_comedor' && s > 18) tug += Math.ceil((s - 18) / 6);
  if (tipo.id === 'dormitorio' && s > 36) { iug = 2; tue = 1; }

  return { iug, tug, tue, total: iug + tug + tue };
}

/** A partir de la lista de ambientes ya dibujados y tipificados, calcula
 * bocas totales, circuitos sugeridos por tipo y grado de electrificación. */
export function calcularInstalacion(ambientes, superficieTotalM2) {
  const grado = determinarGradoElectrificacion(superficieTotalM2);

  let totalIug = 0, totalTug = 0, totalTue = 0;
  const detalle = ambientes.map(a => {
    const b = bocasPorAmbiente(a.tipoAmbienteId, a.areaM2);
    totalIug += b.iug; totalTug += b.tug; totalTue += b.tue;
    const tipo = TIPOS_AMBIENTE.find(t => t.id === a.tipoAmbienteId);
    return { ...a, tipoAmbienteNombre: tipo ? tipo.nombre : 'Ambiente', bocas: b };
  });

  // Circuitos sugeridos: se agrupan bocas de IUG y TUG en circuitos de
  // hasta 15 bocas (criterio habitual de obra para no saturar un
  // termomagnético de 10A/16A), y cada TUE de cocina/lavadero va con
  // circuito propio (heladera, lavarropas, etc. no comparten protección).
  const circuitosIug = Math.max(1, Math.ceil(totalIug / 15));
  const circuitosTug = Math.max(1, Math.ceil(totalTug / 15));
  const circuitosTue = totalTue; // cada TUE es, como mínimo, un circuito propio
  const circuitosSugeridos = Math.max(grado.circuitosMin, circuitosIug + circuitosTug + circuitosTue);

  return {
    grado,
    superficieTotalM2: Number(superficieTotalM2) || 0,
    totalIug, totalTug, totalTue,
    totalBocas: totalIug + totalTug + totalTue,
    circuitosIug, circuitosTug, circuitosTue,
    circuitosSugeridos,
    detalle,
  };
}

// ---------------------------------------------------------------------
// Lista de materiales, a partir del cálculo anterior + canalizaciones
// dibujadas sobre el plano (largo total en metros, por color/circuito).
// ---------------------------------------------------------------------

export function calcularMateriales({ instalacion, canalizaciones, seccionRamalMm2 }) {
  const { totalIug, totalTug, totalTue, circuitosSugeridos, grado } = instalacion;

  const largoCanalizaciones = (canalizaciones || []).reduce((s, c) => s + (c.largoM || 0), 0);
  // Margen del 15% para empalmes, subidas a tablero y desperdicio de obra.
  const metrosCableCircuitos = Math.ceil(largoCanalizaciones * 1.15);

  return {
    cajasOctogonales: totalIug,
    cajasRectangulares: totalTug + totalTue,
    tapasCiegas: Math.ceil((totalIug + totalTug + totalTue) * 0.05), // repuesto/bocas de paso
    modulosToma: totalTug + totalTue,
    modulosLlave: totalIug,
    termomagneticas: circuitosSugeridos,
    diferenciales: circuitosSugeridos <= 3 ? 1 : Math.ceil(circuitosSugeridos / 4),
    tableros: 1,
    metrosCanoCorrugado: Math.ceil(largoCanalizaciones),
    metrosCableCircuitos: `${metrosCableCircuitos} m (aprox., por circuito según su sección)`,
    metrosCableRamal: '— (definir según distancia medidor-tablero)',
    seccionRamalMm2: seccionRamalMm2 || grado.seccionRamalMm2,
  };
}
