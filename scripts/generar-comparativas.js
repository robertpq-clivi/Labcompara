#!/usr/bin/env node
/**
 * Medcompara — Generador de comparativas entre laboratorios.
 *
 * Escribe blog/<a>-vs-<b>-precios.html para los 15 pares posibles.
 * Los precios y los veredictos salen de data/precios.json (scan semanal);
 * el copy cualitativo vive en scripts/comparativas-copy.json.
 *
 * Uso:
 *   node scripts/generar-comparativas.js            (dry-run: qué escribiría)
 *   node scripts/generar-comparativas.js --apply
 *   node scripts/generar-comparativas.js --apply --solo chopo-vs-lapi-precios
 */

const fs   = require('fs');
const path = require('path');
const { anclas } = require('./lib/ancla');
// El índice y las anclas de sección van sobre el HTML ya armado, con la misma
// función que usó la pasada de los artículos escritos a mano.
const { conIndice } = require('./lib/indice-articulo');
const { conTablasScroll } = require('./lib/tabla-movil');
const { pares, hechos, cargarPrecios } = require('./lib/comparativas');

const ROOT  = path.join(__dirname, '..');
const BASE  = 'https://medcompara.com.mx';
// La tarjeta de 1200x630 que escribe scripts/generar-tarjetas-blog.js. Sin
// `image` Google no tiene thumbnail y no arma el rich result — ni de Article
// ni de Product. Si el PNG no existe, la referencia queda colgando: corre
// `node scripts/generar-tarjetas-blog.js --apply` cuando agregues un slug.
const tarjeta = slug => `${BASE}/images/blog/${slug}.png`;
const APPLY = process.argv.includes('--apply');
const SOLO  = (i => i > -1 ? process.argv[i + 1] : null)(process.argv.indexOf('--solo'));

const HEAD = fs.readFileSync(path.join(__dirname, 'plantillas', 'comparativa-head.html'), 'utf8');
const COPY = JSON.parse(fs.readFileSync(path.join(__dirname, 'comparativas-copy.json'), 'utf8'));

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Las preguntas van en <h3> con ancla, no en <div>: un div no entra al esquema
// de encabezados ni puede ser destino de un enlace. El id sale de lib/ancla.js
// para que el ciclo semanal no lo cambie cada domingo.
function bloqueFaqs(faqs) {
  const ids = anclas(faqs.map(f => f.q));
  return faqs.map((f, i) =>
    `  <div class="faq-item"><h3 class="faq-q" id="${ids[i]}">${esc(f.q)}</h3><p class="faq-a">${esc(f.a)}</p></div>`
  ).join('\n');
}

const mxn = n => '$' + Number(n).toLocaleString('es-MX', { maximumFractionDigits: 0 });

/**
 * Cifras que cambian con cada scan. El copy las escribe como {{TOKEN}} y aquí
 * se resuelven; si se escribieran a mano, la prosa diría 324 estudios la semana
 * en que la tabla ya dice 323.
 */
function tokens(h) {
  return {
    // LAB_A/LAB_B respetan el orden del slug y del title; LIDER/PERDEDOR dependen
    // de los precios y se invierten solos cuando el scan cambia de ganador.
    LAB_A:           h.a,
    LAB_B:           h.b,
    LIDER:           h.lider,
    PERDEDOR:        h.lider === h.a ? h.b : h.a,
    COMPARABLES:     h.comparables,
    GANA_A:          h.ganaA,
    GANA_B:          h.ganaB,
    GANA_LIDER:      h.lider === h.a ? h.ganaA : h.ganaB,
    PCT_LIDER:       Math.round((h.lider === h.a ? h.ganaA : h.ganaB) / h.comparables * 100),
    CATALOGO_A:      h.catalogo[h.a],
    CATALOGO_B:      h.catalogo[h.b],
    AHORRO_MEDIANO:  h.ahorroMediano,
    CANASTA_AHORRO:  h.canastaAhorroPct,
    CANASTA_AHORRO_PCT: h.canastaAhorroPct, // alias

    CANASTA_A:       mxn(h.canasta[h.a]),
    CANASTA_B:       mxn(h.canasta[h.b]),
    FILAS:           h.tabla.length,
  };
}

/**
 * El copy no debe traer dígitos escritos a mano: los precios y conteos cambian
 * con cada scan y el texto quedaría contradiciendo a la tabla de su propia
 * página. Todo número va por token. Si esto falla, hay que reescribir el copy,
 * no relajar la regla.
 */
