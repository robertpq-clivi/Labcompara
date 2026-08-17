#!/usr/bin/env node
/**
 * Medcompara — La tabla publicada no se queda atrás del feed
 * ---------------------------------------------------------------------------
 * La tabla de pages/laboratorio.html es contenido publicado: se ve sin ejecutar
 * JavaScript, que es justamente su razón de existir. Eso la vuelve una cifra a
 * mano en potencia — la clase de número que, según CLAUDE.md, envejece sola y
 * termina contradiciendo a la tabla de su propia página.
 *
 * RAW_DATA puede envejecer sin daño porque es el fallback y el sitio consume
 * /data/precios.json en caliente. La tabla no tiene esa red: lo que dice es lo
 * que Google indexa y lo que lee quien no ejecuta JS.
 *
 * Este test revienta si alguien toca la tabla a mano, o si el workflow deja de
 * regenerarla después de un scan.
 *
 *   node scripts/test-tabla-precios.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, COMPARADOR_LAB } = require('./lib/rutas');
const { LAB_IDS } = require('./lib/apply');

const pesos = (n) => '$' + Math.round(n).toLocaleString('es-MX');

const fallos = [];
const ok = [];

const html = fs.readFileSync(COMPARADOR_LAB, 'utf8');
const feed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'precios.json'), 'utf8'));

const bloque = (html.match(/TABLA-PRECIOS:INICIO[\s\S]*?TABLA-PRECIOS:FIN/) || [])[0];

if (!bloque) {
  fallos.push('pages/laboratorio.html ya no tiene el bloque TABLA-PRECIOS. ' +
    'Si se quitó a propósito, borra también este test y el generador.');
} else {
  const porNombre = new Map(feed.estudios.map((e) => [e.name, e]));

  // 1 · cada fila corresponde a un estudio que existe en el feed
  const nombres = [...bloque.matchAll(/<th scope="row">([^<]+)<\/th>/g)]
    .map((m) => m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'));
  const fantasmas = nombres.filter((n) => !porNombre.has(n));
  if (fantasmas.length) fallos.push(`${fantasmas.length} fila(s) que no existen en el feed: ${fantasmas.slice(0, 3).join(' · ')}`);
  else ok.push(`las ${nombres.length} filas publicadas existen en el feed`);

  // 2 · ninguna cifra publicada es ajena al feed
  const delFeed = new Set();
  for (const e of feed.estudios) {
    for (const lab of LAB_IDS) {
      if (typeof e[lab] === 'number' && e[lab] > 0) delFeed.add(pesos(e[lab]));
    }
  }
  const publicadas = bloque.match(/\$[\d,]+/g) || [];
  const intrusas = [...new Set(publicadas.filter((p) => !delFeed.has(p)))];
  if (intrusas.length) fallos.push(`${intrusas.length} cifra(s) publicadas que no salen del feed: ${intrusas.slice(0, 5).join(' · ')}`);
  else ok.push(`las ${publicadas.length} cifras publicadas salen del feed`);

  // 3 · fila por fila, el precio de cada laboratorio es el del feed
  //     (lo que atrapa un scan aplicado sin regenerar la tabla)
  let desfasadas = 0;
  const ejemplos = [];
  for (const m of bloque.matchAll(/<tr><th scope="row">([^<]+)<\/th>((?:<td>.*?<\/td>){6})/g)) {
    const e = porNombre.get(m[1]);
    if (!e) continue;
    const celdas = [...m[2].matchAll(/<td>(?:<strong[^>]*>)?([^<]*)/g)].map((c) => c[1].trim());
    LAB_IDS.forEach((lab, i) => {
      const esperado = typeof e[lab] === 'number' && e[lab] > 0 ? pesos(e[lab]) : '—';
      if (celdas[i] !== undefined && celdas[i] !== esperado) {
        desfasadas++;
        if (ejemplos.length < 4) ejemplos.push(`${m[1]} · ${lab}: tabla ${celdas[i]} vs feed ${esperado}`);
      }
    });
  }
  if (desfasadas) {
    fallos.push(`${desfasadas} celda(s) desfasadas del feed — corre: node scripts/generar-tabla-precios.js --apply`);
    ejemplos.forEach((x) => fallos.push('    ' + x));
  } else ok.push('cada celda coincide con el precio del feed');

  // 4 · la fecha mostrada es la del scan, no otra
  const iso = String(feed.generado || feed.generated_at).slice(0, 10);
  const mostrada = (bloque.match(/datetime="([\d-]+)"/) || [])[1];
  if (mostrada !== iso) fallos.push(`la tabla dice que los precios son del ${mostrada} y el feed es del ${iso}`);
  else ok.push(`la fecha publicada (${iso}) es la del scan`);
}

console.log('Tabla de precios renderizada en servidor\n');
ok.forEach((o) => console.log(`  ✓ ${o}`));
fallos.forEach((f) => console.log(`  ✗ ${f}`));
console.log(fallos.length ? `\n✗ ${fallos.length} casos fallaron` : '\n✓ Todos los casos pasaron');
process.exit(fallos.length ? 1 : 0);
