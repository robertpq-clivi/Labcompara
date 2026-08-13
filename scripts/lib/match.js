/**
 * Medcompara — Normalización y emparejamiento de nombres de estudio
 * ------------------------------------------------------------------
 * Cada laboratorio nombra el mismo estudio distinto:
 *   "Biometría Hemática" · "BIOMETRIA HEMATICA" · "Biometria Hematica (BH)"
 *   "Química Sanguínea 6 Elementos" · "QUIMICA SANGUINEA DE 6 ELEMENTOS"
 *
 * Estrategia en 3 pasos, de más estricta a más laxa:
 *   1. clave normalizada exacta (acentos, mayúsculas, puntuación, sinónimos)
 *   2. alias declarados a mano en ALIASES
 *   3. similitud de conjunto de tokens (Jaccard ponderado) sobre un umbral
 *
 * Lo que no llega al umbral NO se inventa: se reporta como "sin match" para
 * revisión manual. Es preferible un hueco a un precio equivocado.
 */

'use strict';

/** Palabras que no aportan a la identidad del estudio. */
const STOPWORDS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'en', 'y', 'o', 'con', 'sin', 'para',
  'por', 'a', 'al', 'un', 'una', 'estudio', 'examen', 'prueba', 'determinacion',
  'cuantificacion', 'analisis', 'test',
  // "en suero" / "en sangre" / "sérico" es la matriz por defecto en el nombrado
  // mexicano: Chopo la escribe siempre y los demás casi nunca. Como ruido puro,
  // se descarta. Las matrices que SÍ cambian el estudio (orina, heces, LCR…)
  // están en CALIFICADORES.
  'suero', 'sangre', 'plasma', 'serico', 'serica', 'sericos', 'sericas', 'sanguineo',
]);

/**
 * Calificadores: palabras que, si aparecen en UN solo lado, significan que son
 * estudios distintos aunque el resto del nombre coincida.
 *
 * "TSH" ≠ "TSH Neonatal" · "Proteína C Reactiva" ≠ "Proteína C Reactiva Ultra
 * sensible" · "Calcio sérico" ≠ "Calcio en orina" · "Hemocultivo" ≠
 * "Hemocultivo anaerobio". Sin esta guarda, la contención los une a todos.
 */
const CALIFICADORES = new Set([
  // población / contexto
  'neonatal', 'pediatrico', 'infantil', 'materno', 'gestacional', 'prenupcial', 'deportivo', 'sexual',
  'femenino', 'masculino',
  // sensibilidad / método
  'ultra', 'ultrasensible', 'sensible', 'sensibilidad', 'hs', 'cualitativo', 'cuantitativo',
  'dilucion', 'extra',
  // "NICOTINA EN ORINA" ($2,970, cromatografía) ≠ "NICOTINA EN ORINA PRUEBA
  // RÁPIDA" ($193, tira reactiva). El método cambia el precio por 15x.
  'rapida', 'rapido', 'correccion', 'diluciones',
  'inmunologico', 'inmunologica', 'automatizado', 'confirmatorio', 'reflejo',
  // fracción / derivado
  'libre', 'total', 'fraccionado', 'directo', 'indirecto', 'ionizado',
  'hdl', 'ldl', 'vldl', 'sulfato', 'depuracion', 'isoenzimas',
  // paquete vs estudio suelto: "Perfil Antidoping" ≠ "Prueba Antidoping"
  'perfil',
  // momento de la toma
  'vespertino', 'matutino',
  // cultivo
  'anaerobio', 'aerobio',
  // amplitud del paquete
  'basico', 'completo', 'especial', 'ampliado', 'express', 'plus', 'premium', 'avanzado',
  // condiciones de toma
  'postprandial', 'ayuno', 'curva', 'horas', 'hrs', 'pre', 'post',
  // matriz de la muestra que sí cambia el estudio. "Adenosín deaminasa" cuesta
  // $5,314 y "…en Líquido Peritoneal" $1,099: no son intercambiables.
  'orina', 'urinario', 'urinaria', 'urinarias', 'heces', 'saliva', 'capilar',
  'lcr', 'liquido', 'liq', 'peritoneal', 'pleural', 'sinovial', 'amniotico',
  'ascitico', 'esputo', 'expectoracion', 'semen', 'sudor',
  // organismo buscado: un cultivo de hongos no es un cultivo bacteriano
  'hongos', 'micologico', 'mycobacterium', 'micobacteria', 'bacteriologico', 'viral',
]);

