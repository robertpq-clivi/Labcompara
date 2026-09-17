#!/usr/bin/env node
/**
 * Medcompara — Consolida las landings de laboratorio en /laboratorio.
 *
 *   node scripts/consolidar-landings.js            # dry-run
 *   node scripts/consolidar-landings.js --apply
 *
 * Pasada de una sola vez, aquí para que el cambio sea revisable de un vistazo y
 * repetible: toca ~90 archivos y hacerlo a mano garantiza dejar un enlace atrás.
 *
 * POR QUÉ. Ocho páginas —«laboratorio clínico», «laboratorio médico», «análisis
 * clínicos», «estudios clínicos», «estudios de laboratorio», «pruebas de
 * laboratorio», «exámenes de sangre» y «laboratorio de análisis clínicos»— son
 * sinónimos de la misma búsqueda en español de México, y las ocho terminaban
 * mandando al mismo comparador. Es el patrón de permutación de palabra clave
 * que Google llama doorway, y ahí el criterio no es el texto sino el propósito:
 * su contenido resultó distinto entre sí —1% a 12% de solapamiento real de
 * frases, no el 80% que sugería una medición floja— y aun así son ocho puertas
 * a la misma habitación.
 *
 * Tampoco se sostienen por tráfico: entre las ocho suman 134 impresiones y 1
 * clic en 90 días, en posiciones 13 a 55.
 *
 * QUÉ SOBREVIVE. `/laboratorio`, que es la habitación —el comparador con el
 * feed semanal—, y `/laboratorio-cerca-de-mi`, que responde una intención
 * distinta de verdad: dónde, no cuánto.
 *
 * EL ORDEN IMPORTA. Antes de redirigir hay que mover lo que estas páginas
 * sostienen. Search Console dice que la página de referencia con la que Google
 * descubrió el artículo que más rinde —`mejor-laboratorio-estudios-clinicos-mexico`,
 * 15 clics en siete días— es `/laboratorio-clinico`. Si se redirige antes de que
 * `/laboratorio` enlace ese artículo, la consolidación corta el camino por el
 * que llega el poco tráfico que hay.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT } = require('./lib/rutas');

const APLICAR = process.argv.includes('--apply');

/** Las ocho que se consolidan, y a dónde. */
const CIERRAN = [
  'analisis-clinicos',
  'estudios-clinicos',
  'estudios-de-laboratorio',
  'examenes-de-sangre',
  'laboratorio-clinico',
  'laboratorio-de-analisis-clinicos',
  'laboratorio-medico',
  'pruebas-de-laboratorio',
];
const DESTINO = '/laboratorio';

/**
 * Dónde mandar cada enlace interno. El comparador es el destino por defecto,
 * pero un enlace dentro de un artículo que decía «análisis clínicos en México»
 * se lee mejor apuntando a la guía que responde eso, y además reparte el enlace
 * en vez de acumularlo todo en una sola página.
 */
const REEMPLAZOS = {
  'analisis-clinicos':                DESTINO,
  'estudios-clinicos':                DESTINO,
  'estudios-de-laboratorio':          '/blog/estudios-laboratorio-precios-mexico',
  'examenes-de-sangre':               '/blog/guia-completa-examenes-de-sangre',
  'laboratorio-clinico':              '/blog/mejor-laboratorio-estudios-clinicos-mexico',
  'laboratorio-de-analisis-clinicos': DESTINO,
  'laboratorio-medico':               '/blog/mejor-laboratorio-estudios-clinicos-mexico',
  'pruebas-de-laboratorio':           DESTINO,
};

const archivosHtml = () => [
  ...fs.readdirSync(path.join(ROOT, 'blog')).filter(f => f.endsWith('.html')).map(f => `blog/${f}`),
  ...fs.readdirSync(path.join(ROOT, 'pages')).filter(f => f.endsWith('.html')).map(f => `pages/${f}`),
  'index.html',
];

/**
 * Deja un solo enlace por destino dentro de un contenedor.
 *
 * Al redirigir ocho slugs a tres destinos, un bloque de «también te puede
 * interesar» que enlazaba cuatro de ellas acaba con cuatro enlaces idénticos.
 * Se conserva el primero de cada destino.
 */
function deduplicar(html, claseContenedor) {
  const re = new RegExp(`(<div class="${claseContenedor}">)([\\s\\S]*?)(</div>)`, 'g');
  return html.replace(re, (todo, abre, dentro, cierra) => {
    const vistos = new Set();
    const limpio = dentro.replace(/<a\b[^>]*href="([^"]+)"[^>]*>[\s\S]*?<\/a>/g, (enlace, href) => {
      if (vistos.has(href)) return '';
      vistos.add(href);
      return enlace;
    });
    return abre + limpio + cierra;
  });
}

function main() {
  const tocados = [];
  let enlaces = 0;

  for (const rel of archivosHtml()) {
    const ruta = path.join(ROOT, rel);
    const antes = fs.readFileSync(ruta, 'utf8');
    let html = antes;

    for (const slug of CIERRAN) {
      const re = new RegExp(`href="/${slug}"`, 'g');
      const n = (html.match(re) || []).length;
      if (!n) continue;
      enlaces += n;
      html = html.replace(re, `href="${REEMPLAZOS[slug]}"`);
    }

    if (html !== antes) {
      for (const clase of ['related-links', 'footer-nav', 'nav-links']) html = deduplicar(html, clase);
      tocados.push(rel);
      if (APLICAR) fs.writeFileSync(ruta, html);
    }
  }

  // Los archivos que dejan de publicarse. Se borran en vez de quedarse sin
  // enlazar: un archivo que nadie enlaza pero que sigue respondiendo 200 es una
  // página huérfana, no una página retirada.
  const borrados = [];
  for (const slug of CIERRAN) {
    const ruta = path.join(ROOT, 'pages', `${slug}.html`);
    if (!fs.existsSync(ruta)) continue;
    borrados.push(`pages/${slug}.html`);
    if (APLICAR) fs.unlinkSync(ruta);
  }

  console.log(`${APLICAR ? 'Reescritos' : 'Se reescribirían'} ${enlaces} enlaces en ${tocados.length} archivos`);
  console.log(`${APLICAR ? 'Borradas' : 'Se borrarían'} ${borrados.length} páginas:`);
  borrados.forEach(b => console.log(`  ${APLICAR ? '✓' : '·'} ${b}`));
  console.log('\nFalta a mano: los redirects de vercel.json y CORE_PAGES en generate-sitemaps.js.');
  if (!APLICAR) console.log('(dry-run — usa --apply)');
}

main();
