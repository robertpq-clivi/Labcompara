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
  [/\bc[aá]psulas?\b|\bcaps?\b/i, 'cápsulas'],   // Ahorro abrevia: "30 Caps"
  [/\btabletas?\b|\btabs?\b/i, 'tabletas'],      // y "24 Tabs"
  [/\bcomprimidos?\b/i, 'tabletas'],
  [/\bgrageas?\b|\bgrag\b/i, 'tabletas'],
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

/**
 * "Con 14 Cápsulas", "caja 20 tabletas", "30 Tabs" → 14 / 20 / 30.
 *
 * Las abreviaturas importan más de lo que parece: en una sola corrida hay 686
 * "tabs", 176 "caps" y 20 "pz". Sin ellas, "Inhibitron 20 mg Oral 30 Caps" no
 * tenía número de piezas, se quedaba sin llave y su marca no era buscable — y
 * eso son 18 productos de un solo medicamento.
 */
function piezas(titulo) {
  const m = titulo.match(
    /(?:con|caja|c\/|x)?\s*(\d{1,3})\s*(?:c[aá]psulas?|caps?|tabletas?|tabs?|comprimidos?|comp|grageas?|grag|sobres?|ampolletas?|[oó]vulos?|supositorios?|parches?|piezas?|pzas?|pz)\b/i
  );
  return m ? Number(m[1]) : null;
}

function forma(titulo) {
  for (const [re, nombre] of FORMAS) if (re.test(titulo)) return nombre;
  return null;
}

/**
 * Mililitros del envase, para jarabes y suspensiones donde las "piezas" no
 * aplican.
 *
 * El primer "N ml" de un título suele ser la CONCENTRACIÓN y no el envase:
 * en "Febraxito 100 mg / 1 ml Paracetamol 30 ml Gotas" el frasco es de 30 ml
 * y el "1 ml" es el denominador de la dosis. Tomar el primero daba una
 * presentación de 1 ml que no existe, y peor: dos frascos de distinto tamaño
 * caían en la misma fila porque los dos decían "1 ml".
 *
 * Se descartan los ml que vienen inmediatamente después de una dosis, y de lo
 * que queda se toma el mayor: el envase siempre es más grande que su medida.
 */
function mililitros(titulo) {
  const t = String(titulo || '');
  const concentracion = /\d+(?:[.,]\d+)?\s*(?:mg|g|mcg|µg|ui)\s*\/\s*$/i;
  const vals = [];
  for (const m of t.matchAll(/(\d+(?:[.,]\d+)?)\s*ml\b/gi)) {
    if (concentracion.test(t.slice(0, m.index))) continue;
    vals.push(Number(m[1].replace(',', '.')));
  }
  return vals.length ? Math.max(...vals) : null;
}

/**
 * Los ml solo sirven como unidad de comparación en líquidos que se toman o se
 * aplican a granel. En un inyectable, los ml son el volumen del dispositivo:
 * comparar "3 ml" contra "3 ml" pondría una pluma precargada frente a un
 * frasco ámpula, que es exactamente el error que ya costó una corrección en la
 * vertical de GLP-1. Aquí se corta antes de que pueda repetirse.
 */
const LIQUIDO_A_GRANEL = /\b(jarabe|suspensi[oó]n|soluci[oó]n\s+(?:oral|[oó]tica|oftálmica|nasal)|gotas|elixir|lo[cs]i[oó]n|champ[uú]|shampoo)\b/i;
const DISPOSITIVO = /\b(pluma|kwikpen|flexpen|solostar|pen\b|cartucho|jeringa|autoinyector|frasco\s*[aá]mpula|vial|[aá]mpula|inyectable)\b/i;

/**
 * Palabras que aparecen en los títulos y no son marca: formas, vías, unidades,
 * envases, público al que va dirigido y el relleno de cada farmacia.
 */
