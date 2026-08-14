#!/usr/bin/env node
/**
 * Medcompara — Construye el catálogo de medicinas desde la hoja de cálculo
 * -------------------------------------------------------------------------
 * La lista de "los medicamentos más buscados en México" vive en un Google
 * Sheet que crece: empezó en 100 y ya va en 200. Convertirla a mano una vez
 * está bien; dos veces ya es una fuente de errores silenciosos, porque lo que
 * se rompe no es el JSON sino el *significado* de un nombre.
 *
 *   node scripts/construir-catalogo-medicinas.js            # reporta, no escribe
 *   node scripts/construir-catalogo-medicinas.js --apply
 *   node scripts/construir-catalogo-medicinas.js --csv=otra.csv
 *
 * Lee data/medicinas/hoja-origen.csv (el export tal cual de la hoja) y escribe
 * scripts/verticales/medicinas-catalogo.json.
 *
 * El trabajo real no es parsear el CSV: es que la columna "Medicamento
 * (Principio Activo)" mezcla cinco cosas distintas bajo la misma forma, y
 * confundirlas hace que la farmacia devuelva otra cosa o que no devuelva nada:
 *
 *   Etoricoxib (Arcoxia)                  principio activo + marca comercial
 *   Valproato de sodio / Ácido valproico  dos nombres del mismo fármaco
 *   Finasterida / Dutasterida             dos fármacos distintos en una fila
 *   Levodopa con Carbidopa                un solo producto con dos activos
 *   Dexametasona oftálmica                el mismo activo por otra vía
 *
 * Las tres primeras no se distinguen entre sí por la forma del texto —las tres
 * son "A / B" o "A (B)"—, así que van en una tabla explícita. Adivinar aquí
 * sería adivinar en silencio.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CSV = path.join(ROOT, 'data', 'medicinas', 'hoja-origen.csv');
const SALIDA = path.join(ROOT, 'scripts', 'verticales', 'medicinas-catalogo.json');

const argv = process.argv.slice(2);
const APLICAR = argv.includes('--apply');
const RUTA_CSV = (argv.find((a) => a.startsWith('--csv=')) || '').slice(6) || CSV;

// ── 1. Casos que la forma del texto no distingue ────────────────────────────

/**
 * "A / B" donde A y B son el MISMO fármaco. Se publica uno y el otro queda
 * como sinónimo, para que un título que use cualquiera de los dos nombres
 * caiga en la misma fila.
 */
const SINONIMOS = {
  'Valproato de sodio / Ácido valproico': { nombre: 'Ácido valproico', tambien: 'Valproato de sodio' },
};

/**
 * "A / B" donde A y B son fármacos DISTINTOS que la hoja juntó en una fila
 * porque se recetan para lo mismo. Se separan: son dos comparaciones, y
 * mezclarlas publicaría el precio de uno bajo el nombre del otro.
 */
const SEPARAR = {
  'Finasterida / Dutasterida': ['Finasterida', 'Dutasterida'],
};

/**
 * Un solo producto con dos principios activos. No son "combinaciones a
 * descartar" como Vildagliptina/Metformina —esas se cuelan en la búsqueda de
 * un activo simple—: aquí la combinación *es* lo que se buscó, así que el
 * lector tiene que exigir los dos activos en el título en vez de rechazarlo.
 */
const COMBINADOS = {
  'Trimetoprima / Sulfametoxazol': ['Trimetoprima', 'Sulfametoxazol'],
  'Etinilestradiol / Desogestrel': ['Etinilestradiol', 'Desogestrel'],
};

/**
 * Marcas que la hoja no anotó y que sí conocemos.
 *
 * La hoja apunta "Semaglutida (Ozempic / Rybelsus)" y se olvida de Wegovy,
 * que es la misma molécula en la dosis de control de peso — lo dice nuestra
 * propia página de GLP-1. Sin la marca en el catálogo, quien busca "wegovy"
 * en el comparador de medicinas no encuentra nada aunque el precio esté ahí.
 *
 * Solo se agregan equivalencias que este repositorio ya afirma en otro lado;
 * no se inventan.
 */
const MARCAS_EXTRA = {
  Semaglutida: ['Wegovy'],   // pages/medicamentos.html: "Wegovy contiene semaglutida"
};

/**
 * Raíces con las que se reconoce un activo en un título. Por omisión se usa la
 * palabra más larga del nombre, que casi siempre basta; estas son las que no.
 */
