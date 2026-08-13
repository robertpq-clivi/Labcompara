/**
 * Labcompara — Normalización y emparejamiento de nombres de estudio
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
  // matriz de la muestra que sí cambia el estudio
  'orina', 'urinario', 'urinaria', 'urinarias', 'heces', 'saliva', 'capilar', 'lcr', 'liquido',
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
  return new Set(t.split(' ').filter((w) => w && !STOPWORDS.has(w)));
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
function marcadores(set) {
  return [...set]
    .filter((t) => /^\d+$/.test(t) || ROMANOS[t] !== undefined || /^[a-z]$/.test(t) || /^[a-z]\d+$/.test(t))
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
function calificadores(set) {
  return [...set].filter((t) => CALIFICADORES.has(t)).sort().join(',');
}

/** Un panel se define por lo que incluye, no por su nombre corto. */
const MARCAS_PANEL = ['perfil', 'checkup', 'check', 'paquete', 'panel'];
const marcaPanel = (S) => MARCAS_PANEL.some((m) => S.has(m));

function similitudCruda(A, B) {
  if (!A.size || !B.size) return 0;
  if (marcadores(A) !== marcadores(B)) return 0;
  if (calificadores(A) !== calificadores(B)) return 0;
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
 * Los nombres canónicos usan paréntesis para aclarar, no para identificar:
 * "CA-125 (Marcador Tumoral Ovario)", "Vitamina D (25-Hidroxi)".
 * Se compara con y sin el paréntesis y se toma el mejor resultado.
 */
function similitud(a, b) {
  const B = tokens(b);
  let mejor = similitudCruda(tokens(a), B);
  const sinParentesis = String(a).replace(/\([^)]*\)/g, ' ').trim();
  if (sinParentesis && sinParentesis !== String(a).trim()) {
    mejor = Math.max(mejor, similitudCruda(tokens(sinParentesis), B));
  }
  return mejor;
}

/**
 * Alias manuales: nombre canónico de Labcompara → variantes vistas en los labs.
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
 * @param {string[]} canonicos  nombres canónicos de Labcompara
 * @param {{nombre:string,precio:number}[]} filas  resultados del scraper
 * @param {number} umbral  similitud mínima para aceptar (0..1)
 * @returns {{ mapeo: Map<string, object>, sinMatch: object[] }}
 */
function emparejar(canonicos, filas, umbral = 0.82) {
  const alias = indiceAlias();
  const porClave = new Map();
  for (const c of canonicos) porClave.set(clave(c), c);

  const mapeo = new Map();   // canónico → fila (la más barata si hay empate)
  const sinMatch = [];

  const registrar = (canon, fila, via, score) => {
    const prev = mapeo.get(canon);
    if (!prev || fila.precio < prev.precio) mapeo.set(canon, { ...fila, via, score });
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