function validarCopy(slug, crudo, resuelto, conocidos) {
  const problemas = [];
  const revisar = (campo, texto) => {
    const s = String(texto);
    for (const m of s.matchAll(/{{([A-Z_]+)}}/g)) {
      if (!conocidos.has(m[1])) problemas.push(`${campo}: token desconocido ${m[0]}`);
    }
    const digitos = s.replace(/{{[A-Z_]+}}/g, '').match(/\d[\d.,]*/g);
    if (digitos) problemas.push(`${campo}: cifra a mano "${digitos.join('", "')}"`);
  };

  revisar('metaDescription', crudo.metaDescription);
  revisar('h1', crudo.h1);
  revisar('intro', crudo.intro);
  revisar('veredicto', crudo.veredicto);
  crudo.cuandoA.forEach((b, i) => revisar(`cuandoA[${i}]`, b));
  crudo.cuandoB.forEach((b, i) => revisar(`cuandoB[${i}]`, b));
  crudo.faqs.forEach((f, i) => { revisar(`faqs[${i}].q`, f.q); revisar(`faqs[${i}].a`, f.a); });

  // La canasta son los estudios de la tabla, no todos los comparables.
  const canastaMal = JSON.stringify(crudo)
    .match(/canasta de {{COMPARABLES}}|{{COMPARABLES}} (?:an[aá]lisis|estudios) comunes/gi);
  if (canastaMal) problemas.push(`la canasta usa {{COMPARABLES}} en vez de {{FILAS}} (${canastaMal.length}x)`);

  // El h1 sigue el orden del slug y del title. Con {{LIDER}} se invertiría solo
  // el día que el scan cambie de ganador, y dejaría de casar con la URL.
  if (/{{LIDER}} vs {{PERDEDOR}}/.test(crudo.h1))
    problemas.push('el h1 usa {{LIDER}} vs {{PERDEDOR}}; debe usar {{LAB_A}} vs {{LAB_B}}');

  // La longitud se mide ya resuelta: es la que verá Google, no la del texto con tokens.
  if (resuelto.metaDescription.length > 155)
    problemas.push(`metaDescription de ${resuelto.metaDescription.length} caracteres ya resuelta`);
  if (resuelto.h1.length > 60)
    problemas.push(`h1 de ${resuelto.h1.length} caracteres ya resuelto`);
  if (crudo.faqs.length !== 4) problemas.push(`${crudo.faqs.length} FAQs en vez de 4`);

  return problemas.map(p => `${slug} → ${p}`);
}

/** Resuelve {{TOKEN}} en cualquier cadena (o en las cadenas de un array). */
function resolver(valor, mapa) {
  if (Array.isArray(valor)) return valor.map(v => resolver(v, mapa));
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, resolver(v, mapa)]));
  }
  if (typeof valor !== 'string') return valor;
  return valor.replace(/{{([A-Z_]+)}}/g, (m, k) => {
    if (!(k in mapa)) throw new Error(`Token desconocido en el copy: ${m}`);
    return mapa[k];
  });
}

// ── Piezas de la página ───────────────────────────────────────────────────────

function tablaPrecios(h) {
  const filas = h.tabla.map(f => {
    const ganaA = f.barato === h.a, ganaB = f.barato === h.b;
    const dif = f.barato
      ? `<span class="badge-cheap">${esc(f.barato)} −${f.ahorroPct}%</span>`
      : 'Mismo precio';
    return `    <tr><td>${esc(f.estudio)}</td>`
      + `<td${ganaA ? ' style="font-weight:700;color:#059669;"' : ''}>${mxn(f[h.a])}</td>`
      + `<td${ganaB ? ' style="font-weight:700;color:#059669;"' : ''}>${mxn(f[h.b])}</td>`
      + `<td>${dif}</td></tr>`;
  }).join('\n');

  return `  <table class="price-table">
    <tr><th>Estudio</th><th>${esc(h.a)}</th><th>${esc(h.b)}</th><th>Diferencia</th></tr>
${filas}
    <tr><td><strong>Total de los ${h.tabla.length}</strong></td>`
    + `<td><strong>${mxn(h.canasta[h.a])}</strong></td>`
    + `<td><strong>${mxn(h.canasta[h.b])}</strong></td>`
    + `<td><span class="badge-cheap">${esc(h.canasta[h.a] < h.canasta[h.b] ? h.a : h.b)} −${h.canastaAhorroPct}%</span></td></tr>
  </table>`;
}

function tablaResumen(h) {
  const perdedor = h.lider === h.a ? h.b : h.a;
  const ganaLider = h.lider === h.a ? h.ganaA : h.ganaB;
  return `  <table class="price-table">
    <tr><th>Criterio</th><th>${esc(h.a)}</th><th>${esc(h.b)}</th></tr>
    <tr><td>Estudios más baratos</td><td>${h.ganaA} de ${h.comparables}</td><td>${h.ganaB} de ${h.comparables}</td></tr>
    <tr><td>Catálogo con precio público</td><td>${h.catalogo[h.a]} estudios</td><td>${h.catalogo[h.b]} estudios</td></tr>
    <tr><td>Canasta de ${h.tabla.length} estudios comunes</td><td>${mxn(h.canasta[h.a])}</td><td>${mxn(h.canasta[h.b])}</td></tr>
    <tr><td>Más barato en conjunto</td><td colspan="2"><strong>${esc(h.lider)}</strong> — gana en ${ganaLider} de ${h.comparables} estudios, con ${h.ahorroMediano}% de ahorro mediano frente a ${esc(perdedor)}</td></tr>
  </table>`;
}

