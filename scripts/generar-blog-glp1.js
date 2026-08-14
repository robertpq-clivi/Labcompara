#!/usr/bin/env node
/**
 * Medcompara — Generador de artículos de precio de GLP-1.
 *
 * Tercera vertical con el mismo trato: las páginas de precio de Ozempic,
 * Mounjaro y Wegovy citaban cifras escritas a mano mientras
 * data/medicamentos/prices.json se refrescaba cada semana sin que nadie lo
 * leyera.
 *
 * Lo propio de esta vertical: farmacias y planes no van en la misma tabla. Un
 * plan que incluye consulta, seguimiento y estudios no compite por el precio
 * de la caja, y ponerlo en la columna de "más caro" sería mentir por omisión.
 * Se comparan las farmacias entre sí y los planes se listan aparte, diciendo
 * qué incluyen.
 *
 * Uso:
 *   node scripts/generar-blog-glp1.js              (dry-run)
 *   node scripts/generar-blog-glp1.js --apply
 *   node scripts/generar-blog-glp1.js --apply --solo ozempic-precio-mexico
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const G    = require('./lib/glp1-blog');

const ROOT  = path.join(__dirname, '..');
const BASE  = 'https://medcompara.com.mx';
const APPLY = process.argv.includes('--apply');
const SOLO  = (i => (i > -1 ? process.argv[i + 1] : null))(process.argv.indexOf('--solo'));

const HEAD = fs.readFileSync(path.join(__dirname, 'plantillas', 'medicina-head.html'), 'utf8');
const COPY = JSON.parse(fs.readFileSync(path.join(__dirname, 'glp1-blog-copy.json'), 'utf8'));

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const mxn = n => '$' + Math.round(Number(n)).toLocaleString('es-MX');
const nom = f => G.NOMBRE[f] || f;
const lista = xs => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' y ' + xs[xs.length - 1]);

const tabla = (encabezados, filas) => `  <div class="tabla-scroll"><table class="price-table">
    <tr>${encabezados.map(h => `<th>${h}</th>`).join('')}</tr>
${filas.join('\n')}
  </table></div>`;

// ── Tokens ────────────────────────────────────────────────────────────────────

function tokens(h, c, meta) {
  return {
    FAMILIA: h.familia, ACTIVO: h.activo, VIA: h.via, ENVASE: h.envase,
    CORTO: c.corto,

    MIN: mxn(h.min), MAX: mxn(h.max),
    AHORRO_PCT: h.ahorroPct + '%', AHORRO_MEDIANO: h.ahorroMedianoPct + '%',

    INICIAL: h.inicial.dosis,
    INICIAL_MIN: mxn(h.inicial.min), INICIAL_MAX: mxn(h.inicial.max),
    INICIAL_BARATA: nom(h.inicial.barato), INICIAL_AHORRO: h.inicial.ahorroPct + '%',

    N_PRES: h.nPresentaciones,
    N_FARMACIAS: h.nFarmacias, FARMACIAS: lista(h.farmacias.map(nom)),
    N_PLANES: h.nPlanes, PLANES: h.nPlanes ? lista(h.planes.map(nom)) : null,

    LIDER: nom(h.lider), LIDER_GANA: h.liderGana, LIDER_DE: h.liderDe,

    FECHA: meta.fechaLarga, MES: meta.mes, MES_ANIO: meta.mesAnio, ANIO: meta.anio,
  };
}

function tokensTodas(h, c, meta) {
  return {
    CORTO: c.corto,
    MIN: mxn(h.min), MAX: mxn(h.max),
    N_FAMILIAS: h.nFamilias,
    BARATA: h.barata.familia,
    BARATA_MIN: mxn(h.barata.inicioMin), BARATA_MANTENIMIENTO: mxn(h.barata.altaMin),
    N_FARMACIAS: h.farmacias.length, FARMACIAS: lista(h.farmacias.map(nom)),
    FECHA: meta.fechaLarga, MES: meta.mes, MES_ANIO: meta.mesAnio, ANIO: meta.anio,
  };
}

/** Cuánto cuesta empezar y cuánto mantener, familia por familia. */
function tablaTodas(h) {
  return tabla(['Tratamiento', 'Activo', 'Empezar (al mes)', 'Mantenimiento (al mes)'], h.filas.map((f, i) =>
    `    <tr><td><strong>${esc(f.familia)}</strong>${i === 0 ? ' <span class="badge-cheap">💰 Entrada más barata</span>' : ''}</td>`
    + `<td>${esc(f.activo)}</td>`
    + `<td${i === 0 ? ' style="font-weight:700;color:#059669;"' : ''}>${mxn(f.inicioMin)} – ${mxn(f.inicioMax)}</td>`
    + `<td>${mxn(f.altaMin)} – ${mxn(f.altaMax)}</td></tr>`));
}