const RAICES = {
  'Ácido clavulánico': 'clavulan',   // los títulos dicen clavulánico o clavulanato
  'Ác. Clavulánico': 'clavulan',
  'Senósidos A-B': 'senosid',        // senósidos, senosidos, sennosidos
  'Insulina Glargina': 'glargina',   // "insulina" sola no distingue nada
  'Subsalicilato de bismuto': 'bismuto',
  'Bromuro de pinaverio': 'pinaverio',
  'Bromuro de ipratropio': 'ipratropio',
  'Clonixinato de lisina': 'clonixinato',
  'Picosulfato de sodio': 'picosulfato',
  'Trimetoprima / Sulfametoxazol': 'sulfametoxazol',
};

/**
 * La hoja abrevia. El nombre abreviado sirve para leerlo, no para formar la
 * llave con la que dos farmacias se comparan: "amoxicilina+ac. clavulanico" es
 * una llave fea y frágil.
 */
const ABREVIATURAS = [[/^Ác\.\s*/i, 'Ácido '], [/^Ac\.\s*/i, 'Ácido ']];
const desabreviar = (s) => ABREVIATURAS.reduce((x, [re, a]) => x.replace(re, a), s).trim();

/** Vías que se escriben como adjetivo al final y no son parte del activo. */
const VIAS = /\s+(ótic[oa]|oftálmic[oa]|tópic[oa]|nasal|inhalad[oa]|oral)$/i;

// ── 2. Lectura del CSV ──────────────────────────────────────────────────────