/** Enlaces a las otras comparativas que comparten laboratorio. */
function relacionados(h, todos) {
  const hermanos = todos
    .filter(o => o.slug !== h.slug && (o.a === h.a || o.b === h.a || o.a === h.b || o.b === h.b))
    .slice(0, 4)
    .map(o => `<a class="related-link" href="/blog/${o.slug}">${esc(o.a)} vs ${esc(o.b)}: comparativa de precios</a>`);

  return `  <div class="related-section">
  <h3>📚 Otras comparativas</h3>
  <div class="related-links">${hermanos.join('\n')}
<a class="related-link" href="/blog/mejor-laboratorio-estudios-clinicos-mexico">Mejor laboratorio para estudios clínicos en México</a>
<a class="related-link" href="/blog/laboratorio-mas-barato-cdmx">Laboratorio más barato en CDMX</a></div>
</div>`;
}

function schemas(h, c, url, fecha) {
  const faq = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: c.faqs.map(f => ({
      '@type': 'Question', name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
  const article = {
    '@context': 'https://schema.org', '@type': 'Article',
    headline: c.h1,
    image: [tarjeta(c.slug)],
    description: c.metaDescription,
    url,
    datePublished: fecha,
    dateModified: fecha,
    inLanguage: 'es-MX',
    author:    { '@type': 'Organization', name: 'Medcompara', url: BASE },
    publisher: { '@type': 'Organization', name: 'Medcompara', url: BASE, logo: { '@type': 'ImageObject', url: BASE + '/images/logo-medcompara-512.png', width: 512, height: 512 } },
    about: [h.a, h.b].map(n => ({ '@type': 'MedicalBusiness', name: n })),
  };
  const breadcrumb = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Inicio', item: BASE + '/' },
      { '@type': 'ListItem', position: 2, name: 'Blog',   item: BASE + '/blog' },
      { '@type': 'ListItem', position: 3, name: `${h.a} vs ${h.b}`, item: url },
    ],
  };
  return [faq, article, breadcrumb]
    .map(s => `<script type="application/ld+json">${JSON.stringify(s)}</script>`)
    .join('\n');
}

// ── Página completa ───────────────────────────────────────────────────────────

function pagina(h, c, todos, meta) {
  const url    = `${BASE}/blog/${h.slug}`;
  // El title vende lo que la consulta pregunta. Search Console del semestre:
  // "que es mejor chopo o salud digna" y sus variantes suman 234 impresiones en
  // posición 5 con CERO clics, cayendo en una página cuyo title decía "Precios
  // de Estudios". La pregunta es cuál conviene; el title contestaba cuánto
  // cuesta. Se dice "más barato" y no "mejor" porque esto compara precio, no
  // calidad: prometer lo segundo sería ganar el clic mintiendo.
  const titulo = `${h.a} vs ${h.b}: cuál es más barato en ${meta.mesAnio} | Medcompara`;

  const head = HEAD
    .replace(/{{TITULO}}/g, esc(titulo))
    .replace(/{{DESC}}/g, esc(c.metaDescription))
    .replace(/{{URL}}/g, url)
    .replace(/{{IMAGEN}}/g, tarjeta(c.slug));

  const bullets = xs => xs.map(x => `    <li>${esc(x)}</li>`).join('\n');

  // El JSON-LD va DENTRO del head: emitirlo después de `${head}` lo dejaba
  // entre </head> y <body>, fuera de los dos.
  const cabeza = head.replace('</head>', `${schemas(h, c, url, meta.fecha)}\n</head>`);

  return `${cabeza}
<body>
<nav>
  <a href="/" class="nav-logo">Med<span>compara</span></a>
  <a href="/laboratorio" class="nav-btn">Comparar precios</a>
</nav>
<div class="breadcrumb">
  <a href="/">Inicio</a><span>›</span>
  <a href="/blog">Blog</a><span>›</span>
  ${esc(h.a)} vs ${esc(h.b)}
</div>
<div class="article-wrap">
  <div class="article-eyebrow">Comparativa de laboratorios · México</div>
  <h1>${esc(c.h1)}</h1>
  <p class="article-intro">${esc(c.intro)}</p>

  <div class="info-card">
  <p>Precios verificados el ${meta.fechaLarga} sobre ${h.comparables} estudios que ${esc(h.a)} y ${esc(h.b)} publican en ambos catálogos. Se actualizan cada semana.</p>
</div>

  <h2>Resumen rápido</h2>
${tablaResumen(h)}

  <h2>¿Cuál es más barato, ${esc(h.a)} o ${esc(h.b)}?</h2>
  <p>${esc(c.veredicto)}</p>

  <h2>Comparativa de precios por estudio</h2>
${tablaPrecios(h)}
  <p style="font-size:13px;color:var(--gray-400);">Precios de lista publicados por cada laboratorio, en pesos mexicanos. Pueden variar por sucursal y promoción; confirma el precio final antes de acudir.</p>

  <h2>¿Cuándo conviene ${esc(h.a)}?</h2>
  <ul>
${bullets(c.cuandoA)}
  </ul>

  <h2>¿Cuándo conviene ${esc(h.b)}?</h2>
  <ul>
${bullets(c.cuandoB)}
  </ul>

  <div class="cta-box">
  <h3>Compara los 6 laboratorios, no solo dos</h3>
  <p>${esc(h.a)}, ${esc(h.b)} y cuatro laboratorios más, con precios actualizados cada semana.</p>
  <a href="/laboratorio" class="cta-btn">Comparar en Medcompara →</a>
</div>

  <div class="faq-section">
  <h2>Preguntas frecuentes</h2>
${bloqueFaqs(c.faqs)}
</div>

${relacionados(h, todos)}
</div>
<footer>
  <div class="footer-brand">Medcompara</div>
  <p style="margin-bottom:12px;">Compara precios de estudios de laboratorio en México.</p>
  <div><a href="/">Inicio</a><a href="/blog">Blog</a><a href="/aviso-de-privacidad">Privacidad</a></div>
  <p style="margin-top:16px;font-size:11px;opacity:.5;">Medcompara es un comparador de precios. No somos un laboratorio clínico. Los precios son referenciales y pueden variar. © ${meta.anio} Medcompara.</p>
</footer>
</body></html>
`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const datos = cargarPrecios();
const fechaScan = new Date(datos.generado);
// El mes sale de la fecha del scan y no del reloj: en el title le dice al
// usuario que el precio se verificó hace poco, y estas páginas se regeneran
// cada domingo, así que la promesa se sostiene. Si el scan se cae, el título
// se queda en el mes real de los datos en vez de anunciar uno nuevo.
const meta = {
  fecha: datos.generado.slice(0, 10),
  anio: fechaScan.getFullYear(),
  mesAnio: `${fechaScan.toLocaleDateString('es-MX', { month: 'long' })} ${fechaScan.getFullYear()}`,
  fechaLarga: fechaScan.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }),
};

