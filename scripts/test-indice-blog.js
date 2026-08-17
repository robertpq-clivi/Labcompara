#!/usr/bin/env node
/**
 * Medcompara — El índice del blog no deja artículos fuera
 * ---------------------------------------------------------------------------
 * Es la tercera vez que una lista a mano se desincroniza del directorio en este
 * repo: BLOG_PAGES declaraba 30 URLs con 48 posts publicados; sitemap-estudios.xml
 * publicaba 18 URLs que nunca existieron; y blog/index.html enlazaba 57 de 178,
 * dejando 112 artículos a tres clics o más de la home y 19 sin ruta de
 * navegación.
 *
 * El generador lee el directorio, así que no puede quedarse corto por sí solo.
 * Lo que este test cubre es lo otro: que alguien publique un artículo y no
 * regenere el índice, o que edite a mano el bloque generado.
 *
 *   node scripts/test-indice-blog.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT } = require('./lib/rutas');

const BLOG_DIR = path.join(ROOT, 'blog');
const fallos = [];
const ok = [];

const html = fs.readFileSync(path.join(BLOG_DIR, 'index.html'), 'utf8');
const archivos = fs.readdirSync(BLOG_DIR)
  .filter((f) => f.endsWith('.html') && f !== 'index.html')
  .map((f) => f.replace(/\.html$/, ''));
const enlazados = new Set([...html.matchAll(/href="\/blog\/([^"#?]+)"/g)].map((m) => m[1]));

// 1 · ningún artículo se queda sin enlace desde el índice
const huerfanos = archivos.filter((s) => !enlazados.has(s));
if (huerfanos.length) {
  fallos.push(`${huerfanos.length} artículo(s) sin enlace desde blog/index.html — corre: node scripts/generar-indice-blog.js --apply`);
  huerfanos.slice(0, 6).forEach((s) => fallos.push(`    blog/${s}.html`));
} else ok.push(`los ${archivos.length} artículos están enlazados desde el índice`);

// 2 · el bloque generado sigue ahí
const bloque = (html.match(/ARCHIVO-BLOG:INICIO[\s\S]*?ARCHIVO-BLOG:FIN/) || [])[0];
if (!bloque) {
  fallos.push('blog/index.html ya no tiene el bloque ARCHIVO-BLOG. ' +
    'Si se quitó a propósito, borra también este test y el generador.');
} else {
  ok.push('el bloque generado sigue presente');

  // 3 · el bloque no enlaza artículos que ya no existen
  const enBloque = [...bloque.matchAll(/href="\/blog\/([^"#?]+)"/g)].map((m) => m[1]);
  const fantasmas = enBloque.filter((s) => !archivos.includes(s));
  if (fantasmas.length) fallos.push(`el archivo enlaza ${fantasmas.length} artículo(s) borrados: ${fantasmas.slice(0, 3).join(' · ')}`);
  else ok.push(`las ${enBloque.length} entradas del archivo apuntan a artículos que existen`);

  // 4 · el conteo que se le muestra al lector es el real
  const dice = Number((bloque.match(/Los (\d+) artículos publicados/) || [])[1]);
  if (dice !== archivos.length) fallos.push(`el índice dice "${dice} artículos publicados" y hay ${archivos.length}`);
  else ok.push(`el conteo publicado (${dice}) coincide con el directorio`);
}

console.log('Índice del blog\n');
ok.forEach((o) => console.log(`  ✓ ${o}`));
fallos.forEach((f) => console.log(`  ✗ ${f}`));
console.log(fallos.length ? `\n✗ ${fallos.length} casos fallaron` : '\n✓ Todos los casos pasaron');
process.exit(fallos.length ? 1 : 0);
