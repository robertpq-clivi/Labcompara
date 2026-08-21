#!/usr/bin/env node
/**
 * Medcompara — Completa el JSON-LD de los artículos escritos a mano.
 *
 *   node scripts/completar-marcado-blog.js            # dry-run
 *   node scripts/completar-marcado-blog.js --apply     # escribe
 *
 * Los cuatro generadores emiten `Article`, `BreadcrumbList` y `author` siempre.
 * Los artículos escritos a mano se fueron acumulando sin criterio: 9 no tenían
 * `Article`, 17 no tenían `BreadcrumbList`, 63 no tenían `author` y 8 no tenían
 * fecha. `BreadcrumbList` importa especialmente porque es el único rich result
 * que este sitio sí gana hoy (ver «Rich snippets» en CLAUDE.md).
 *
 * Las fechas salen de **git**, no de `new Date()`:
 *   datePublished  = primer commit que añadió el archivo
 *   dateModified   = último commit anterior a la pasada de marcado
 *
 * Es la única fuente honesta que hay. Un `dateModified` de hoy sobre un texto
 * que nadie reescribió es una promesa de frescura falsa, y Google trata así los
 * cambios de fecha sin cambio de contenido.
 *
 * No toca las fechas que ya existen, por lo mismo.
 *
 * Idempotente: sólo agrega lo que falta.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT } = require('./lib/rutas');
const { legible } = require('./lib/ancla');

const BLOG = path.join(ROOT, 'blog');
const BASE = 'https://medcompara.com.mx';
const APLICAR = process.argv.includes('--apply');

const LD = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const TIPOS_ARTICULO = ['Article', 'BlogPosting', 'NewsArticle'];

const EDITOR = { '@type': 'Organization', name: 'Medcompara', url: BASE + '/' };

function git(args, archivo) {
  try {
    return execFileSync('git', [...args, '--', archivo], { cwd: ROOT, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
  } catch { return []; }
}

/** Alta del archivo y última modificación real, ignorando la pasada de marcado. */
function fechas(rel) {
  const altas = git(['log', '--diff-filter=A', '--format=%as'], rel);
  const todas = git(['log', '--format=%as'], rel);
  const alta = altas[altas.length - 1] || todas[todas.length - 1];
  // todas[0] es el commit de marcado; el siguiente es el último cambio real.
  const mod = todas.length > 1 ? todas[1] : alta;
  return { alta, mod };
}

function main() {
  const archivos = fs.readdirSync(BLOG)
    .filter((f) => f.endsWith('.html') && f !== 'index.html').sort();

  const cuenta = {};
  const detalle = [];
  let tocados = 0;

  for (const archivo of archivos) {
    const ruta = path.join(BLOG, archivo);
    let html = fs.readFileSync(ruta, 'utf8');
    const slug = archivo.replace(/\.html$/, '');

    const bloques = [];
    LD.lastIndex = 0;
    let m;
    while ((m = LD.exec(html))) {
      let j; try { j = JSON.parse(m[1]); } catch { continue; }
      bloques.push({ entero: m[0], crudo: m[1], json: j });
    }
    const nodos = bloques.flatMap((b) => Array.isArray(b.json) ? b.json : (b.json['@graph'] || [b.json]));

    const canonica = (html.match(/rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || [])[1]
      || `${BASE}/blog/${slug}`;
    const h1 = legible((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [, ''])[1]);
    const desc = (html.match(/<meta\s+name=["']description["'][^>]*content=["']([^"']*)["']/i) || [, ''])[1];
    const imagen = `${BASE}/images/blog/${slug}.png`;

    const hechos = [];
    const nuevos = [];
    let parcheArticle = null;

    // 1 · author y fechas en el Article que ya existe
    const article = nodos.find((n) => n && TIPOS_ARTICULO.includes(n['@type']));
    if (article) {
      const bloque = bloques.find((b) => b.crudo.includes('"' + (article.headline || '') + '"')
        && /"(Article|BlogPosting|NewsArticle)"/.test(b.crudo));
      const antes = JSON.stringify(article);

      if (!article.author) { article.author = EDITOR; hechos.push('author'); }
      if (!article.datePublished || !article.dateModified) {
        const { alta, mod } = fechas(`blog/${archivo}`);
        if (!article.datePublished && alta) { article.datePublished = alta; hechos.push('datePublished'); }
        if (!article.dateModified && (mod || alta)) { article.dateModified = mod || alta; hechos.push('dateModified'); }
      }
      // El reemplazo se guarda para después del append: si este bloque es el
      // último, editarlo primero le quita el ancla al append.
      if (bloque && JSON.stringify(article) !== antes) {
        parcheArticle = [bloque.entero,
          bloque.entero.replace(bloque.crudo,
            JSON.stringify(bloque.json['@graph'] ? bloque.json : article))];
      }
    } else {
      // 2 · no hay Article: se arma uno
      const { alta, mod } = fechas(`blog/${archivo}`);
      nuevos.push({
        '@context': 'https://schema.org', '@type': 'Article',
        headline: h1, image: [imagen], description: desc, url: canonica,
        inLanguage: 'es-MX',
        datePublished: alta, dateModified: mod || alta,
        author: EDITOR, publisher: EDITOR,
      });
      hechos.push('Article');
    }

    // 3 · breadcrumb
    if (!nodos.some((n) => n && n['@type'] === 'BreadcrumbList')) {
      nuevos.push({
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Inicio', item: BASE + '/' },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: BASE + '/blog' },
          { '@type': 'ListItem', position: 3, name: h1, item: canonica },
        ],
      });
      hechos.push('BreadcrumbList');
    }

    if (!hechos.length) continue;

    if (nuevos.length) {
      const ultimo = bloques[bloques.length - 1];
      const añadido = nuevos.map((n) =>
        `<script type="application/ld+json">${JSON.stringify(n)}</script>`).join('\n');
      if (!ultimo) { console.error(`${archivo}: sin ningún JSON-LD donde anclar`); continue; }
      html = html.replace(ultimo.entero, ultimo.entero + '\n' + añadido);
    }
    if (parcheArticle) html = html.replace(parcheArticle[0], parcheArticle[1]);

    tocados++;
    hechos.forEach((h) => { cuenta[h] = (cuenta[h] || 0) + 1; });
    if (detalle.length < 6) detalle.push(`  ${slug}: ${hechos.join(', ')}`);
    if (APLICAR) fs.writeFileSync(ruta, html);
  }

  console.log(`${tocados} artículos completados.\n`);
  Object.entries(cuenta).sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${String(v).padStart(3)}  ${k}`));
  console.log('\n' + detalle.join('\n'));
  console.log(APLICAR ? '\nEscrito.' : '\nDry-run. Corre con --apply para escribir.');
}

main();