/** Sinónimos que se colapsan antes de comparar. */
const SINONIMOS = [
  [/\bbh\b/g, 'biometria hematica'],
  [/\bego\b/g, 'examen general de orina'],
  [/\bqs\b/g, 'quimica sanguinea'],
  [/\bquimica\b(?!\s+sanguinea)/g, 'quimica sanguinea'],
  [/\bhba1c\b|\bhb a1c\b|\ba1c\b/g, 'hemoglobina glucosilada'],
  [/\bglicosilada\b/g, 'glucosilada'],
  [/\belementos?\b/g, 'elementos'],
  [/\bel\.?\b(?=\s*\d)/g, 'elementos'],
  [/\blipidos?\b|\blipidico\b|\blipoideo\b/g, 'lipidos'],
  [/\btiroide[os]?\b/g, 'tiroideo'],
  [/\bvsg\b/g, 'velocidad de sedimentacion'],
  // OJO: NO se expande "pcr" → "proteína C reactiva". En el nombrado mexicano
  // PCR es casi siempre la técnica ("Poliomavirus BK POR PCR", "Citomegalovirus
  // por PCR-RT"), no la proteína. Expandirlo emparejaba estudios moleculares
  // caros con un reactante de fase aguda. El caso legítimo se cubre por alias.
  [/\bac\.?\b/g, 'anticuerpos'],
  [/\banti\s+/g, 'anti'],
];

/**
 * Colapsa singular/plural. Los laboratorios alternan sin criterio:
 * "CA 19-9 ANTÍGENO (MARCADOR TUMORAL)" vs "Marcadores Tumorales Páncreas".
 * Sin esto son tokens distintos y el par no cruza.
 *
 * Conservador a propósito: solo palabras largas, y nunca las que terminan en
 * -is / -us (análisis, virus) donde la "s" es parte de la raíz.
 */
function singular(w) {
  if (w.length > 5 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('s') && !/[iu]s$/.test(w)) return w.slice(0, -1);
  return w;
}

/** Quita acentos, mayúsculas, puntuación y espacios redundantes. */
function limpiar(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Clave canónica: limpieza + sinónimos + orden de tokens + sin stopwords. */
function clave(s) {
  let t = limpiar(s);
  for (const [re, rep] of SINONIMOS) t = t.replace(re, rep);
  const toks = t.split(' ').filter((w) => w && !STOPWORDS.has(w));
  return toks.sort().join(' ');
}

/**
 * Tokens significativos (sin ordenar) para similitud.
 * Se conservan los de un solo carácter: dígitos, romanos y letras sueltas son
 * justamente lo que distingue "Vitamina D" de "Vitamina A" o "Química (6)" de
 * "Química (27)". La guarda de marcadores se apoya en ellos.
 */
function tokens(s) {
  let t = limpiar(s);
  for (const [re, rep] of SINONIMOS) t = t.replace(re, rep);
  // Se descarta por la forma original Y por la singular, para que las listas de
  // STOPWORDS/CALIFICADORES sigan funcionando escritas en cualquiera de las dos.
  const out = new Set();
  for (const w of t.split(' ')) {
    if (!w || STOPWORDS.has(w)) continue;
    const sg = singular(w);
    if (STOPWORDS.has(sg)) continue;
    out.add(sg);
  }
  return out;
}

/** Números y variantes romanas: distinguen estudios que son parientes, no iguales. */
const ROMANOS = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 };

