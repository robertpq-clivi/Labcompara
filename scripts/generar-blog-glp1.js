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
const { anclas } = require('./lib/ancla');
const { altDeTitulo } = require('./lib/alt-imagen');
// El índice y las anclas de sección van sobre el HTML ya armado, con la misma
// función que usó la pasada de los artículos escritos a mano.
const { conIndice } = require('./lib/indice-articulo');
const { conTablasScroll } = require('./lib/tabla-movil');
const G    = require('./lib/glp1-blog');

const ROOT  = path.join(__dirname, '..');
const BASE  = 'https://medcompara.com.mx';
// La tarjeta de 1200x630 que escribe scripts/generar-tarjetas-blog.js. Sin
// `image` Google no tiene thumbnail y no arma el rich result — ni de Article
// ni de Product. Si el PNG no existe, la referencia queda colgando: corre
// `node scripts/generar-tarjetas-blog.js --apply` cuando agregues un slug.
const tarjeta = slug => `${BASE}/images/blog/${slug}.png`;
const APPLY = process.argv.includes('--apply');
const SOLO  = (i => (i > -1 ? process.argv[i + 1] : null))(process.argv.indexOf('--solo'));

const HEAD = fs.readFileSync(path.join(__dirname, 'plantillas', 'medicina-head.html'), 'utf8');
const COPY = JSON.parse(fs.readFileSync(path.join(__dirname, 'glp1-blog-copy.json'), 'utf8'));

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

/**
 * Rango de precio ya redactado. Con un solo plan no hay rango que enseñar, y
 * «de $3,499 a $3,499» sería una comparación inventada: en ese caso devuelve
 * la cifra sola y la frase del copy sigue leyéndose bien.
 */
const rango = (a, b) => (a === b ? mxn(a) : `entre ${mxn(a)} y ${mxn(b)}`);

/**
 * Qué vía sale más barata, redactado desde los datos.
 *
 * Es el dato más útil de la página —hoy el plan con consulta incluida queda por
 * debajo de la caja suelta en las cuatro dosis— y justo por eso no puede vivir
 * en el copy: se invierte con una corrida y nadie vuelve a leer la frase.
 */
function comparacionVias(h) {
  if (!h.comparables) return 'todavía no hay farmacia y plan con precio en una misma presentación';
  const total = h.comparables === h.nPresentaciones
    ? `las ${h.comparables} presentaciones`
    : `${h.comparables} de las ${h.nPresentaciones} presentaciones`;
  if (h.planGana === h.comparables) return `el plan mensual queda por debajo de la caja de farmacia en ${total}`;
  if (h.planGana === 0) return `la caja de farmacia queda por debajo del plan mensual en ${total}`;
  return `el plan mensual queda por debajo de la caja en ${h.planGana} de ${total}`;
}

function tokensNuevo(h, c, meta) {
  const i = h.inicial, a = h.alta;
  return {
    FAMILIA: h.familia, ACTIVO: h.activo, VIA: h.via, ENVASE: h.envase,
    CORTO: c.corto,

    MIN: mxn(h.min), MAX: mxn(h.max),

    INICIAL: i.dosis,
    INICIAL_FARMACIA: i.minFarmacia != null ? mxn(i.minFarmacia) : null,
    INICIAL_PLAN: i.minPlan != null ? rango(i.minPlan, i.maxPlan) : null,
    ALTA: a.dosis,
    ALTA_FARMACIA: a.minFarmacia != null ? mxn(a.minFarmacia) : null,
    ALTA_PLAN: a.minPlan != null ? rango(a.minPlan, a.maxPlan) : null,

    N_PRES: h.nPresentaciones,
    N_FARMACIAS: h.nFarmacias, FARMACIAS: h.nFarmacias ? lista(h.farmacias.map(nom)) : null,
    N_PLANES: h.nPlanes, PLANES: h.nPlanes ? lista(h.planes.map(nom)) : null,
    COMPARACION: comparacionVias(h),

    FECHA: meta.fechaLarga, MES: meta.mes, MES_ANIO: meta.mesAnio, ANIO: meta.anio,
  };
}

/**
 * La escalera de dosis con una columna por fuente: primero las farmacias, que
 * venden la caja, y después los planes, que cobran una mensualidad con consulta
 * incluida. Van en la misma tabla porque son las dos formas de conseguirlo,
 * pero el encabezado dice cuál es cuál — el precio de una caja y el de un plan
 * no se comparan de frente sin decirlo.
 */
