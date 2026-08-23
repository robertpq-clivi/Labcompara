#!/usr/bin/env node
/**
 * Medcompara — Ningún redirect ni rewrite de vercel.json apunta a la nada
 * ---------------------------------------------------------------------------
 * Los 18 redirects de `tema-precio-mexico` existen porque sitemap-estudios.xml
 * anunció durante meses ese patrón mientras los generadores escribían los
 * archivos como `precio-tema-mexico`. El sitemap ya se borró (#14), pero Google
 * conserva las URLs en su cola de rastreo y las reintenta: un 301 las cierra,
 * un 404 las deja reapareciendo en el informe de indexación.
 *
 * El riesgo de una lista a mano es el de siempre en este repo: alguien renombra
 * un artículo y los redirects quedan apuntando a un 404 — el mismo 404 que
 * venían a arreglar, ahora escondido detrás de un 301 que nadie mira.
 *
 * También revisa el otro sentido: que un `source` no tape un archivo real.
 * `/blog/x` con blog/x.html en el disco sería un 301 que se come su propia
 * página, y el sitemap seguiría anunciándola.
 *
 *   node scripts/test-rutas.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT } = require('./lib/rutas');

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const REWRITES = cfg.rewrites || [];
const REDIRECTS = cfg.redirects || [];
const fallos = [];
const ok = [];

/** Igual que generate-sitemaps.js: resuelve una ruta pública a su archivo. */
function archivoQueSirve(ruta) {
  if (ruta === '/') return 'index.html';
  const rw = REWRITES.find((r) => r.source === ruta);
  return (rw ? rw.destination : ruta).replace(/^\//, '') + '.html';
}
const existe = (ruta) => fs.existsSync(path.join(ROOT, archivoQueSirve(ruta)));

// Los que reescriben host (www→apex, labcompara→medcompara) o mandan a otro
// dominio no se resuelven contra el disco: su destino no es un archivo de aquí.
const internos = REDIRECTS.filter((r) =>
  r.destination.startsWith('/') && !r.source.includes('(') && !r.source.includes(':'));

// 1 · todo redirect interno aterriza en un archivo que existe
const alVacio = internos.filter((r) => !existe(r.destination));
if (alVacio.length) {
  fallos.push(`${alVacio.length} redirect(s) apuntan a una página que no existe:`);
  alVacio.forEach((r) => fallos.push(`    ${r.source}  →  ${r.destination}  (falta ${archivoQueSirve(r.destination)})`));
} else ok.push(`los ${internos.length} redirects internos aterrizan en un archivo real`);

// 2 · ningún redirect tapa una página publicada
const tapados = internos.filter((r) => existe(r.source));
if (tapados.length) {
  fallos.push(`${tapados.length} redirect(s) tapan una página que sí existe:`);
  tapados.forEach((r) => fallos.push(`    ${r.source} existe en el disco y se está redirigiendo a ${r.destination}`));
} else ok.push('ningún redirect tapa una página publicada');

// 3 · sin cadenas: un 301 que lleva a otro 301 gasta rastreo y pierde señal
const porOrigen = new Map(internos.map((r) => [r.source, r.destination]));
const cadenas = internos.filter((r) => porOrigen.has(r.destination));
if (cadenas.length) {
  fallos.push(`${cadenas.length} redirect(s) en cadena (301 → 301):`);
  cadenas.forEach((r) => fallos.push(`    ${r.source} → ${r.destination} → ${porOrigen.get(r.destination)}`));
} else ok.push('ninguna cadena de redirects');

// 4 · una regla repetida significa que alguien ya no sabe cuál gana. La llave
// incluye `has`: los dos `/(.*)` conviven porque cada uno mira otro host.
const llave = (r) => r.source + '|' + JSON.stringify(r.has || []);
const vistos = new Set();
const dobles = REDIRECTS.filter((r) => vistos.has(llave(r)) || (vistos.add(llave(r)), false));
if (dobles.length) fallos.push(`regla duplicada en redirects: ${dobles.map((r) => r.source).join(' · ')}`);
else ok.push(`las ${REDIRECTS.length} reglas de redirect son únicas`);

// 5 · todo rewrite sirve un archivo real (las rutas limpias de pages/)
const rwRotos = REWRITES.filter((r) => !fs.existsSync(path.join(ROOT, r.destination.replace(/^\//, '') + '.html')));
if (rwRotos.length) {
  fallos.push(`${rwRotos.length} rewrite(s) sin archivo:`);
  rwRotos.forEach((r) => fallos.push(`    ${r.source} → ${r.destination}`));
} else ok.push(`los ${REWRITES.length} rewrites sirven un archivo real`);

console.log('Rutas de vercel.json\n');
ok.forEach((o) => console.log(`  ✓ ${o}`));
fallos.forEach((f) => console.log(`  ✗ ${f}`));
console.log(fallos.length ? `\n✗ ${fallos.length} casos fallaron` : '\n✓ Todos los casos pasaron');
process.exit(fallos.length ? 1 : 0);