const todos = pares().map(p => hechos(p, datos));
const porSlug = new Map(COPY.map(c => [c.slug, c]));

let escritos = 0, saltados = [];

// Validar todo antes de escribir nada: mejor no publicar que publicar la mitad.
const problemas = todos
  .filter(h => !SOLO || h.slug === SOLO)
  .flatMap(h => {
    const c = porSlug.get(h.slug);
    if (!c) return [];
    const mapa = tokens(h);
    const conocidos = new Set(Object.keys(mapa));
    // Un token desconocido revienta al resolver, así que eso se reporta aparte.
    const desconocidos = [...JSON.stringify(c).matchAll(/{{([A-Z_]+)}}/g)]
      .map(m => m[1]).filter(k => !conocidos.has(k));
    if (desconocidos.length) return [`${h.slug} → token desconocido: ${[...new Set(desconocidos)].join(', ')}`];
    return validarCopy(h.slug, c, resolver(c, mapa), conocidos);
  });

if (problemas.length) {
  console.error('\nCopy inválido — no se escribió nada:\n');
  problemas.forEach(p => console.error('  ✗ ' + p));
  console.error('\nLas cifras van por token. Ver scripts/generar-comparativas.js → tokens().\n');
  process.exit(1);
}

for (const h of todos) {
  if (SOLO && h.slug !== SOLO) continue;
  const crudo = porSlug.get(h.slug);
  if (!crudo) { saltados.push(h.slug + ' (sin copy)'); continue; }
  const c = resolver(crudo, tokens(h));

  const destino = path.join(ROOT, 'blog', h.slug + '.html');
  const html = conIndice(conTablasScroll(pagina(h, c, todos, meta)));
  if (APPLY) fs.writeFileSync(destino, html);
  escritos++;
  console.log(`  ${APPLY ? '✓' : '·'} blog/${h.slug}.html  (${(html.length / 1024).toFixed(1)} KB · líder: ${h.lider})`);
}

console.log(`\n${APPLY ? 'Escritas' : 'Se escribirían'} ${escritos} comparativas · scan del ${meta.fechaLarga}`);
if (saltados.length) console.log('Sin copy, omitidas:', saltados.join(', '));
if (!APPLY) console.log('(dry-run — usa --apply)');
