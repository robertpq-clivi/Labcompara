#!/usr/bin/env node
/**
 * Medcompara — Fix de URLs canónicas y enlaces internos
 *
 * vercel.json tiene cleanUrls:true y un 301 de /pages/:slug → /:slug, así que:
 *   /blog/slug.html   → 308 → /blog/slug
 *   /pages/slug.html  → 308 → /pages/slug → 301 → /slug   (doble salto)
 *
 * Este script deja todas las canónicas y todos los enlaces internos apuntando
 * a la URL que responde 200, sin saltos.
 *
 * Uso:
 *   node scripts/fix-urls-canonicas.js           (dry-run)
 *   node scripts/fix-urls-canonicas.js --apply
 */

const fs   = require('fs');
const path = require('path');

const ROOT  = path.join(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const BASE  = 'https://medcompara.com.mx';

// Slugs que viven en /pages/ pero se sirven en la raíz del dominio.
const PAGES = fs.readdirSync(path.join(ROOT, 'pages'))
  .filter(f => f.endsWith('.html'))
  .map(f => f.replace(/\.html$/, ''));

/** Reglas de reescritura. `scope`: en qué carpeta aplica. */
function reglas(scope) {
  const r = [
    // ── Canónicas y og:url absolutas ────────────────────────────────────────
    { de: new RegExp(`(${BASE}/blog/[a-z0-9-]+)\\.html`, 'g'), a: '$1',
      nota: 'canonical/og:url de blog sin .html' },
    { de: new RegExp(`"${BASE}/blog/"`, 'g'), a: `"${BASE}/blog"`,
      nota: 'canonical del índice de blog sin barra final' },

    // ── Índices (antes que la regla genérica de slug) ────────────────────────
    { de: /href="\.\.\/blog\/index\.html"/g, a: 'href="/blog"', nota: '../blog/index.html → /blog' },
    { de: /href="\/blog\/index\.html"/g,     a: 'href="/blog"', nota: '/blog/index.html → /blog' },
    { de: /href="blog\/index\.html"/g,       a: 'href="/blog"', nota: 'blog/index.html → /blog' },
    { de: /href="\.\.\/index\.html"/g,       a: 'href="/"',     nota: '../index.html → /' },

    // ── /pages/ se sirve en la raíz: mata el doble salto ─────────────────────
    { de: /href="\.\.\/pages\/([a-z0-9-]+)\.html"/g, a: 'href="/$1"', nota: '../pages/x.html → /x' },
    { de: /href="pages\/([a-z0-9-]+)\.html"/g,       a: 'href="/$1"', nota: 'pages/x.html → /x' },

    // ── Artículos de blog ────────────────────────────────────────────────────
    { de: /href="\.\.\/blog\/([a-z0-9-]+)\.html"/g, a: 'href="/blog/$1"', nota: '../blog/x.html → /blog/x' },
    { de: /href="\/blog\/([a-z0-9-]+)\.html"/g,     a: 'href="/blog/$1"', nota: '/blog/x.html → /blog/x' },
  ];

  if (scope === 'blog') {
    // Enlaces relativos entre artículos.
    r.push({ de: /href="index\.html"/g,          a: 'href="/blog"',     nota: 'index.html → /blog' });
    r.push({ de: /href="([a-z0-9-]+)\.html"/g,   a: 'href="/blog/$1"',  nota: 'x.html → /blog/x' });
  }

  if (scope === 'pages') {
    // Enlaces relativos entre landings: viven en la raíz del dominio.
    r.push({
      de: /href="([a-z0-9-]+)\.html"/g,
      a: (m, slug) => PAGES.includes(slug) ? `href="/${slug}"` : m,
      nota: 'x.html → /x',
    });
  }

  return r;
}

const archivos = [
  ...fs.readdirSync(path.join(ROOT, 'blog')).filter(f => f.endsWith('.html')).map(f => ({ file: path.join('blog', f),  scope: 'blog'  })),
  ...fs.readdirSync(path.join(ROOT, 'pages')).filter(f => f.endsWith('.html')).map(f => ({ file: path.join('pages', f), scope: 'pages' })),
  { file: 'index.html', scope: 'root' },
];

const total = {};
let tocados = 0;

for (const { file, scope } of archivos) {
  const abs = path.join(ROOT, file);
  const antes = fs.readFileSync(abs, 'utf8');
  let despues = antes;

  for (const { de, a, nota } of reglas(scope)) {
    const n = (despues.match(de) || []).length;
    if (!n) continue;
    despues = despues.replace(de, a);
    total[nota] = (total[nota] || 0) + n;
  }

  if (despues !== antes) {
    tocados++;
    if (APPLY) fs.writeFileSync(abs, despues);
  }
}

console.log(APPLY ? '── APLICADO ──' : '── DRY-RUN (usa --apply) ──');
for (const [nota, n] of Object.entries(total).sort((x, y) => y[1] - x[1])) {
  console.log(String(n).padStart(5), nota);
}
console.log('\nArchivos modificados:', tocados, 'de', archivos.length);
