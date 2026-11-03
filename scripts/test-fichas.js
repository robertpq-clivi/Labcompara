#!/usr/bin/env node
/**
 * Medcompara — Test del respaldo de fichas
 * -----------------------------------------
 * OLAB pasó dos corridas con la columna congelada porque su sitemap.xml
 * respondía 503 mientras las fichas seguían vivas. Estos casos fijan que un
 * sitemap caído use el respaldo, que sin respaldo falle igual que antes, y que
 * el respaldo no se reescriba si no cambió (entra en el commit semanal).
 *
 *   node scripts/test-fichas.js
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { leerFichas, guardarFichas, urlsConRespaldo, archivo } = require('./lib/fichas');

let fallos = 0;
const check = (ok, desc, extra = '') => {
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${desc}${extra && !ok ? '  → ' + extra : ''}`);
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fichas-'));
const lab = (id, urls) => ({ id, urls: async () => (typeof urls === 'function' ? urls() : urls) });
const caido = () => { throw new Error('Zyte HTTP 520: Website Ban'); };

(async () => {
  console.log('Guardar y leer:');
  check(leerFichas('OLAB', dir).length === 0, 'sin archivo → lista vacía');
  check(guardarFichas('OLAB', ['https://x/b', 'https://x/a', 'https://x/b', ''], dir), 'la primera vez escribe');
  check(JSON.stringify(leerFichas('OLAB', dir)) === '["https://x/a","https://x/b"]', 'ordenadas y sin repetir',
    JSON.stringify(leerFichas('OLAB', dir)));
  check(!guardarFichas('OLAB', ['https://x/a', 'https://x/b'], dir), 'sin cambios no reescribe');
  check(!guardarFichas('Chopo', [], dir) && !fs.existsSync(archivo('Chopo', dir)), 'una lista vacía no crea archivo');
  check(path.basename(archivo('Salud Digna', dir)) === 'salud-digna.json', 'mismo nombre de archivo que data/scan/');

  console.log('\nSitemap con respaldo:');
  let r = await urlsConRespaldo(lab('OLAB', ['https://x/nueva']), {}, { dir });
  check(r.urls.length === 1 && r.respaldo === null, 'sitemap sano → sus URLs, sin respaldo');

  const logs = [];
  r = await urlsConRespaldo(lab('OLAB', caido), {}, { dir, log: (m) => logs.push(m) });
  check(r.urls.length === 2 && /Website Ban/.test(r.respaldo), 'sitemap caído → fichas guardadas', JSON.stringify(r));
  check(logs.length === 1 && /2 fichas/.test(logs[0]), 'deja rastro en el log', logs[0]);

  r = await urlsConRespaldo(lab('OLAB', []), {}, { dir });
  check(r.urls.length === 2 && r.respaldo === 'sitemap sin fichas', 'sitemap vacío también usa el respaldo');

  let lanzo = null;
  try { await urlsConRespaldo(lab('LAPI', caido), {}, { dir }); } catch (e) { lanzo = e; }
  check(lanzo && /Website Ban/.test(lanzo.message), 'sin respaldo → el mismo error de antes');

  r = await urlsConRespaldo(lab('LAPI', []), {}, { dir });
  check(r.urls.length === 0 && r.respaldo === null, 'sin respaldo y sitemap vacío → vacío, como antes');

  console.log('\nRespaldo commiteado:');
  const olab = leerFichas('OLAB');
  check(olab.length > 1000, `data/fichas/olab.json trae el catálogo de OLAB (${olab.length})`);
  check(olab.every((u) => /^https:\/\/olab\.com\.mx\/estudios\/detalle\//.test(u)), 'solo fichas de estudio');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(fallos ? `\n✗ ${fallos} casos fallaron` : '\n✓ Todos los casos pasaron');
  process.exit(fallos ? 1 : 0);
})();