/** CSV con comillas dobles escapadas por duplicación. */
function celdas(linea) {
  const out = [];
  let cur = '';
  let dentro = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (ch === '"') {
      if (dentro && linea[i + 1] === '"') { cur += '"'; i++; } else dentro = !dentro;
    } else if (ch === ',' && !dentro) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

function filasDe(texto) {
  // Una fila puede ocupar varias líneas físicas si trae saltos entre comillas.
  const lineas = [];
  let buf = '';
  for (const l of texto.split(/\r?\n/)) {
    buf = buf ? buf + '\n' + l : l;
    if ((buf.match(/"/g) || []).length % 2 === 0) { lineas.push(buf); buf = ''; }
  }
  const filas = [];
  for (const l of lineas) {
    if (!l.trim()) continue;
    let f = celdas(l);
    // Los renglones que se agregaron después se pegaron como texto dentro de
    // la celda A, con las otras tres columnas vacías. Se vuelven a parsear.
    if (f.length > 1 && f.slice(1).every((x) => x === '') && f[0].includes(',')) f = celdas(f[0]);
    filas.push(f);
  }
  return filas.filter((f) => /^\d+$/.test((f[0] || '').trim()));
}

// ── 3. Normalización de un nombre ───────────────────────────────────────────

const sinAcentos = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Raíz con la que se busca el activo dentro de un título: la palabra más larga
 * del nombre, sin acentos. Se compara con frontera de palabra SOLO al inicio,
 * porque el final varía ("clavulánico" / "clavulanato") pero el principio no
 * —y esa frontera es justo lo que impide que "Esomeprazol" pase por
 * "Omeprazol"—.
 */
function raiz(activo) {
  if (RAICES[activo]) return RAICES[activo];
  const palabras = sinAcentos(activo).split(/[\s/]+/).filter((p) => p.length > 3 && p !== 'acido');
  return palabras.sort((a, b) => b.length - a.length)[0] || sinAcentos(activo);
}

/** Convierte una fila de la hoja en una o más entradas del catálogo. */
function entradas(fila) {
  const rank = Number(fila[0]);
  const crudo = (fila[1] || '').trim();
  const categoria = (fila[2] || '').trim();
  const busquedas = (fila[3] || '').trim();
  const base = { rank, categoria, busquedas };

  if (SEPARAR[crudo]) {
    return SEPARAR[crudo].map((n) => ({ ...base, nombre: n, query: n.toLowerCase(), raiz: raiz(n) }));
  }

  if (COMBINADOS[crudo]) {
    const activos = COMBINADOS[crudo];
    return [{
      ...base,
      nombre: crudo,
      query: activos.join(' ').toLowerCase(),
      activos,
      raices: activos.map(raiz),
    }];
  }

  if (SINONIMOS[crudo]) {
    const { nombre, tambien } = SINONIMOS[crudo];
    return [{ ...base, nombre, query: nombre.toLowerCase(), tambien, raiz: raiz(nombre) }];
  }

  // "Etoricoxib (Arcoxia)" → el paréntesis son marcas comerciales. Se guardan:
  // media farmacia titula sus productos con la marca y no con el activo, y sin
  // esto esas cajas no se emparejarían con su genérico —que es justo la
  // comparación que la página existe para mostrar—.
  const conMarca = crudo.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  let nombre = crudo;
  let tambien = null;
  if (conMarca) {
    nombre = conMarca[1].trim();
    tambien = conMarca[2].trim();
  }

  // "Levodopa con Carbidopa" → un producto, dos activos.
  const conJuntos = nombre.match(/^(.+?)\s+con\s+(.+)$/i);
  if (conJuntos) {
    const activos = [conJuntos[1], conJuntos[2]].map((a) => desabreviar(a.trim()));
    return [{
      ...base,
      nombre,
      query: nombre.toLowerCase(),
      activos,
      raices: activos.map(raiz),
      ...(tambien ? { tambien } : {}),
    }];
  }

  // "Dexametasona oftálmica" → la vía va en la búsqueda, no en el activo: el
  // título dirá "solución oftálmica" o "gotas oftálmicas", nunca el adjetivo
  // pegado al nombre. La forma y los ml ya separan las gotas de las tabletas.
  const activo = nombre.replace(VIAS, '').trim();

  const extra = MARCAS_EXTRA[nombre] || [];
  const marcas = [tambien, ...extra].filter(Boolean).join(' / ');

  return [{
    ...base,
    nombre,
    query: nombre.toLowerCase(),
    raiz: raiz(activo),
    ...(marcas ? { tambien: marcas } : {}),
  }];
}

// ── 4. Ejecución ────────────────────────────────────────────────────────────

const filas = filasDe(fs.readFileSync(RUTA_CSV, 'utf8'));
const medicamentos = filas.flatMap(entradas).sort((a, b) => a.rank - b.rank || a.nombre.localeCompare(b.nombre));

const previo = fs.existsSync(SALIDA) ? JSON.parse(fs.readFileSync(SALIDA, 'utf8')) : { medicamentos: [] };
const antes = new Set(previo.medicamentos.map((m) => m.nombre));
const ahora = new Set(medicamentos.map((m) => m.nombre));
const nuevos = [...ahora].filter((n) => !antes.has(n));
const idos = [...antes].filter((n) => !ahora.has(n));

console.log(`Hoja: ${filas.length} renglones → ${medicamentos.length} entradas de catálogo`);
console.log(`  ${nuevos.length} nuevos · ${idos.length} que ya no están · ${previo.medicamentos.length} antes`);

const combos = medicamentos.filter((m) => m.activos);
const marcas = medicamentos.filter((m) => m.tambien);
console.log(`  ${combos.length} productos combinados: ${combos.map((m) => m.nombre).join(' · ')}`);
console.log(`  ${marcas.length} con marca comercial registrada`);

// Dos fármacos DISTINTOS no pueden compartir raíz: se leerían como el mismo.
// No cuenta como choque que "Dexametasona oftálmica" comparta raíz con
// "Dexametasona" —es el mismo activo por otra vía, y la forma y los ml de la
// llave ya los separan—.
const porRaiz = {};
for (const m of medicamentos) if (m.raiz) (porRaiz[m.raiz] = porRaiz[m.raiz] || []).push(m.nombre);
const chocan = Object.entries(porRaiz).filter(([, v]) =>
  v.length > 1 && !v.every((n) => sinAcentos(n).startsWith(sinAcentos(v[0]))));
if (chocan.length) {
  console.log('\n⚠ raíces compartidas (dos fármacos distintos se leerían como el mismo):');
  for (const [r, v] of chocan) console.log(`   ${r}: ${v.join(', ')}`);
}

if (nuevos.length) console.log(`\nNuevos: ${nuevos.slice(0, 12).join(' · ')}${nuevos.length > 12 ? ` … +${nuevos.length - 12}` : ''}`);
if (idos.length) console.log(`Salieron: ${idos.join(' · ')}`);

if (!APLICAR) { console.log('\n(sin --apply: nada escrito)'); process.exit(chocan.length ? 1 : 0); }

fs.writeFileSync(SALIDA, JSON.stringify({
  fuente: 'Google Sheets · los medicamentos más buscados en México',
  nota: 'Generado por scripts/construir-catalogo-medicinas.js desde data/medicinas/hoja-origen.csv. No editar a mano: se regenera.',
  medicamentos,
}, null, 2) + '\n');
console.log(`\nEscrito: ${path.relative(ROOT, SALIDA)} (${medicamentos.length} medicamentos)`);
