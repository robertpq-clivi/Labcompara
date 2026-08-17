#!/usr/bin/env node
/**
 * Medcompara — Archivo completo del blog
 * ---------------------------------------------------------------------------
 * blog/index.html tiene ocho secciones curadas a mano, con tarjetas y su
 * "Desde $X". Sirven, pero enlazan 57 de 178 artículos: los otros 121 sólo se
 * alcanzan saltando de post en post por los enlaces de "relacionados", y 19 no
 * se alcanzan en absoluto navegando desde la home. 112 quedan a tres clics o
 * más, algunos a nueve.
 *
 * Para un dominio nuevo eso importa: el presupuesto de rastreo es lo más
 * escaso que tiene, y Google lo gasta en lo que encuentra cerca. Un artículo a
 * nueve clics compite en desventaja con uno a dos.
 *
 * Este script NO toca las secciones curadas — ni la que inyecta
 * generar-blog-medicinas.js. Agrega al final un archivo completo que se lee del
 * directorio, así que por construcción no puede quedarse corto: si el archivo
 * existe en blog/, está enlazado.
 *
 * Es la tercera vez que una lista a mano se desincroniza en este repo. La
 * primera fue BLOG_PAGES, que declaraba 30 URLs con 48 posts publicados. La
 * segunda, sitemap-estudios.xml, con 18 de 20 URLs que nunca existieron.
 *
 * Usage:
 *   node scripts/generar-indice-blog.js            # dry-run
 *   node scripts/generar-indice-blog.js --apply    # escribe
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT } = require('./lib/rutas');

const APPLY = process.argv.includes('--apply');

const BLOG_DIR = path.join(ROOT, 'blog');
const INDICE = path.join(BLOG_DIR, 'index.html');

const INICIO = '<!-- ARCHIVO-BLOG:INICIO — generado por scripts/generar-indice-blog.js, no editar a mano -->';
const FIN = '<!-- ARCHIVO-BLOG:FIN -->';

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** El <h1> del artículo, que es el título que el lector ya vio en Google. */
function titulo(html, slug) {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m) return null;
  const txt = m[1]
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return txt || null;
}

/**
 * El grupo sale del slug, no de una lista: una lista sería exactamente la
 * clase de cosa que este script existe para eliminar.
 */
function grupo(slug) {
  if (/-vs-/.test(slug)) return 'Comparativas';
  if (/(^|-)precio(s)?(-|$)|cuanto-cuesta|cuanto-cuestan|costo/.test(slug)) return 'Precios';
  return 'Guías y consejos';
}

const ORDEN = ['Precios', 'Comparativas', 'Guías y consejos'];

// ── recolectar ───────────────────────────────────────────────────────────────
const posts = [];
const sinTitulo = [];
for (const f of fs.readdirSync(BLOG_DIR).filter((x) => x.endsWith('.html') && x !== 'index.html').sort()) {
  const slug = f.replace(/\.html$/, '');
  const t = titulo(fs.readFileSync(path.join(BLOG_DIR, f), 'utf8'), slug);
  if (!t) { sinTitulo.push(slug); continue; }
  posts.push({ slug, titulo: t, grupo: grupo(slug) });
}

// Un artículo sin <h1> no se enlaza con un título inventado ni con el slug
// crudo: se corta la corrida. Publicar el archivo a medias reintroduce el
// problema que este script viene a cerrar.
if (sinTitulo.length) {
  console.error(`\n❌ ${sinTitulo.length} artículo(s) sin <h1>, no se puede titular su enlace:`);
  sinTitulo.forEach((s) => console.error(`     blog/${s}.html`));
  console.error('\n   No se escribió nada.\n');
  process.exit(1);
}

const porGrupo = ORDEN
  .map((g) => [g, posts.filter((p) => p.grupo === g).sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'))])
  .filter(([, xs]) => xs.length);

const bloque = `${INICIO}
  <h2 class="cat-title">Todos los artículos</h2>
  <p style="color:var(--gray-600);font-size:14px;margin:-8px 0 20px;">Los ${posts.length} artículos publicados, completos.</p>
${porGrupo.map(([g, xs]) => `  <h3 class="archivo-h">${esc(g)} <span>(${xs.length})</span></h3>
  <ul class="archivo-lista">
${xs.map((p) => `    <li><a href="/blog/${p.slug}">${esc(p.titulo)}</a></li>`).join('\n')}
  </ul>`).join('\n')}
  ${FIN}`;

// ── informe ──────────────────────────────────────────────────────────────────
console.log('\n🗂️  Medcompara · archivo del blog');
console.log(`   artículos en blog/ : ${posts.length}`);
porGrupo.forEach(([g, xs]) => console.log(`     ${g.padEnd(20)} ${xs.length}`));

let html = fs.readFileSync(INDICE, 'utf8');
const yaEnlazados = new Set([...html.matchAll(/href="\/blog\/([^"#?]+)"/g)].map((m) => m[1]));
const rx = new RegExp(`${INICIO.replace(/[.*+?^${}()|[\]\\—]/g, '\\$&')}[\\s\\S]*?${FIN}`);
console.log(`   ya enlazados arriba: ${yaEnlazados.size}`);
console.log(`   HTML del bloque    : ${(bloque.length / 1024).toFixed(1)} KB`);

if (rx.test(html)) {
  html = html.replace(rx, bloque);
} else {
  // Va dentro de .wrap, antes del </div> que la cierra: fuera perdería el
  // ancho máximo y el padding de la página.
  const iFooter = html.indexOf('<footer');
  const iCierre = html.lastIndexOf('</div>', iFooter);
  if (iFooter === -1 || iCierre === -1) {
    console.error('\nNo se encontró el cierre de .wrap antes del <footer>.\n');
    process.exit(1);
  }
  html = html.slice(0, iCierre) + bloque + '\n' + html.slice(iCierre);
}

if (!APPLY) {
  console.log('\n   (nada escrito — corre con --apply para aplicarlo)\n');
} else {
  fs.writeFileSync(INDICE, html);
  console.log(`\n✅ blog/index.html actualizado: los ${posts.length} artículos enlazados.\n`);
}