/**
 * Marcadores duros: tienen que coincidir exactamente o no hay match.
 *  - números:  "química 6" ≠ "química 27"
 *  - romanos:  "Perfil Tiroideo" ≠ "Perfil Tiroideo II"
 *  - letra+número: "Vitamina B12" ≠ "Vitamina A"; "Factor VIII" ≠ "Factor IX"
 *  - letras sueltas: "Vitamina D" ≠ "Vitamina A", "Hepatitis B antígeno S"
 *    ≠ "Hepatitis B antígeno E". Es donde más caro sale equivocarse y donde la
 *    similitud por tokens es más ciega, porque una letra pesa lo mismo que
 *    cualquier otro token.
 */
function marcadores(set, otro) {
  const toks = [...set];
  const numeros = new Set(toks.filter((t) => /^\d+$/.test(t)));
  // Iniciales del otro nombre: "Tsh (H. Estimulante…)" abrevia "Hormona", que
  // el nombre canónico escribe completa. Una letra suelta que es la inicial de
  // una palabra del otro lado es una abreviatura, no un marcador.
  const iniciales = new Set(otro ? [...otro].map((t) => t[0]) : []);

  return toks
    .filter((t) => {
      if (/^\d+$/.test(t)) return true;
      if (ROMANOS[t] !== undefined) return true;
      // Código de producto redundante: "Química de 45 elementos (Q45)" — el 45
      // ya está suelto, así que Q45 no aporta identidad.
      if (/^[a-z]\d+$/.test(t)) return !numeros.has(t.slice(1));
      if (/^[a-z]$/.test(t)) return !iniciales.has(t);
      return false;
    })
    .map((t) => (ROMANOS[t] !== undefined ? 'r' + ROMANOS[t] : t))
    .sort()
    .join(',');
}

/**
 * Similitud 0..1 entre dos nombres de estudio.
 *
 * Pesa más la *contención* que el solapamiento: "CA-125" contra
 * "ANTIGENO CA 125 --OVARIO--" comparte pocos tokens en proporción, pero todos
 * los del nombre corto están en el largo, que es la señal que importa.
 *
 * Guardas duras (devuelven 0):
 *  - los números deben coincidir: "química 6" ≠ "química 27".
 *  - las variantes romanas deben coincidir: "Perfil Tiroideo" no se convierte
 *    en "Perfil Tiroideo II" por su cuenta; eso se declara como alias a mano.
 */
const CALIF_SG = new Set([...CALIFICADORES].map(singular));
function calificadores(set) {
  return [...set].filter((t) => CALIFICADORES.has(t) || CALIF_SG.has(t)).sort().join(',');
}

/** Un panel se define por lo que incluye, no por su nombre corto. */
const MARCAS_PANEL = ['perfil', 'checkup', 'check', 'paquete', 'panel'];
const marcaPanel = (S) => MARCAS_PANEL.some((m) => S.has(m));

/**
 * Expande abreviaturas de una letra usando el otro nombre como diccionario:
 * "Tsh (H. Estimulante de Tiroides)" ↔ "TSH (Hormona Estimulante de Tiroides)".
 * Sin esto, "h" y "hormona" cuentan como dos tokens distintos y hunden el score
 * de un par que es idéntico.
 */
function alinear(A, B) {
  const out = new Set();
  for (const t of A) {
    if (/^[a-z]$/.test(t)) {
      const largo = [...B].find((u) => u.length > 1 && u[0] === t);
      out.add(largo || t);
    } else out.add(t);
  }
  return out;
}

/** Score numérico puro, sin guardas: solapamiento + contención. */
function puntuar(A, B) {
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  if (!inter) return 0;
  const menor = Math.min(A.size, B.size);
  return 0.35 * (inter / (A.size + B.size - inter)) + 0.65 * (inter / menor);
}

/**
 * Piso de plausibilidad para permitir el truco de las abreviaturas.
 * "Proteína S de Coagulación" y "Pruebas de Coagulación Sanguínea" comparten
 * una sola palabra; alinear la "S" con "sanguínea" solo porque empiezan igual
 * inventaría un match. La abreviatura puede AFINAR un par que ya es plausible,
 * nunca crearlo.
 */
