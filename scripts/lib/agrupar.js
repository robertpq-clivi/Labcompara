/**
 * Labcompara — Agrupador de estudios entre laboratorios
 * ------------------------------------------------------
 * El emparejador de match.js resuelve "¿este nombre de lab es este estudio de
 * Labcompara?" — necesita una lista canónica previa. Aquí el problema es el
 * inverso y más difícil: **descubrir** qué estudios existen, agrupando 8,265
 * nombres de seis laboratorios sin lista de referencia.
 *
 * Estrategia:
 *   1. Cada laboratorio aporta como mucho un candidato por clave normalizada
 *      (si un lab lista el mismo estudio dos veces, gana el más barato).
 *   2. Los grupos se siembran con el laboratorio de catálogo más grande y se
 *      van fusionando por clave exacta y luego por similitud.
 *   3. Solo sobreviven los grupos con presencia en `minLabs` laboratorios: un
 *      estudio que solo ofrece uno no es comparable, y el sitio es un
 *      comparador, no un catálogo.
 *
 * El nombre que se publica es el del grupo más legible (Title Case, no
 * MAYÚSCULAS), porque los laboratorios escriben en formatos distintos.
 */

'use strict';

const { clave, similitud } = require('./match');

/** Un nombre TODO EN MAYÚSCULAS es menos legible que uno en Title Case. */
function legibilidad(nombre) {
  const letras = nombre.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '');
  if (!letras) return 0;
  const minus = (letras.match(/[a-záéíóúñ]/g) || []).length / letras.length;
  // Se premia tener minúsculas y se penalizan los nombres muy largos o con
  // muletillas de catálogo interno.
  const ruido = /--|\^|\bMUESTRA BIOLOGICA\b|\bEN SUERO\b/i.test(nombre) ? 0.3 : 0;
  return minus - ruido - Math.min(nombre.length / 400, 0.25);
}

/**
 * Siglas y unidades que deben quedarse en mayúsculas al normalizar el título.
 * Sin esta lista, "HLA - B27" se convertiría en "Hla - B27".
 */
const SIGLAS = new Set(('AC ADN ALP ALT AST ATP BUN CA CEA CK CKMB CMV COVID CPK CRP DHEA DHL DNA DPD ' +
  'EBV EGO ELISA FSH GGT HBSAG HBEAG HCG HCV HDL HIV HLA HPV IGA IGE IGG IGM IHQ LDH LDL LH ' +
  'PAPP PCR PSA PTH RH RNA RX SCL TGO TGP TP TSH TTP T3 T4 VDRL VHB VHC VIH VLDL VSG')
  .split(' '));

const MINUSCULAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'en', 'y', 'e', 'o', 'con', 'sin', 'por', 'para', 'a', 'al']);

/**
 * Pasa un nombre GRITADO a Title Case. Solo se aplica cuando el nombre ya viene
 * casi todo en mayúsculas: los laboratorios que escriben bien no se tocan.
 */
function aTitulo(nombre) {
  const capitalizar = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  return nombre
    .split(/(\s+)/)
    .map((palabra, i) => {
      if (/^\s+$/.test(palabra)) return palabra;
      // Una palabra que YA mezcla mayúsculas y minúsculas viene escrita a
      // propósito (HBeAg, IgG, pH): no se toca.
      if (/[a-záéíóúñ]/.test(palabra) && /[A-ZÁÉÍÓÚÑ]/.test(palabra)) return palabra;
      const limpio = palabra.replace(/[^A-Za-zÁÉÍÓÚÑ0-9]/gi, '');
      if (SIGLAS.has(limpio.toUpperCase())) return palabra.toUpperCase();
      if (/\d/.test(palabra)) return palabra.toUpperCase();      // B27, CA 19-9, 17-OHP
      const bajo = palabra.toLowerCase();
      if (i > 0 && MINUSCULAS.has(bajo)) return bajo;
      // Capitaliza también después de guion: "anti-histoplasma" → "Anti-Histoplasma".
      return bajo.split('-').map(capitalizar).join('-');
    })
    .join('');
}

/** Proporción de minúsculas entre las letras del nombre. */
function proporcionMinusculas(nombre) {
  const letras = nombre.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '');
  if (!letras.length) return 1;
  return (letras.match(/[a-záéíóúñ]/g) || []).length / letras.length;
}

