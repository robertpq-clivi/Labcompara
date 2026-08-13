/**
 * Medcompara — Lectura de la presentación de un medicamento
 * ----------------------------------------------------------
 * En la vertical de laboratorio se compara "el mismo estudio"; en la de GLP-1,
 * "la misma dosis". Aquí hay que comparar **la misma caja**, porque el mismo
 * principio activo se vende en presentaciones que no son intercambiables:
 *
 *   Omeprazol 20 mg ·   7 cápsulas   $54    →  $7.71 por cápsula
 *   Omeprazol 20 mg · 120 cápsulas   $161   →  $1.34 por cápsula
 *
 * 5.7x de diferencia dentro de la MISMA farmacia. Comparar "el más barato" de
 * cada una sería comparar una caja de 7 contra una de 120.
 *
 * De cada título se extrae { sustancia, mg, forma, piezas } y esa tupla es la
 * llave: solo se comparan filas donde la llave coincide entre farmacias.
 */

'use strict';

/** Formas farmacéuticas, normalizadas al singular. */
const FORMAS = [
  [/\bc[aá]psulas?\b/i, 'cápsulas'],
  [/\btabletas?\b/i, 'tabletas'],
  [/\bcomprimidos?\b/i, 'tabletas'],
  [/\bgrageas?\b/i, 'tabletas'],
  [/\bsobres?\b/i, 'sobres'],
  [/\bampolletas?\b|\bampollas?\b/i, 'ampolletas'],
  [/\bjarabe\b/i, 'jarabe'],
  [/\bsuspensi[oó]n\b/i, 'suspensión'],
  [/\bsoluci[oó]n\s+inyectable\b/i, 'inyectable'],
  [/\bgotas?\b/i, 'gotas'],
  [/\bcrema\b/i, 'crema'],
  [/\bungüento\b|\bunguento\b|\bpomada\b/i, 'ungüento'],
  [/\b[oó]vulos?\b/i, 'óvulos'],
  [/\bsupositorios?\b/i, 'supositorios'],
  [/\bparche?s?\b/i, 'parches'],
  [/\bspray\b|\baerosol\b/i, 'spray'],
];

/**
 * Combinaciones: si el título trae un segundo principio activo, NO es el
 * medicamento simple que se buscó. "Paracetamol + Tramadol" no es paracetamol
 * —de hecho es un controlado—, y "Vildagliptina Metformina 50/850" no es
 * metformina: es un antidiabético de marca que cuesta el doble.
 */
const CONJUNCION_ACTIVOS = /\s+(?:\+|\/|\by\b|\bcon\b)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{4,})/;

/**
 * Doble dosis: "50 mg / 850 mg", "50/1000 Mg", "325 mg / 37.5 mg".
 *
 * Es la firma más confiable de una combinación, y la que faltaba. La primera
 * versión solo buscaba un segundo activo DESPUÉS de una conjunción, así que
 * "Vildagliptina Metformina 50 mg/850 mg" pasaba como metformina de 50 mg —una
 * presentación que ni siquiera existe— y terminaba comparándose contra
 * metformina pura, que cuesta la mitad.
 */
const DOBLE_DOSIS = /(\d+(?:[.,]\d+)?)\s*(?:mg)?\s*\/\s*(\d+(?:[.,]\d+)?)\s*mg\b/i;

/**
 * Un segundo principio activo nombrado, aunque no haya conjunción ni doble
 * dosis: "Vildagliptina Metformina", "Sitagliptina, Metformina".
 * La lista sale del propio catálogo, así que crece con él.
 */
let OTROS_ACTIVOS = null;
function otrosActivos() {
  if (OTROS_ACTIVOS) return OTROS_ACTIVOS;
  let cat = { medicamentos: [] };
  try { cat = require('../verticales/medicinas-catalogo.json'); } catch { /* opcional */ }
  OTROS_ACTIVOS = cat.medicamentos.map((m) => limpiar(m.nombre)).filter((x) => x.length > 5);
  return OTROS_ACTIVOS;
}