const UMBRAL_ABREV = 0.5;

function similitudCruda(A0, B0) {
  if (!A0.size || !B0.size) return 0;
  if (calificadores(A0) !== calificadores(B0)) return 0;

  const permitirAbrev = puntuar(A0, B0) >= UMBRAL_ABREV;
  const dicA = permitirAbrev ? B0 : null;
  const dicB = permitirAbrev ? A0 : null;
  if (marcadores(A0, dicA) !== marcadores(B0, dicB)) return 0;

  const A = permitirAbrev ? alinear(A0, B0) : A0;
  const B = permitirAbrev ? alinear(B0, A0) : B0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  if (!inter) return 0;
  const union = A.size + B.size - inter;
  const jaccard = inter / union;
  const menor = Math.min(A.size, B.size);
  const contencion = inter / menor;

  // Un nombre de un solo token no alcanza para inferir nada: "TGO" está
  // contenido en "TGO y TGP", "Cortisol" en "Cortisol basal", "Mastografía" en
  // "Mastografía unilateral" — y ninguno es el mismo estudio. Con un token de
  // un lado se exige igualdad; lo demás se manda a revisión manual.
  if (menor === 1 && A.size !== B.size) return 0;

  // Un estudio suelto nunca es su paquete: "Química Sanguínea 45 Elementos" no
  // es "CHECK UP SALUD QUÍMICA DE 45 ELEMENTOS", aunque lo contenga.
  const panelA = marcaPanel(A), panelB = marcaPanel(B);
  if (panelA !== panelB) return 0;

  // Entre paneles NO se aplica el premio por contención: "Perfil Básico" está
  // contenido en "Perfil básico vías urinarias" y no son el mismo paquete. Se
  // exige parecido simétrico; lo que no llegue se manda a revisión manual.
  if (panelA) return jaccard;

  return 0.35 * jaccard + 0.65 * contencion;
}

/**
 * Un "X y Y" en el nombre suele señalar un estudio combinado: "ÁCIDO FÓLICO Y
 * VITAMINA B12" no es "Vitamina B12", y "DENSITOMETRÍA COLUMNA Y CADERA" no es
 * "Densitometría Cadera". Sus precios son otros.
 *
 * La comparación es simétrica a propósito: da igual de qué lado esté la
 * conjunción. La primera versión solo miraba el lado del laboratorio, y al usar
 * el emparejador para agrupar estudios ENTRE laboratorios —donde no hay un lado
 * "canónico"— el orden de los argumentos decidía si el par se fusionaba o no.
 */
const CONJUNCION = /\s+[ye]\s+/i;
const esCombinado = (a, b) => CONJUNCION.test(a) !== CONJUNCION.test(b);

/**
 * Los nombres canónicos suelen usar paréntesis para aclarar, no para
 * identificar: "CA-125 (Marcador Tumoral Ovario)", "TSH (Hormona Estimulante
 * de Tiroides)". Por eso se compara con y sin el paréntesis.
 *
 * Salvo cuando el paréntesis lleva un número: ahí SÍ identifica.
 * "Baciloscopia BAAR (5 Muestras)" cuesta $2,016 y "Baciloscopia BAAR" $426;
 * descartar el "(5 Muestras)" los volvía el mismo estudio.
 */
const PARENTESIS_CON_NUMERO = /\([^)]*\d[^)]*\)/;

function similitud(a, b) {
  if (esCombinado(a, b)) return 0;
  const B = tokens(b);
  let mejor = similitudCruda(tokens(a), B);
  if (!PARENTESIS_CON_NUMERO.test(a)) {
    const sinParentesis = String(a).replace(/\([^)]*\)/g, ' ').trim();
    if (sinParentesis && sinParentesis !== String(a).trim()) {
      mejor = Math.max(mejor, similitudCruda(tokens(sinParentesis), B));
    }
  }
  return mejor;
}