const NO_ES_MARCA = new Set([
  'caja', 'con', 'del', 'oral', 'para', 'sin', 'por', 'sabor', 'pack', 'duopack',
  'tabletas', 'tableta', 'capsulas', 'capsula', 'comprimidos', 'comprimido',
  'grageas', 'sobres', 'sobre', 'ampolletas', 'ampolleta', 'ampula', 'frasco',
  'jarabe', 'suspension', 'solucion', 'gotas', 'crema', 'unguento', 'pomada',
  'ovulos', 'supositorios', 'parches', 'spray', 'aerosol', 'inyectable', 'polvo',
  'adultos', 'adulto', 'infantil', 'pediatrica', 'pediatrico', 'ninos', 'junior',
  'masticables', 'recubiertas', 'liberacion', 'prolongada', 'retard', 'forte',
  'marca', 'generico', 'medicamento', 'tratamiento', 'unidades', 'piezas',
  'hrs', 'horas', 'mg', 'ml', 'gr', 'mcg', 'ui',
]);

/**
 * Marca comercial del producto, o `null` si es genérico.
 *
 * Se toma la primera palabra "de verdad" del título: la primera que no sea un
 * número, una unidad, una forma farmacéutica ni el principio activo. Las
 * farmacias titulan igual —"Tempra 500 mg Adultos Paracetamol caja 20
 * tabletas", "Dimefor 850 Mg Caja Con 30 Tabletas (Metformina)"—: la marca va
 * al frente y el activo después. Cuando lo primero que aparece es el activo,
 * no hay marca que reportar y el producto es genérico.
 *
 * La marca de farmacia ("Marca del Ahorro") cuenta como genérico, que es lo que
 * es: su propia línea de sustitutos.
 */
function marca(titulo, med) {
  const entrada = typeof med === 'string' ? { nombre: med } : (med || {});
  const raices = entrada.raices || [entrada.raiz || raizDe(entrada.nombre || '')];
  // El paréntesis final suele traer el activo —"(Metformina)"— y nunca la marca.
  const t = limpiar(String(titulo || '').replace(/\([^)]*\)\s*$/, ''));
  for (const palabra of t.split(/[^a-z0-9áéíóúñ]+/i)) {
    if (palabra.length < 3) continue;                      // "g", "mg", ruido
    if (/^\d/.test(palabra)) continue;                     // dosis y cantidades
    if (NO_ES_MARCA.has(palabra)) continue;
    if (raices.some((r) => r && palabra.startsWith(r))) return null;  // es el activo
    if (otrosActivos().some((a) => palabra.startsWith(a.split(' ')[0]))) return null;
    return palabra.charAt(0).toUpperCase() + palabra.slice(1);
  }
  return null;
}

/**
 * Raíz con la que se reconoce un activo dentro de un título: la palabra más
 * larga de su nombre. El catálogo la trae calculada; para una sustancia suelta
 * (los tests, o una llamada a mano) se deriva aquí.
 */
function raizDe(nombre) {
  const p = limpiar(nombre).split(/[\s/]+/).filter((x) => x.length > 3 && x !== 'acido');
  return p.sort((a, b) => b.length - a.length)[0] || limpiar(nombre);
}

/**
 * Busca una raíz con frontera de palabra SOLO al inicio.
 *
 * El final de un nombre de fármaco varía —"clavulánico" y "clavulanato" son el
 * mismo activo— pero el principio no, y esa frontera inicial es justo lo que
 * impide que "Esomeprazol 40 mg" pase por omeprazol: son moléculas distintas
 * con precios distintos.
 */
const escapar = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tieneRaiz = (tl, r) => new RegExp('\\b' + escapar(r)).test(tl);

/**
 * Una marca, en cambio, se busca completa.
 *
 * Un nombre químico se deforma al final —clavulánico, clavulanato— pero una
 * marca se escribe tal cual, y con prefijo "Tempra" se comería "Temprafen",
 * que es otro medicamento con otro principio activo.
 */
const tieneMarca = (tl, m) => new RegExp('\\b' + escapar(limpiar(m)) + '\\b').test(tl);

/**
 * Lee la presentación de un título de producto.
 *
 * @param {string} titulo
 * @param {string|object} med principio activo buscado: el nombre, o la entrada
 *   del catálogo, que además puede traer `raiz`, `tambien` (marcas
 *   comerciales) y `activos`/`raices` si el producto es un combinado.
 * @returns {{mg:number|null, forma:string|null, piezas:number|null, ml:number|null,
 *            combinado:string|null, clave:string|null}}
 */