// ── Validación ────────────────────────────────────────────────────────────────

const CAMPOS_SIN_CIFRAS = ['titulo', 'h1', 'metaDescription', 'intro', 'respuesta'];
const CLINICO = /\d+(?:\.\d+)?(?:\s*(?:,|y|a|\/)\s*\d+(?:\.\d+)?)*\s*(?:mg|ml|semanas?|meses?|horas?)\b/gi;
const ESTRUCTURA = ['slug', 'familia', 'corto', 'articulo'];
const OBLIGATORIOS = ['slug', 'familia', 'corto', 'articulo', 'titulo', 'h1', 'metaDescription',
                      'intro', 'respuesta', 'porQueVaria', 'queEs', 'receta', 'elegir', 'faqs'];

/** La página cruzada compara tratamientos, no dosis de uno: su esqueleto cambia. */
function paginaTodas(h, c, todos, meta) {
  const url    = `${BASE}/blog/${c.slug}`;
  const titulo = `${c.titulo} | Medcompara`;

  const head = HEAD
    .replace(/{{TITULO}}/g, esc(titulo))
    .replace(/{{DESC}}/g, esc(c.metaDescription))
    .replace(/{{URL}}/g, url)
    .replace('</head>', ESTILO_EXTRA + '\n</head>');

  const bullets = xs => xs.map(x => `    <li>${esc(x)}</li>`).join('\n');
  const otros = todos.filter(o => o.slug !== c.slug).slice(0, 4)
    .map(o => `<a class="related-link" href="/blog/${o.slug}">${esc(o.h1)}</a>`);

  const schema = [
    { '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: c.faqs.map(f => ({ '@type': 'Question', name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
    { '@context': 'https://schema.org', '@type': 'Article',
      headline: c.h1, description: c.metaDescription, url,
      datePublished: meta.fecha, dateModified: meta.fecha, inLanguage: 'es-MX',
      publisher: { '@type': 'Organization', name: 'Medcompara', url: BASE } },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Inicio', item: BASE + '/' },
        { '@type': 'ListItem', position: 2, name: 'Blog',   item: BASE + '/blog' },
        { '@type': 'ListItem', position: 3, name: c.h1,     item: url },
      ] },
  ].map(s => `<script type="application/ld+json">${JSON.stringify(s)}</script>`).join('\n');

  return `${head}
${schema}
<body>
<nav>
  <a href="/" class="nav-logo">Med<span>compara</span></a>
  <a href="/glp1" class="nav-btn">Comparar precios</a>
</nav>
<div class="breadcrumb">
  <a href="/">Inicio</a><span>›</span>
  <a href="/blog">Blog</a><span>›</span>
  ${esc(c.h1)}
</div>
<div class="article-wrap">
  <div class="article-eyebrow">Medicamentos GLP-1 · Precio en México</div>
  <h1>${esc(c.h1)}</h1>
  <p class="article-intro">${esc(c.intro)}</p>

  <div class="info-card">
  <p>Precios verificados el ${meta.fechaLarga} en ${esc(lista(h.farmacias.map(nom)))}. Se actualizan con cada scan semanal.</p>
</div>

  <h2>¿Cuánto cuesta al mes cada tratamiento?</h2>
  <p>${esc(c.respuesta)}</p>
${tablaTodas(h)}
  <p class="fuente-nota">Precio de la caja o pluma en farmacia, en pesos mexicanos. No incluye consulta, estudios ni seguimiento. Confirma el precio final antes de comprar.</p>

  <h2>¿Por qué varía tanto el precio?</h2>
  <ul>
${bullets(c.porQueVaria)}
  </ul>

  <div class="cta-box">
  <h3>Compara antes de empezar</h3>
  <p>Los cuatro tratamientos, dosis por dosis, con precios de varias farmacias actualizados cada semana.</p>
  <a href="/glp1" class="cta-btn">Comparar en Medcompara →</a>
</div>

  <h2>¿Necesita receta?</h2>
  <div class="receta-pill">${esc(c.receta.estado)}</div>
  <p>${esc(c.receta.texto)}</p>

  <h2>Qué considerar además del precio</h2>
  <p>${esc(c.queEs)}</p>

  <h3>Qué revisar antes de empezar</h3>
  <ul>
${bullets(c.elegir)}
  </ul>

  <div class="faq-section">
  <h2>Preguntas frecuentes</h2>
${c.faqs.map(f => `  <div class="faq-item"><div class="faq-q">${esc(f.q)}</div><p class="faq-a">${esc(f.a)}</p></div>`).join('\n')}
</div>

  <div class="info-card">
  <p>Esta página compara precios; no sustituye una consulta médica. Los GLP-1 requieren prescripción y supervisión: qué tratamiento corresponde, a qué dosis y por cuánto tiempo lo decide tu médico.</p>
</div>

  <div class="related-section">
  <h3>📚 Otros precios de GLP-1</h3>
  <div class="related-links">${otros.join('\n')}
<a class="related-link" href="/glp1">Comparar todos los GLP-1 entre farmacias</a></div>
</div>
</div>
<footer>
  <div class="footer-brand">Medcompara</div>
  <p style="margin-bottom:12px;">Compara precios de medicamentos, estudios de laboratorio y tratamientos en México.</p>
  <div><a href="/">Inicio</a><a href="/glp1">GLP-1</a><a href="/blog">Blog</a><a href="/aviso-de-privacidad">Privacidad</a></div>
  <p style="margin-top:16px;font-size:11px;opacity:.5;">Medcompara es un comparador de precios. No vendemos medicamentos ni damos consejo médico. Los precios son referenciales y pueden variar. © ${meta.anio} Medcompara.</p>
</footer>
</body></html>
`;
}