/**
 * Alias manuales: nombre canónico de Medcompara → variantes vistas en los labs.
 * Solo hace falta declarar lo que la normalización no resuelve sola.
 */
const ALIASES = {
  'Biometría Hemática': ['biometria hematica completa', 'bh completa', 'biometria hematica automatizada'],
  'Química Sanguínea 6 Elementos': ['quimica sanguinea de 6 elementos', 'qs6', 'quimica de 6 elementos'],
  'Química Sanguínea 27 Elementos': ['quimica sanguinea de 27 elementos', 'qs27', 'quimica de 27 elementos'],
  'Examen General de Orina (EGO)': ['examen general de orina', 'ego', 'orina examen general'],
  'Perfil de Lípidos': ['perfil lipidico', 'perfil de lipidos completo', 'perfil lipoideo'],
  'Perfil Tiroideo': ['perfil tiroideo completo', 'perfil de tiroides', 'perfil tiroideo basico'],
  'Hemoglobina Glicosilada (HbA1c)': ['hemoglobina glucosilada', 'hemoglobina glicosilada a1c', 'hba1c'],
  'Glucosa en Suero': ['glucosa', 'glucosa serica', 'glucosa en sangre'],
  'Insulina': ['insulina basal', 'insulina serica'],
  'Proteína C Reactiva (PCR)': ['pcr', 'proteina c reactiva cuantitativa'],
};

/** Índice invertido de alias → canónico. */
function indiceAlias() {
  const idx = new Map();
  for (const [canon, lista] of Object.entries(ALIASES)) {
    idx.set(clave(canon), canon);
    for (const a of lista) idx.set(clave(a), canon);
  }
  return idx;
}

/**
 * Empareja los scrapes de un lab contra la lista canónica.
 * @param {string[]} canonicos  nombres canónicos de Medcompara
 * @param {{nombre:string,precio:number}[]} filas  resultados del scraper
 * @param {number} umbral  similitud mínima para aceptar (0..1)
 * @returns {{ mapeo: Map<string, object>, sinMatch: object[] }}
 */
function emparejar(canonicos, filas, umbral = 0.82) {
  const alias = indiceAlias();
  const porClave = new Map();
  for (const c of canonicos) porClave.set(clave(c), c);

  const mapeo = new Map();   // canónico → mejor fila del laboratorio
  const sinMatch = [];

  /**
   * Gana el candidato con MEJOR score; el precio solo desempata.
   *
   * La primera versión elegía siempre el más barato, y eso hacía que un match
   * difuso barato le ganara a uno exacto: "Antitrombina III (Funcional)"
   * ($1,843) perdía contra "Antitrombina III (Antigénica)" ($482), y
   * "Adenosín deaminasa" ($5,314) contra "…en Líquido Peritoneal" ($1,099).
   * Elegir por parecido y desempatar por precio resuelve toda esa familia de
   * errores de un golpe, en vez de ir agregando calificadores uno por uno.
   */
  const registrar = (canon, fila, via, score) => {
    const prev = mapeo.get(canon);
    if (!prev || score > prev.score || (score === prev.score && fila.precio < prev.precio)) {
      mapeo.set(canon, { ...fila, via, score });
    }
  };

  for (const fila of filas) {
    const k = clave(fila.nombre);
    if (porClave.has(k)) { registrar(porClave.get(k), fila, 'exacto', 1); continue; }
    if (alias.has(k)) { registrar(alias.get(k), fila, 'alias', 1); continue; }

    let mejor = null, mejorScore = 0;
    for (const c of canonicos) {
      const s = similitud(c, fila.nombre);
      if (s > mejorScore) { mejorScore = s; mejor = c; }
    }
    if (mejor && mejorScore >= umbral) registrar(mejor, fila, 'similitud', +mejorScore.toFixed(3));
    else sinMatch.push(fila);
  }
  return { mapeo, sinMatch };
}

module.exports = { clave, tokens, similitud, emparejar, limpiar, ALIASES, indiceAlias };