function tablaNuevoDosis(h) {
  const cols = [...h.farmacias.slice().sort().map(f => ({ f, plan: false })),
                ...h.planes.slice().sort().map(f => ({ f, plan: true }))];
  const enc = cols.map(c => `${esc(nom(c.f))}<br><span class="col-nota">${c.plan ? 'plan al mes' : 'caja'}</span>`);
  return tabla(['Presentación', ...enc], h.filas.map((f, i) =>
    `    <tr><td><strong>${esc(h.familia)} ${esc(f.dosis)}</strong>${i === 0 ? ' <span class="badge-cheap">Dosis de inicio</span>' : ''}</td>`
    + cols.map(({ f: fuente }) => {
        const x = [...f.farmacias, ...f.planes].find(y => y.fuente === fuente);
        if (!x) return '<td>—</td>';
        const bajo = x.precio === f.min;
        return `<td${bajo ? ' style="font-weight:700;color:#059669;"' : ''}>${mxn(x.precio)}</td>`;
      }).join('')
    + '</tr>'));
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
const ESTRUCTURA = ['slug', 'familia', 'corto', 'articulo', 'tipo'];
const OBLIGATORIOS = ['slug', 'familia', 'corto', 'articulo', 'titulo', 'h1', 'metaDescription',
                      'intro', 'respuesta', 'porQueVaria', 'queEs', 'receta', 'elegir', 'faqs'];
// La página de un lanzamiento reciente tiene dos secciones que las otras no:
// dónde se consigue hoy y qué distingue una caja de un plan. Sin ellas la
// plantilla serviría un hueco.
const OBLIGATORIOS_NUEVO = OBLIGATORIOS.concat(['disponibilidad', 'queIncluye']);

/** La página cruzada compara tratamientos, no dosis de uno: su esqueleto cambia. */
function paginaTodas(h, c, todos, meta) {
  const url    = `${BASE}/blog/${c.slug}`;
  const titulo = `${c.titulo} | Medcompara`;

  const head = HEAD
    .replace(/{{TITULO}}/g, esc(titulo))
    .replace(/{{IMAGEN_ALT}}/g, esc(altDeTitulo(titulo)))
    .replace(/{{DESC}}/g, esc(c.metaDescription))
    .replace(/{{URL}}/g, url)
    .replace(/{{IMAGEN}}/g, tarjeta(c.slug))
    .replace('</head>', ESTILO_EXTRA + '\n</head>');

  const bullets = xs => xs.map(x => `    <li>${esc(x)}</li>`).join('\n');
  const otros = todos.filter(o => o.slug !== c.slug).slice(0, 4)
    .map(o => `<a class="related-link" href="/blog/${o.slug}">${esc(o.h1)}</a>`);

  const schema = [
    { '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: c.faqs.map(f => ({ '@type': 'Question', name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
    { '@context': 'https://schema.org', '@type': 'Article',
      headline: c.h1, image: [tarjeta(c.slug)], description: c.metaDescription, url,
      datePublished: meta.fecha, dateModified: meta.fecha, inLanguage: 'es-MX',
      author:    { '@type': 'Organization', name: 'Medcompara', url: BASE },
      publisher: { '@type': 'Organization', name: 'Medcompara', url: BASE, logo: { '@type': 'ImageObject', url: BASE + '/images/logo-medcompara-512.png', width: 512, height: 512 } } },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Inicio', item: BASE + '/' },
        { '@type': 'ListItem', position: 2, name: 'Blog',   item: BASE + '/blog' },
        { '@type': 'ListItem', position: 3, name: c.h1,     item: url },
      ] },
  ].map(s => `<script type="application/ld+json">${JSON.stringify(s)}</script>`).join('\n');

  // El JSON-LD va DENTRO del head: emitirlo después de `${head}` lo dejaba
  // entre </head> y <body>, fuera de los dos.
  const cabeza = head.replace('</head>', `${schema}\n</head>`);

  return `${cabeza}
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
${bloqueFaqs(c.faqs)}
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

/**
 * Página de un medicamento recién llegado: ya se vende en farmacia, pero en
 * muy pocas, y la otra vía de acceso son los planes con seguimiento incluido.
 *
 * No declara `Product` ni `AggregateOffer`. Con una sola farmacia no hay rango
 * de oferta que declarar, y mezclar la mensualidad de un plan dentro de ese
 * rango describiría a Google una oferta que nadie vende: el plan incluye
 * consulta y seguimiento, no es la caja. Es la misma razón por la que el
 * ranking y las guías tampoco lo declaran.
 */
function paginaNuevo(h, c, todos, meta) {
  const url    = `${BASE}/blog/${c.slug}`;
  const titulo = `${c.titulo} | Medcompara`;

  const head = HEAD
    .replace(/{{TITULO}}/g, esc(titulo))
    .replace(/{{IMAGEN_ALT}}/g, esc(altDeTitulo(titulo)))
    .replace(/{{DESC}}/g, esc(c.metaDescription))
    .replace(/{{URL}}/g, url)
    .replace(/{{IMAGEN}}/g, tarjeta(c.slug))
    .replace('</head>', ESTILO_EXTRA + '\n</head>');

  const bullets = xs => xs.map(x => `    <li>${esc(x)}</li>`).join('\n');
  const otros = todos.filter(o => o.slug !== c.slug).slice(0, 4)
    .map(o => `<a class="related-link" href="/blog/${o.slug}">${esc(o.h1)}</a>`);

  const schema = [
    { '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: c.faqs.map(f => ({ '@type': 'Question', name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
    { '@context': 'https://schema.org', '@type': 'Article',
      headline: c.h1, image: [tarjeta(c.slug)], description: c.metaDescription, url,
      datePublished: meta.fecha, dateModified: meta.fecha, inLanguage: 'es-MX',
      author:    { '@type': 'Organization', name: 'Medcompara', url: BASE },
      publisher: { '@type': 'Organization', name: 'Medcompara', url: BASE, logo: { '@type': 'ImageObject', url: BASE + '/images/logo-medcompara-512.png', width: 512, height: 512 } },
      about: { '@type': 'Drug', name: h.familia, activeIngredient: h.activo } },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Inicio', item: BASE + '/' },
        { '@type': 'ListItem', position: 2, name: 'Blog',   item: BASE + '/blog' },
        { '@type': 'ListItem', position: 3, name: c.h1,     item: url },
      ] },
  ].map(x => `<script type="application/ld+json">${JSON.stringify(x)}</script>`).join('\n');

  const cabeza = head.replace('</head>', `${schema}\n</head>`);

  return `${cabeza}
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
  <p>Precios verificados el ${meta.fechaLarga} en ${esc(lista([...h.farmacias, ...h.planes].map(nom)))}. Se revisan con cada scan semanal.</p>
</div>

  <h2>¿Cuánto cuesta ${esc(c.corto)} en México?</h2>
  <p>${esc(c.respuesta)}</p>
${tablaNuevoDosis(h)}
  <p class="fuente-nota">En pesos mexicanos. La columna de farmacia es el precio de la caja; la de un plan es la mensualidad, que además incluye consulta y seguimiento médico. Confirma el precio final y qué entra en el plan antes de comprar o contratar.</p>

  <h2>Dónde se consigue hoy</h2>
  <p>${esc(c.disponibilidad)}</p>

  <h2>Caja de farmacia o plan: qué estás comparando</h2>
  <ul>
${bullets(c.queIncluye)}
  </ul>

  <div class="cta-box">
  <h3>Compara antes de contratar</h3>
  <p>${esc(h.familia)}, dosis por dosis, junto al resto de los GLP-1 y con los precios revisados cada semana.</p>
  <a href="/glp1" class="cta-btn">Comparar en Medcompara →</a>
</div>

  <h2>¿Por qué cambia el precio de un plan a otro?</h2>
  <ul>
${bullets(c.porQueVaria)}
  </ul>

  <h2>¿Necesita receta?</h2>
  <div class="receta-pill">${esc(c.receta.estado)}</div>
  <p>${esc(c.receta.texto)}</p>

  <h2>Qué es y cómo funciona</h2>
  <p>${esc(c.queEs)}</p>

  <h3>Qué revisar antes de contratar</h3>
  <ul>
${bullets(c.elegir)}
  </ul>

  <div class="faq-section">
  <h2>Preguntas frecuentes</h2>
${bloqueFaqs(c.faqs)}
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

  const faltantes = (c.tipo === 'nuevo' ? OBLIGATORIOS_NUEVO : OBLIGATORIOS).filter(k => !c[k]);
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
.price-table th .col-nota{font-weight:400;font-size:11px;opacity:.75;text-transform:none;}
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
      headline: c.h1, image: [tarjeta(c.slug)], description: c.metaDescription, url,
      datePublished: meta.fecha, dateModified: meta.fecha, inLanguage: 'es-MX',
      author:    { '@type': 'Organization', name: 'Medcompara', url: BASE },
      publisher: { '@type': 'Organization', name: 'Medcompara', url: BASE, logo: { '@type': 'ImageObject', url: BASE + '/images/logo-medcompara-512.png', width: 512, height: 512 } },
      about: { '@type': 'Drug', name: h.familia, activeIngredient: h.activo },
    },
    {
      '@context': 'https://schema.org', '@type': 'Product',
      name: `${h.familia} ${h.inicial.dosis} — precio en México`,
      image: [tarjeta(c.slug)],
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
    .replace(/{{IMAGEN_ALT}}/g, esc(altDeTitulo(titulo)))
    .replace(/{{DESC}}/g, esc(c.metaDescription))
    .replace(/{{URL}}/g, url)
    .replace(/{{IMAGEN}}/g, tarjeta(c.slug))
    .replace('</head>', ESTILO_EXTRA + '\n</head>');

  const bullets = xs => xs.map(x => `    <li>${esc(x)}</li>`).join('\n');

  const otros = todos.filter(o => o.slug !== c.slug).slice(0, 4)
    .map(o => `<a class="related-link" href="/blog/${o.slug}">${esc(o.h1)}</a>`);

  // El JSON-LD va DENTRO del head: emitirlo después de `${head}` lo dejaba
  // entre </head> y <body>, fuera de los dos.
  const cabeza = head.replace('</head>', `${schemas(h, c, url, meta)}\n</head>`);

  return `${cabeza}
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
${bloqueFaqs(c.faqs)}
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

// Se recorre TODO el copy aunque `--solo` escriba una sola página: la lista de
// «otros precios de GLP-1» de cada artículo se arma con los demás, así que
// filtrar antes de resolver dejaba la página generada con `--solo` sin ningún
// enlace relacionado. No fallaba nada —salía una página muda, y el bloque
// reaparecía sola en la corrida completa del domingo—, que es justo la clase de
// error que nadie revisa. Sólo abortan la corrida los problemas de las páginas
// que sí se van a escribir; que otra entrada esté rota no debe impedirte
// regenerar la tuya.
for (const c of COPY) {
  const seEscribe = !SOLO || c.slug === SOLO;
  const anotar = (p) => { if (seEscribe) problemas.push(p); };
  const cruzada = c.familia === 'todas';
  const nuevo   = c.tipo === 'nuevo';
  const h = cruzada ? G.hechosTodas(datos)
          : nuevo   ? G.hechosNuevo(c.familia, datos)
          :           G.hechos(c.familia, datos);
  if (!h) { anotar(`${c.slug} → el scan no trae ${c.familia} con presentaciones comparables`); continue; }

  // Cuando la familia junta dos farmacias con precio, la plantilla de
  // lanzamiento se le queda chica: ya hay comparación de mostrador que
  // publicar. No se cambia sola —el copy es otro— pero avisa, que es como se
  // entera quien mira el resumen de la corrida del domingo.
  if (nuevo && G.hechos(c.familia, datos)) {
    console.log(`  ⚠ ${c.slug}: ${c.familia} ya tiene precio en varias farmacias — toca pasarlo a la plantilla estándar`);
  }

  const mapa = cruzada ? tokensTodas(h, c, meta)
             : nuevo   ? tokensNuevo(h, c, meta)
             :           tokens(h, c, meta);
  const errs = validarCopy(c, mapa);
  if (errs.length) { errs.forEach(p => anotar(`${c.slug} → ${p}`)); continue; }

  const r = resolver(c, mapa);
  if (r.metaDescription.length > 155) anotar(`${c.slug} → metaDescription de ${r.metaDescription.length} caracteres`);
  if (r.h1.length > 60)               anotar(`${c.slug} → h1 de ${r.h1.length} caracteres`);
  if (`${r.titulo} | Medcompara`.length > 75) anotar(`${c.slug} → title de ${`${r.titulo} | Medcompara`.length} caracteres`);

  listos.push({ c, h, r, cruzada, nuevo, seEscribe });
}

if (problemas.length) {
  console.error('\nCopy inválido — no se escribió nada:\n');
  problemas.forEach(p => console.error('  ✗ ' + p));
  console.error('\nLas cifras van por token. Ver scripts/generar-blog-glp1.js → tokens().\n');
  process.exit(1);
}

// Los enlaces de «otros» salen de todo el copy resuelto, se escriba o no.
const resueltos = listos.map(x => x.r);

for (const { c, h, r, cruzada, nuevo, seEscribe } of listos) {
  if (!seEscribe) continue;
  const cuerpo = cruzada ? paginaTodas(h, r, resueltos, meta)
               : nuevo   ? paginaNuevo(h, r, resueltos, meta)
               :           pagina(h, r, resueltos, meta);
  const html = conIndice(conTablasScroll(cuerpo));
  if (APPLY) fs.writeFileSync(path.join(ROOT, 'blog', c.slug + '.html'), html);
  const detalle = cruzada ? `${h.nFamilias} tratamientos` : `${h.nPresentaciones} dosis`;
  console.log(`  ${APPLY ? '✓' : '·'} blog/${c.slug}.html  (${(html.length / 1024).toFixed(1)} KB · ${detalle} · desde ${mxn(h.min)})`);
}

const escritos = listos.filter(x => x.seEscribe).length;
console.log(`\n${APPLY ? 'Escritos' : 'Se escribirían'} ${escritos} artículos · scan del ${meta.fechaLarga}`);
if (!APPLY) console.log('(dry-run — usa --apply)');