function leer(titulo, med) {
  const t = String(titulo || '');
  const tl = limpiar(t);
  const entrada = typeof med === 'string' ? { nombre: med } : (med || {});
  const sl = limpiar(entrada.nombre);
  const vacio = { mg: null, forma: null, piezas: null, ml: null, combinado: null, clave: null };

  // ── ¿el título es de lo que se buscó? ──────────────────────────────────
  if (entrada.activos) {
    // Un combinado declarado: aquí la combinación ES lo buscado, así que se
    // exigen los dos activos en vez de rechazarla. Faltando uno, el título es
    // de otro producto —casi siempre el simple, que cuesta la mitad—.
    const raices = entrada.raices || entrada.activos.map(raizDe);
    if (!raices.every((r) => tieneRaiz(tl, r))) {
      return { ...vacio, motivo: 'no menciona la sustancia' };
    }
  } else if (sl) {
    const r = entrada.raiz || raizDe(entrada.nombre);
    // Media farmacia titula por marca y no por activo: "Tempra 160 Mg 30
    // Tabletas" no dice paracetamol en ninguna parte. Sin aceptar la marca,
    // esas cajas no se emparejarían con su genérico, que es justo la
    // comparación que la página existe para mostrar.
    const marcas = [...(entrada.tambien || '').split(/\s*[/,]\s*/), ...(entrada.sinonimos || [])]
      .map((s) => String(s).trim()).filter(Boolean);
    if (!tieneRaiz(tl, r) && !marcas.some((m) => tieneMarca(tl, m))) {
      return { ...vacio, motivo: 'no menciona la sustancia' };
    }
  }

  // ── ¿trae un activo que no se buscó? ───────────────────────────────────
  let combinado = null;
  if (!entrada.activos) {
    const comb = t.match(CONJUNCION_ACTIVOS);
    combinado = comb && limpiar(comb[1]) !== sl ? comb[1] : null;

    // Doble dosis: la firma más confiable de una combinación.
    if (!combinado && DOBLE_DOSIS.test(t)) combinado = 'doble dosis';

    // Otro principio activo del catálogo nombrado en el título.
    if (!combinado) {
      const otro = otrosActivos().find((a) => a !== sl && tl.includes(a));
      if (otro) combinado = otro;
    }
  }

  const mg = dosisMg(t);
  const f = forma(t);
  const n = piezas(t);
  const ml = mililitros(t);

  // En un combinado la dosis es el par: "875/125 mg". Publicar solo la primera
  // haría que 875/125 y 875/62.5 —cajas distintas, precios distintos— cayeran
  // en la misma fila.
  const par = entrada.activos && t.match(DOBLE_DOSIS);
  const dosis = par ? `${Number(par[1].replace(',', '.'))}/${Number(par[2].replace(',', '.'))}` : mg;

  // La llave necesita dosis y (piezas o ml) para que dos farmacias comparen lo
  // mismo. Sin eso la fila no se publica: es preferible un hueco a un precio
  // que no corresponde.
  const canon = entrada.activos ? entrada.activos.map(limpiar).join('+') : sl;
  let clave = null;
  if (!combinado && dosis !== null) {
    if (n !== null && f) clave = `${canon}|${dosis}mg|${f}|${n}`;
    else if (ml !== null && LIQUIDO_A_GRANEL.test(t) && !DISPOSITIVO.test(t)) {
      clave = `${canon}|${dosis}mg|líquido|${ml}ml`;
    }
  }
  return { mg, forma: f, piezas: n, ml, combinado, clave, marca: clave ? marca(t, entrada) : null };
}

/** Etiqueta legible de una llave, para mostrar en la tabla. */
function etiqueta(clave) {
  if (!clave) return '';
  const [sust, mg, f, n] = clave.split('|');
  const nombre = sust.charAt(0).toUpperCase() + sust.slice(1);
  return f === 'líquido' ? `${nombre} ${mg} · ${n}` : `${nombre} ${mg} · ${n} ${f}`;
}

module.exports = { leer, etiqueta, marca, dosisMg, piezas, forma, mililitros, limpiar };