/**
 * Título más presentable de un grupo. Si ni la mejor variante está bien escrita
 * —los seis laboratorios gritando— se normaliza, porque un catálogo donde unas
 * filas van en MAYÚSCULAS y otras no se ve roto.
 */
function mejorNombre(variantes) {
  const mejor = variantes.slice().sort((a, b) => legibilidad(b) - legibilidad(a))[0];
  return proporcionMinusculas(mejor) < 0.3 ? aTitulo(mejor) : mejor;
}

/**
 * @param {Record<string, Array<{nombre:string,precio:number,url:string}>>} porLab
 * @param {object} opts
 * @param {number} [opts.minLabs=3]   laboratorios mínimos para publicar
 * @param {number} [opts.umbral=0.86] similitud para fusionar entre labs
 * @returns {Array<{nombre:string, variantes:object, labs:number}>}
 */
function agrupar(porLab, opts = {}) {
  const minLabs = opts.minLabs ?? 3;
  const umbral = opts.umbral ?? 0.86;

  // 1. Un candidato por lab y por clave (el más barato si hay duplicados).
  const porLabDedup = {};
  for (const [lab, filas] of Object.entries(porLab)) {
    const m = new Map();
    for (const f of filas) {
      if (!f.nombre || !f.precio) continue;
      const k = clave(f.nombre);
      if (!k) continue;
      const prev = m.get(k);
      if (!prev || f.precio < prev.precio) m.set(k, f);
    }
    porLabDedup[lab] = m;
  }

  // 2. Sembrar con el catálogo más grande y fusionar el resto.
  const labs = Object.keys(porLabDedup).sort((a, b) => porLabDedup[b].size - porLabDedup[a].size);
  const grupos = [];          // { claves:Set, variantes:{lab:fila} }
  const porClave = new Map(); // clave → grupo (búsqueda O(1) del camino rápido)

  for (const lab of labs) {
    for (const [k, fila] of porLabDedup[lab]) {
      let g = porClave.get(k);

      if (!g) {
        // Camino lento: comparar contra los grupos ya existentes. Se limita a
        // los que comparten al menos un token para no hacer O(n²) sobre 8,265.
        g = buscarPorSimilitud(grupos, fila.nombre, umbral, lab);
      }

      if (g) {
        if (!g.variantes[lab]) g.variantes[lab] = fila;
        g.claves.add(k);
        porClave.set(k, g);
      } else {
        const nuevo = { claves: new Set([k]), variantes: { [lab]: fila } };
        grupos.push(nuevo);
        porClave.set(k, nuevo);
        indexar(nuevo, fila.nombre);
      }
    }
  }

  return grupos
    .map((g) => ({
      nombre: mejorNombre(Object.values(g.variantes).map((v) => v.nombre)),
      variantes: g.variantes,
      labs: Object.keys(g.variantes).length,
    }))
    .filter((g) => g.labs >= minLabs)
    .sort((a, b) => b.labs - a.labs || a.nombre.localeCompare(b.nombre, 'es'));
}

// ── índice invertido por token, para acotar las comparaciones ────────────────
const indice = new Map();

function tokensDe(nombre) {
  return clave(nombre).split(' ').filter(Boolean);
}

function indexar(grupo, nombre) {
  for (const t of tokensDe(nombre)) {
    if (!indice.has(t)) indice.set(t, []);
    indice.get(t).push(grupo);
  }
}

function buscarPorSimilitud(grupos, nombre, umbral, lab) {
  const toks = tokensDe(nombre);
  if (!toks.length) return null;
  // Candidatos: grupos que comparten el token más raro (el de menor lista).
  const listas = toks.map((t) => indice.get(t) || []).filter((l) => l.length);
  if (!listas.length) return null;
  const candidatos = listas.reduce((a, b) => (a.length <= b.length ? a : b));

  let mejor = null, mejorScore = 0;
  for (const g of candidatos) {
    if (g.variantes[lab]) continue;               // ese lab ya está en el grupo
    for (const v of Object.values(g.variantes)) {
      const s = similitud(v.nombre, nombre);
      if (s > mejorScore) { mejorScore = s; mejor = g; }
    }
  }
  if (mejor && mejorScore >= umbral) {
    indexar(mejor, nombre);
    return mejor;
  }
  return null;
}

module.exports = { agrupar, mejorNombre, legibilidad };
