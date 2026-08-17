#!/usr/bin/env node
/**
 * Medcompara — Sitemap Generator
 * Generates: sitemap-core.xml, sitemap-blog.xml, sitemap-index.xml
 *
 * Usage:
 *   node scripts/generate-sitemaps.js
 *   npm run generate:sitemaps
 *
 * To add pages: edit the CORE_PAGES array below. El blog se lee del directorio.
 *
 * Antes de escribir, valida que cada ruta resuelva a un archivo real. Un sitemap
 * es una promesa: cada URL que declara, Google la va a pedir.
 */

const fs   = require('fs');
const path = require('path');

// ── CONFIG ───────────────────────────────────────────────────────────────────
const BASE_URL  = 'https://medcompara.com.mx';
const TODAY     = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
const PUBLIC_DIR = path.join(__dirname, '..'); // Sitemaps at repo root → served at domain root

// ── CORE PAGES ────────────────────────────────────────────────────────────────
// changefreq: weekly | priority: 1.0 homepage / 0.9 core
const CORE_PAGES = [
  { path: '/glp1',                              priority: '1.0', changefreq: 'weekly'  },
  { path: '/medicinas',                         priority: '1.0', changefreq: 'weekly'  },
  { path: '/farmacias',                         priority: '0.8', changefreq: 'monthly' },
  { path: '/',                                  priority: '1.0', changefreq: 'weekly'  },
  { path: '/laboratorio',                       priority: '1.0', changefreq: 'weekly'  },
  { path: '/laboratorio-cerca-de-mi',           priority: '0.9', changefreq: 'weekly'  },
  { path: '/laboratorio-clinico',               priority: '0.9', changefreq: 'weekly'  },
  { path: '/estudios-de-laboratorio',           priority: '0.9', changefreq: 'weekly'  },
  { path: '/laboratorio-medico',                priority: '0.9', changefreq: 'weekly'  },
  { path: '/analisis-clinicos',                 priority: '0.9', changefreq: 'weekly'  },
  { path: '/laboratorio-de-analisis-clinicos',  priority: '0.9', changefreq: 'weekly'  },
  { path: '/examenes-de-sangre',                priority: '0.9', changefreq: 'weekly'  },
  { path: '/pruebas-de-laboratorio',            priority: '0.9', changefreq: 'weekly'  },
  { path: '/estudios-clinicos',                 priority: '0.9', changefreq: 'weekly'  },
];

// Hubo un tercer sitemap, sitemap-estudios.xml, con 20 URLs escritas a mano bajo
// un patrón de slug —«tema-precio-mexico»— que los generadores nunca usaron: los
// archivos salieron como «precio-tema-mexico». 18 de sus 20 URLs jamás existieron
// y llevaban meses devolviendo 404 dentro de un sitemap. Las 2 restantes ya venían
// en sitemap-blog.xml, que lee el directorio. El archivo era redundante entero, así
// que se eliminó en vez de repararse. La misma enfermedad que ya había vaciado a
// BLOG_PAGES; de ahí la validación de abajo.

// ── BLOG ──────────────────────────────────────────────────────────────────────
// Se lee del directorio en vez de mantener una lista a mano: la versión anterior
// declaraba 30 URLs mientras el blog tenía 48 posts, así que 47 de ellos nunca
// se le enviaron a Google.
const BLOG_DIR = path.join(__dirname, '..', 'blog');
const BLOG_PAGES = fs.existsSync(BLOG_DIR)
  ? fs.readdirSync(BLOG_DIR)
      .filter(f => f.endsWith('.html') && f !== 'index.html')
      .sort()
      .map(f => {
        // Las comparativas entre laboratorios se regeneran con cada scan semanal.
        const esComparativa = /-vs-.*-precios\.html$/.test(f);
        return {
          path: '/blog/' + f.replace(/\.html$/, ''),
          priority:   esComparativa ? '0.8'    : '0.7',
          changefreq: esComparativa ? 'weekly' : 'monthly',
        };
      })
  : [];


// ── VALIDACIÓN ────────────────────────────────────────────────────────────────
// Resuelve una ruta pública al archivo que la sirve, igual que Vercel: `/` es
// index.html, `/blog/x` es blog/x.html, y las rutas limpias pasan por los
// rewrites de vercel.json (`/laboratorio` → pages/laboratorio.html).
const REWRITES = JSON.parse(
  fs.readFileSync(path.join(PUBLIC_DIR, 'vercel.json'), 'utf8')
).rewrites || [];

function archivoQueSirve(ruta) {
  if (ruta === '/') return 'index.html';
  const rw = REWRITES.find(r => r.source === ruta);
  return (rw ? rw.destination : ruta).replace(/^\//, '') + '.html';
}

function validar(nombre, pages) {
  const rotas = pages.filter(p => !fs.existsSync(path.join(PUBLIC_DIR, archivoQueSirve(p.path))));
  if (rotas.length === 0) return;
  console.error(`\n❌ ${nombre}: ${rotas.length} ruta(s) sin archivo que las sirva:\n`);
  rotas.forEach(p => console.error(`     ${p.path}  →  falta ${archivoQueSirve(p.path)}`));
  console.error('\n   No se escribió ningún sitemap. Anunciarle un 404 a Google es peor');
  console.error('   que no anunciar la página.\n');
  process.exit(1);
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function urlEntry({ path: p, priority, changefreq }) {
  return [
    '  <url>',
    `    <loc>${BASE_URL}${p}</loc>`,
    `    <lastmod>${TODAY}</lastmod>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    '  </url>',
  ].join('\n');
}

function buildSitemap(pages) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...pages.map(urlEntry),
    '</urlset>',
  ].join('\n');
}

function buildSitemapIndex() {
  const sitemaps = ['sitemap-core.xml', 'sitemap-blog.xml'];
  const entries  = sitemaps.map(name => [
    '  <sitemap>',
    `    <loc>${BASE_URL}/${name}</loc>`,
    `    <lastmod>${TODAY}</lastmod>`,
    '  </sitemap>',
  ].join('\n'));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    '</sitemapindex>',
  ].join('\n');
}

function write(filename, content) {
  const filepath = path.join(PUBLIC_DIR, filename);
  fs.writeFileSync(filepath, content, 'utf8');
  const lines = content.split('\n').length;
  console.log(`  ✓ public/${filename} (${lines} lines)`);
}

// ── GENERATE ──────────────────────────────────────────────────────────────────
console.log('\n🗺️  Medcompara Sitemap Generator');
console.log(`   BASE_URL : ${BASE_URL}`);
console.log(`   lastmod  : ${TODAY}`);
console.log(`   Output   : repo root/\n`);

if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

// Valida las dos listas antes de escribir nada: o salen los sitemaps completos,
// o no sale ninguno.
validar('sitemap-core.xml', CORE_PAGES);
validar('sitemap-blog.xml', BLOG_PAGES);

write('sitemap-core.xml',  buildSitemap(CORE_PAGES));
write('sitemap-blog.xml',  buildSitemap(BLOG_PAGES));
write('sitemap-index.xml', buildSitemapIndex());

console.log(`\n✅ Done — ${CORE_PAGES.length} core pages, ${BLOG_PAGES.length} blog pages\n`);