const limpiar = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

/** "20 Mg", "20mg", "0.5 g" → miligramos como número. */
function dosisMg(titulo) {
  const g = titulo.match(/(\d+(?:[.,]\d+)?)\s*g\b(?!\/)/i);
  const mg = titulo.match(/(\d+(?:[.,]\d+)?)\s*mg\b/i);
  const mcg = titulo.match(/(\d+(?:[.,]\d+)?)\s*(?:mcg|µg)\b/i);
  if (mg) return Number(mg[1].replace(',', '.'));
  if (mcg) return Number(mcg[1].replace(',', '.')) / 1000;
  if (g) return Number(g[1].replace(',', '.')) * 1000;
  return null;
}

/** "Con 14 Cápsulas", "caja 20 tabletas", "30 Tabs" → 14 / 20 / 30. */
function piezas(titulo) {
  const m = titulo.match(
    /(?:con|caja|c\/|x)?\s*(\d{1,3})\s*(?:c[aá]psulas?|tabletas?|comprimidos?|grageas?|tabs?|sobres?|ampolletas?|[oó]vulos?|supositorios?|parches?|piezas?|pzas?)\b/i
  );
  return m ? Number(m[1]) : null;
}

function forma(titulo) {
  for (const [re, nombre] of FORMAS) if (re.test(titulo)) return nombre;
  return null;
}

/** Mililitros, para jarabes y suspensiones donde las "piezas" no aplican. */
function mililitros(titulo) {
  const m = titulo.match(/(\d+(?:[.,]\d+)?)\s*ml\b/i);
  return m ? Number(m[1].replace(',', '.')) : null;
}

/**
 * Lee la presentación de un título de producto.
 * @param {string} titulo
 * @param {string} sustancia principio activo que se buscó
 * @returns {{mg:number|null, forma:string|null, piezas:number|null, ml:number|null,
 *            combinado:string|null, clave:string|null}}
 */
function leer(titulo, sustancia) {
  const t = String(titulo || '');
  const sl = limpiar(sustancia);

  // El título debe mencionar la sustancia buscada.
  if (sl && !limpiar(t).includes(sl)) {
    return { mg: null, forma: null, piezas: null, ml: null, combinado: null, clave: null, motivo: 'no menciona la sustancia' };
  }

  // Combinación con otro activo → no es el medicamento simple.
  const comb = t.match(CONJUNCION_ACTIVOS);
  let combinado = comb && limpiar(comb[1]) !== sl ? comb[1] : null;

  // Doble dosis: la firma más confiable de una combinación.
  if (!combinado && DOBLE_DOSIS.test(t)) combinado = 'doble dosis';

  // Otro principio activo del catálogo nombrado en el título.
  if (!combinado) {
    const tl = limpiar(t);
    const otro = otrosActivos().find((a) => a !== sl && tl.includes(a));
    if (otro) combinado = otro;
  }

  const mg = dosisMg(t);
  const f = forma(t);
  const n = piezas(t);
  const ml = mililitros(t);

  // La llave necesita dosis y (piezas o ml) para que dos farmacias comparen lo
  // mismo. Sin eso la fila no se publica: es preferible un hueco a un precio
  // que no corresponde.
  let clave = null;
  if (!combinado && mg !== null) {
    if (n !== null && f) clave = `${sl}|${mg}mg|${f}|${n}`;
    else if (ml !== null) clave = `${sl}|${mg}mg|líquido|${ml}ml`;
  }
  return { mg, forma: f, piezas: n, ml, combinado, clave };
}

/** Etiqueta legible de una llave, para mostrar en la tabla. */
function etiqueta(clave) {
  if (!clave) return '';
  const [sust, mg, f, n] = clave.split('|');
  const nombre = sust.charAt(0).toUpperCase() + sust.slice(1);
  return f === 'líquido' ? `${nombre} ${mg} · ${n}` : `${nombre} ${mg} · ${n} ${f}`;
}

module.exports = { leer, etiqueta, dosisMg, piezas, forma, mililitros, limpiar };
