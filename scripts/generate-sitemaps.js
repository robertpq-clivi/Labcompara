#!/usr/bin/env node
/**
 * Medcompara — Sitemap Generator
 * Generates: sitemap-core.xml, sitemap-estudios.xml, sitemap-blog.xml, sitemap-index.xml
 *
 * Usage:
 *   node scripts/generate-sitemaps.js
 *   npm run generate:sitemaps
 *
 * To add pages: edit CORE_PAGES or ESTUDIOS_PAGES arrays below.
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
  { path: '/medicamentos',                      priority: '1.0', changefreq: 'weekly'  },
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

// ── ESTUDIOS PAGES ────────────────────────────────────────────────────────────
// changefreq: monthly | priority: 0.8
const ESTUDIOS_PAGES = [
  { path: '/blog/precio-biometria-hematica-mexico'           },
  { path: '/blog/precio-quimica-sanguinea-mexico'            },
  { path: '/blog/examen-de-glucosa-precio-mexico'            },
  { path: '/blog/colesterol-total-precio-mexico'             },
  { path: '/blog/perfil-tiroideo-precio-mexico'              },
  { path: '/blog/prueba-de-embarazo-en-sangre-precio-mexico' },
  { path: '/blog/check-up-completo-precio-mexico'            },
  { path: '/blog/examen-general-de-orina-precio-mexico'      },
  { path: '/blog/acido-urico-precio-mexico'                  },
  { path: '/blog/creatinina-precio-mexico'                   },
  { path: '/blog/pruebas-de-funcion-hepatica-precio-mexico'  },
  { path: '/blog/perfil-lipidico-precio-mexico'              },
  { path: '/blog/examen-de-insulina-precio-mexico'           },
  { path: '/blog/hemoglobina-glucosilada-precio-mexico'      },
  { path: '/blog/vitamina-d-precio-mexico'                   },
  { path: '/blog/prueba-de-vih-precio-mexico'                },
  { path: '/blog/testosterona-precio-mexico'                 },
  { path: '/blog/perfil-hormonal-femenino-precio-mexico'     },
  { path: '/blog/examen-de-sangre-completo-precio-mexico'    },
  { path: '/blog/cuanto-cuesta-un-check-up-en-mexico'        },
].map(p => ({ ...p, priority: '0.8', changefreq: 'monthly' }));

// ── BLOG ──────────────────────────────────────────────────────────────────────
// Se lee del directorio en vez de mantener una lista a mano: la versión anterior
// declaraba 30 URLs mientras el blog tenía 48 posts, así que 47 de ellos nunca
// se le enviaron a Google.
const BLOG_DIR = path.join(__dirname, '..', 'blog');
const BLOG_PAGES = fs.existsSync(BLOG_DIR)
  ? fs.readdirSync(BLOG_DIR)
      .filter(f => f.endsWith('.html') && f !== 'index.html')
      .sort()
      .map(f => ({ path: '/blog/' + f.replace(/\.html$/, ''), priority: '0.7', changefreq: 'monthly' }))
  : [];


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
  const sitemaps = ['sitemap-core.xml', 'sitemap-estudios.xml', 'sitemap-blog.xml'];
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

write('sitemap-core.xml',     buildSitemap(CORE_PAGES));
write('sitemap-estudios.xml', buildSitemap(ESTUDIOS_PAGES));
write('sitemap-blog.xml', buildSitemap(BLOG_PAGES));
write('sitemap-index.xml',    buildSitemapIndex());

console.log(`\n✅ Done — ${CORE_PAGES.length} core pages, ${ESTUDIOS_PAGES.length} estudio pages\n`);