function validarCopy(c, mapa) {
  const problemas = [];
  const conocidos = new Set(Object.keys(mapa));

  const revisar = (campo, texto) => {
    for (const t of String(texto).matchAll(/{{([A-Z_]+)}}/g)) {
      if (!conocidos.has(t[1])) problemas.push(`${campo}: token desconocido {{${t[1]}}}`);
      else if (mapa[t[1]] == null) problemas.push(`${campo}: {{${t[1]}}} sin valor`);
    }
    const s = String(texto).replace(/{{[A-Z_]+}}/g, '');
    if (/\$\s*\d/.test(s)) problemas.push(`${campo}: precio escrito a mano`);
    if (/\d\s*%/.test(s))  problemas.push(`${campo}: porcentaje escrito a mano`);
  };

  const recorrer = (campo, v) => {
    if (Array.isArray(v)) return v.forEach((x, i) => recorrer(`${campo}[${i}]`, x));
    if (v && typeof v === 'object') return Object.entries(v).forEach(([k, x]) => recorrer(`${campo}.${k}`, x));
    if (typeof v === 'string') revisar(campo, v);
  };

  Object.entries(c).forEach(([k, v]) => { if (!ESTRUCTURA.includes(k)) recorrer(k, v); });

  for (const campo of CAMPOS_SIN_CIFRAS) {
    const s = String(c[campo] || '').replace(/{{[A-Z_]+}}/g, '').replace(CLINICO, '');
    if (/\d{2,}/.test(s)) problemas.push(`${campo}: cifra a mano fuera de una dosis`);
  }

  const faltantes = OBLIGATORIOS.filter(k => !c[k]);
  if (faltantes.length) problemas.push(`faltan campos: ${faltantes.join(', ')}`);
  if (c.faqs && (c.faqs.length < 4 || c.faqs.length > 6)) problemas.push(`${c.faqs.length} FAQs (van de 4 a 6)`);

  return problemas;
}

