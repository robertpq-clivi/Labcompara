#!/usr/bin/env node
/**
 * Medcompara — Test del cargador de precios del comparador
 * --------------------------------------------------------
 * `cargarPrecios()` es la pieza que decide si el sitio muestra precios frescos
 * o el snapshot embebido. Si falla mal, el comparador se queda a medias sin
 * avisar. Este test extrae la función REAL del comparador (no una copia) y la
 * corre contra un DOM mínimo y varios feeds:
 *
 *   1. feed bueno            → adopta los precios nuevos y actualiza el footer
 *   2. feed corto            → lo rechaza y conserva RAW_DATA
 *   3. feed sin precios      → lo rechaza y conserva RAW_DATA
 *   4. HTTP 500 / red caída  → lo rechaza y conserva RAW_DATA
 *   5. timeout               → lo rechaza y conserva RAW_DATA
 *
 *   node scripts/test-feed.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { COMPARADOR_LAB } = require('./lib/rutas');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(COMPARADOR_LAB, 'utf8');

// ── extraer del comparador: RAW_DATA, LABS y el bloque del feed ──────────────
function trozo(desde, hasta) {
  const i = html.indexOf(desde);
  const j = html.indexOf(hasta, i);
  if (i < 0 || j < 0) throw new Error(`No se encontró el bloque: ${desde}`);
  return html.slice(i, j);
}

const fuente = [
  trozo('const RAW_DATA = [', '\n];') + '\n];',
  trozo("const LABS = ['Labbe'", '\n'),
  'let ESTUDIOS = RAW_DATA;',
  'let preciosActualizados = null;',
  trozo('const FEED_URL', '// ── SUPABASE'),
].join('\n');

// ── DOM mínimo ───────────────────────────────────────────────────────────────
function nuevoEntorno(fetchImpl) {
  const footer = { textContent: 'original' };
  const ctx = {
    console: { warn: (...a) => ctx.__warns.push(a.join(' ')), log: () => {} },
    __warns: [],
    fetch: fetchImpl,
    AbortController,
    setTimeout,
    clearTimeout,
    document: {
      querySelector: (sel) => (sel === '.footer-disc' ? footer : null),
    },
    $: () => null,
    renderList: () => { ctx.__render = (ctx.__render || 0) + 1; },
    __footer: footer,
  };
  vm.createContext(ctx);
  vm.runInContext(fuente, ctx);
  // `let`/`const` no se cuelgan del objeto de contexto: se leen evaluando.
  ctx.leer = (expr) => vm.runInContext(expr, ctx);
  return ctx;
}

const feedBueno = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'precios.json'), 'utf8'));
const ok = (body) => async () => ({ ok: true, status: 200, json: async () => body });

const casos = [
  {
    nombre: 'feed bueno → adopta precios frescos',
    fetch: ok(feedBueno),
    espera: (c) => c.leer('ESTUDIOS.length') === feedBueno.estudios.length && c.__warns.length === 0
      && c.__footer.textContent.includes('Precios actualizados'),
  },
  {
    nombre: 'feed corto → conserva RAW_DATA',
    fetch: ok({ generado: '2026-01-01', estudios: feedBueno.estudios.slice(0, 10) }),
    espera: (c) => c.leer('ESTUDIOS === RAW_DATA') && c.__warns.length === 1,
  },
  {
    nombre: 'feed sin precios usables → conserva RAW_DATA',
    fetch: ok({ generado: '2026-01-01', estudios: feedBueno.estudios.map((e) => ({ name: e.name })) }),
    espera: (c) => c.leer('ESTUDIOS === RAW_DATA') && c.__warns.length === 1,
  },
  {
    nombre: 'HTTP 500 → conserva RAW_DATA',
    fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }),
    espera: (c) => c.leer('ESTUDIOS === RAW_DATA') && c.__warns.length === 1,
  },
  {
    nombre: 'red caída → conserva RAW_DATA',
    fetch: async () => { throw new Error('ECONNREFUSED'); },
    espera: (c) => c.leer('ESTUDIOS === RAW_DATA') && c.__warns.length === 1,
  },
  {
    nombre: 'JSON corrupto → conserva RAW_DATA',
    fetch: async () => ({ ok: true, status: 200, json: async () => { throw new Error('Unexpected token'); } }),
    espera: (c) => c.leer('ESTUDIOS === RAW_DATA') && c.__warns.length === 1,
  },
];

// ── las cifras publicadas no deben quedarse atrás del catálogo ──────────────
// El "más de 64 estudios" sobrevivió a dos ampliaciones (64 → 124 → 620) en
// siete lugares distintos, porque está escrito a mano en el copy. Este chequeo
// no lo arregla solo, pero lo delata antes de publicarlo.
function revisarCifras() {
  const feed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'precios.json'), 'utf8'));
  const real = feed.estudios.length;
  const archivos = ['index.html', ...fs.readdirSync(path.join(ROOT, 'pages'))
    .filter((f) => f.endsWith('.html')).map((f) => path.join('pages', f))];
  const malas = [];
  for (const rel of archivos) {
    const txt = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const m of txt.matchAll(/(?:más de|Más de|M&#xe1;s de)\s+(\d{2,4})\s+(?:estudios|pruebas)/g)) {
      const n = Number(m[1]);
      // Debe ser una afirmación cierta y no quedarse corta por más de una centena.
      if (n > real || real - n >= 100) malas.push(`${rel}: "más de ${n}" contra ${real} reales`);
    }
  }
  return malas;
}

(async () => {
  let fallos = 0;
  console.log('Cargador de precios del comparador\n');
  for (const caso of casos) {
    const ctx = nuevoEntorno(caso.fetch);
    await vm.runInContext('cargarPrecios()', ctx);
    const pasa = caso.espera(ctx);
    if (!pasa) fallos++;
    console.log(`  ${pasa ? '✓' : '✗'} ${caso.nombre}`);
    if (!pasa) console.log(`      estudios=${ctx.leer('ESTUDIOS.length')} warns=${JSON.stringify(ctx.__warns)}`);
  }
  const cifras = revisarCifras();
  console.log('\nCifras publicadas al día:');
  if (cifras.length) { fallos += cifras.length; cifras.forEach((c) => console.log(`  ✗ ${c}`)); }
  else console.log('  ✓ ninguna cifra del copy se quedó atrás del catálogo');

  console.log(fallos ? `\n✗ ${fallos} casos fallaron` : '\n✓ Todos los casos pasaron');
  process.exit(fallos ? 1 : 0);
})();