function resolver(valor, mapa) {
  if (Array.isArray(valor)) return valor.map(v => resolver(v, mapa));
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, resolver(v, mapa)]));
  }
  if (typeof valor !== 'string') return valor;
  return valor.replace(/{{([A-Z_]+)}}/g, (m, k) => {
    if (mapa[k] == null) throw new Error(`Token sin valor: ${m}`);
    return mapa[k];
  });
}

// ── Tablas ────────────────────────────────────────────────────────────────────

function tablaDosis(h) {
  return tabla(['Presentación', 'Desde', 'Hasta', 'Más barata', 'Diferencia'], h.filas.map(f =>
    `    <tr><td>${esc(h.familia)} ${esc(f.dosis)}</td>`
    + `<td style="font-weight:700;color:#059669;">${mxn(f.min)}</td>`
    + `<td>${mxn(f.max)}</td><td>${esc(nom(f.barato))}</td>`
    + `<td><span class="badge-cheap">−${f.ahorroPct}%</span></td></tr>`));
}

function tablaFarmacias(h) {
  const fila = h.inicial;
  return tabla(['Farmacia', `${esc(h.familia)} ${esc(fila.dosis)}`, 'Sobre la más barata'],
    fila.farmacias.map((x, i) => {
      const p = Math.round(((x.precio - fila.min) / fila.min) * 100);
      return `    <tr><td><strong>${esc(nom(x.fuente))}</strong>${i === 0 ? ' <span class="badge-cheap">💰 Más barata</span>' : ''}</td>`
        + `<td${i === 0 ? ' style="font-weight:700;color:#059669;"' : ''}>${mxn(x.precio)}</td>`
        + `<td>${p === 0 ? '—' : '+' + p + '%'}</td></tr>`;
    }));
}

/**
 * Los planes van en tabla aparte y con su propia columna de "qué incluye": el
 * precio de un plan no es el precio de una caja, y compararlos de frente haría
 * ver caro a quien además pone la consulta.
 */
function tablaPlanes(h) {
  const filas = h.planes.map(p => {
    const precios = h.filas.map(f => (f.planes.find(x => x.fuente === p) || {}).precio).filter(Boolean);
    if (!precios.length) return null;
    return `    <tr><td><strong>${esc(nom(p))}</strong></td>`
      + `<td>${mxn(Math.min(...precios))} – ${mxn(Math.max(...precios))} al mes</td>`
      + '<td>Medicamento, consulta y seguimiento médico incluidos</td></tr>';
  }).filter(Boolean);

  if (!filas.length) return '';
  return `\n  <h2>Planes con seguimiento médico</h2>
  <p>Estas opciones no venden la caja suelta: su precio incluye consulta y acompañamiento, así que no se comparan de frente contra el mostrador de una farmacia.</p>
${tabla(['Plan', 'Precio mensual', 'Qué incluye'], filas)}`;
}

// ── Página ────────────────────────────────────────────────────────────────────

const ESTILO_EXTRA = `<style>
.tabla-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:24px 0;}
.tabla-scroll .price-table{margin:0;min-width:480px;}
.price-table td,.price-table th{white-space:nowrap;}
.price-table td:first-child{white-space:normal;min-width:150px;}
.receta-pill{display:inline-block;background:var(--gray-100);color:var(--navy);border-radius:999px;padding:6px 16px;font-weight:700;font-size:13px;margin-bottom:12px;}
.fuente-nota{font-size:13px;color:var(--gray-400);margin-top:-8px;}
</style>`;

function schemas(h, c, url, meta) {
  const bloques = [
    {
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: c.faqs.map(f => ({
        '@type': 'Question', name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
    {
      '@context': 'https://schema.org', '@type': 'Article',
      headline: c.h1, description: c.metaDescription, url,
      datePublished: meta.fecha, dateModified: meta.fecha, inLanguage: 'es-MX',
      publisher: { '@type': 'Organization', name: 'Medcompara', url: BASE },
      about: { '@type': 'Drug', name: h.familia, activeIngredient: h.activo },
    },
    {
      '@context': 'https://schema.org', '@type': 'Product',
      name: `${h.familia} ${h.inicial.dosis} — precio en México`,
      category: 'Medicamentos GLP-1',
      description: c.metaDescription,
      offers: {
        '@type': 'AggregateOffer', priceCurrency: 'MXN',
        lowPrice: Math.round(h.inicial.min), highPrice: Math.round(h.inicial.max),
        offerCount: h.inicial.farmacias.length, availability: 'https://schema.org/InStock',
      },
    },
    {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Inicio', item: BASE + '/' },
        { '@type': 'ListItem', position: 2, name: 'Blog',   item: BASE + '/blog' },
        { '@type': 'ListItem', position: 3, name: c.h1,     item: url },
      ],
    },
  ];
  return bloques.map(s => `<script type="application/ld+json">${JSON.stringify(s)}</script>`).join('\n');
}

function pagina(h, c, todos, meta) {
  const url    = `${BASE}/blog/${c.slug}`;
  const titulo = `${c.titulo} | Medcompara`;

  const head = HEAD
    .replace(/{{TITULO}}/g, esc(titulo))
    .replace(/{{DESC}}/g, esc(c.metaDescription))
    .replace(/{{URL}}/g, url)
    .replace('</head>', ESTILO_EXTRA + '\n</head>');

  const bullets = xs => xs.map(x => `    <li>${esc(x)}</li>`).join('\n');

  const otros = todos.filter(o => o.slug !== c.slug).slice(0, 4)
    .map(o => `<a class="related-link" href="/blog/${o.slug}">${esc(o.h1)}</a>`);

  return `${head}
${schemas(h, c, url, meta)}
<body>
<nav>
  <a href="/" class="nav-logo">Med<span>compara</span></a>
  <a href="/glp1" class="nav-btn">Comparar precios</a>
</nav>
<div class="breadcrumb">
  <a href="/">Inicio</a><span>›</span>
  <a href="/blog">Blog</a><span>›</span>
  ${esc(c.h1)}
</div>
<div class="article-wrap">
  <div class="article-eyebrow">Medicamentos GLP-1 · Precio en México</div>
  <h1>${esc(c.h1)}</h1>
  <p class="article-intro">${esc(c.intro)}</p>

  <div class="info-card">
  <p>Precios verificados el ${meta.fechaLarga} en ${esc(lista(h.farmacias.map(nom)))}. Se actualizan con cada scan semanal.</p>
</div>

  <h2>¿Cuánto cuesta ${esc(c.articulo)} ${esc(c.corto)} en México?</h2>
  <p>${esc(c.respuesta)}</p>
${tablaFarmacias(h)}

  <h2>Precio de cada dosis</h2>
${tablaDosis(h)}
  <p class="fuente-nota">Precios de lista publicados por cada farmacia, en pesos mexicanos. Pueden variar por sucursal, promoción y existencias; confirma el precio final antes de comprar.</p>
${tablaPlanes(h)}

  <h2>¿Por qué varía tanto el precio?</h2>
  <ul>
${bullets(c.porQueVaria)}
  </ul>

  <div class="cta-box">
  <h3>Compara antes de surtir tu receta</h3>
  <p>${esc(h.familia)}, y los demás GLP-1, con precios de varias farmacias actualizados cada semana.</p>
  <a href="/glp1" class="cta-btn">Comparar en Medcompara →</a>
</div>

  <h2>¿Necesita receta?</h2>
  <div class="receta-pill">${esc(c.receta.estado)}</div>
  <p>${esc(c.receta.texto)}</p>

  <h2>Qué es y cómo funciona</h2>
  <p>${esc(c.queEs)}</p>

  <h3>Qué revisar antes de comprar</h3>
  <ul>
${bullets(c.elegir)}
  </ul>

  <div class="faq-section">
  <h2>Preguntas frecuentes</h2>
${c.faqs.map(f => `  <div class="faq-item"><div class="faq-q">${esc(f.q)}</div><p class="faq-a">${esc(f.a)}</p></div>`).join('\n')}
</div>

  <div class="info-card">
  <p>Esta página compara precios; no sustituye una consulta médica. Los GLP-1 requieren prescripción y supervisión: la indicación, la dosis y el seguimiento los decide tu médico.</p>
</div>

  <div class="related-section">
  <h3>📚 Otros precios de GLP-1</h3>
  <div class="related-links">${otros.join('\n')}
<a class="related-link" href="/glp1">Comparar todos los GLP-1 entre farmacias</a></div>
</div>
</div>
<footer>
  <div class="footer-brand">Medcompara</div>
  <p style="margin-bottom:12px;">Compara precios de medicamentos, estudios de laboratorio y tratamientos en México.</p>
  <div><a href="/">Inicio</a><a href="/glp1">GLP-1</a><a href="/blog">Blog</a><a href="/aviso-de-privacidad">Privacidad</a></div>
  <p style="margin-top:16px;font-size:11px;opacity:.5;">Medcompara es un comparador de precios. No vendemos medicamentos ni damos consejo médico. Los precios son referenciales y pueden variar. © ${meta.anio} Medcompara.</p>
</footer>
</body></html>
`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const datos = G.cargar();
const scan  = new Date(datos.generated_at);
const mes   = scan.toLocaleDateString('es-MX', { month: 'long' });
const meta  = {
  fecha: datos.generated_at.slice(0, 10),
  anio: scan.getFullYear(),
  mes,
  mesAnio: `${mes} ${scan.getFullYear()}`,
  fechaLarga: scan.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }),
};

const problemas = [];
const listos = [];

for (const c of COPY) {
  if (SOLO && c.slug !== SOLO) continue;
  const cruzada = c.familia === 'todas';
  const h = cruzada ? G.hechosTodas(datos) : G.hechos(c.familia, datos);
  if (!h) { problemas.push(`${c.slug} → el scan no trae ${c.familia} con presentaciones comparables`); continue; }

  const mapa = cruzada ? tokensTodas(h, c, meta) : tokens(h, c, meta);
  const errs = validarCopy(c, mapa);
  if (errs.length) { problemas.push(...errs.map(p => `${c.slug} → ${p}`)); continue; }

  const r = resolver(c, mapa);
  if (r.metaDescription.length > 155) problemas.push(`${c.slug} → metaDescription de ${r.metaDescription.length} caracteres`);
  if (r.h1.length > 60)               problemas.push(`${c.slug} → h1 de ${r.h1.length} caracteres`);
  if (`${r.titulo} | Medcompara`.length > 75) problemas.push(`${c.slug} → title de ${`${r.titulo} | Medcompara`.length} caracteres`);

  listos.push({ c, h, r, cruzada });
}

if (problemas.length) {
  console.error('\nCopy inválido — no se escribió nada:\n');
  problemas.forEach(p => console.error('  ✗ ' + p));
  console.error('\nLas cifras van por token. Ver scripts/generar-blog-glp1.js → tokens().\n');
  process.exit(1);
}

const resueltos = listos.map(x => x.r);

for (const { c, h, r, cruzada } of listos) {
  const html = cruzada ? paginaTodas(h, r, resueltos, meta) : pagina(h, r, resueltos, meta);
  if (APPLY) fs.writeFileSync(path.join(ROOT, 'blog', c.slug + '.html'), html);
  const detalle = cruzada ? `${h.nFamilias} tratamientos` : `${h.nPresentaciones} dosis`;
  console.log(`  ${APPLY ? '✓' : '·'} blog/${c.slug}.html  (${(html.length / 1024).toFixed(1)} KB · ${detalle} · desde ${mxn(h.min)})`);
}

console.log(`\n${APPLY ? 'Escritos' : 'Se escribirían'} ${listos.length} artículos · scan del ${meta.fechaLarga}`);
if (!APPLY) console.log('(dry-run — usa --apply)');
