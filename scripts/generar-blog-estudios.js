#!/usr/bin/env node
/**
 * Medcompara — Generador de artículos de precio de la vertical de laboratorio.
 *
 * Reescribe con datos del scan las páginas de precio que se habían quedado
 * escritas a mano en 2024. No es un cambio de copy: la de biometría hemática
 * anunciaba "desde $95" y cotizaba $491 a un laboratorio que hoy cobra $215,
 * en la página con más intención de compra del blog.
 *
 * Cuatro tipos de página, un mismo esqueleto:
 *   estudio  — un estudio comparado entre laboratorios
 *   canasta  — un check up: varios estudios sumados por laboratorio
 *   ranking  — quién es más barato, medido sobre todo el catálogo
 *   guia     — tabla de referencia de los estudios más pedidos
 *
 * El copy vive en scripts/estudios-blog-copy.json y no lleva un solo dígito de
 * precio escrito a mano: todo va por {{TOKEN}} y el validador se niega a
 * publicar si encuentra uno.
 *
 * Uso:
 *   node scripts/generar-blog-estudios.js              (dry-run)
 *   node scripts/generar-blog-estudios.js --apply
 *   node scripts/generar-blog-estudios.js --apply --solo precio-glucosa-mexico
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { anclas } = require('./lib/ancla');
const E    = require('./lib/estudios-blog');
const { DESTACADOS } = require('./lib/comparativas');

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
const COPY = JSON.parse(fs.readFileSync(path.join(__dirname, 'estudios-blog-copy.json'), 'utf8'));

// ── Formato ───────────────────────────────────────────────────────────────────

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

/** Los laboratorios publican centavos; en prosa y en tabla solo estorban. */
const mxn = n => '$' + Math.round(Number(n)).toLocaleString('es-MX');

const lab = l => E.NOMBRE_LAB[l] || l;

const lista = xs => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' y ' + xs[xs.length - 1]);

const tabla = (encabezados, filas) => `  <div class="tabla-scroll"><table class="price-table">
    <tr>${encabezados.map(h => `<th>${h}</th>`).join('')}</tr>
${filas.join('\n')}
  </table></div>`;

// ── Tokens por tipo ───────────────────────────────────────────────────────────

const comunes = (c, meta) => ({
  CORTO:    c.corto,
  CIUDAD:   c.ciudad || 'México',
  FECHA:    meta.fechaLarga,
  MES:      meta.mes,
  MES_ANIO: meta.mesAnio,
  ANIO:     meta.anio,
});

const tokens = {
  estudio: (d, c, meta) => ({
    ...comunes(c, meta),
    ESTUDIO: d.estudio,
    MIN: mxn(d.min), MAX: mxn(d.max), MEDIANA: mxn(d.mediana),
    BARATO: lab(d.barato), CARO: lab(d.caro),
    AHORRO_PCT: d.ahorroPct + '%', VECES: String(d.veces),
    N_LABS: d.nLabs, LABS: lista(d.labs.map(x => lab(x.lab))),
  }),

  canasta: (d, c, meta) => ({
    ...comunes(c, meta),
    MIN: mxn(d.min), MAX: mxn(d.max),
    BARATO: lab(d.barato), CARO: lab(d.caro),
    AHORRO_PCT: d.ahorroPct + '%',
    N_LABS: d.nLabs, N_ESTUDIOS: d.nEstudios,
    ESTUDIOS: lista(d.estudios.map(e => e.estudio)),
    LABS: lista(d.labs.map(lab)),
  }),

  ranking: (d, c, meta) => ({
    ...comunes(c, meta),
    COMPARABLES: d.comparables,
    LIDER: lab(d.lider.lab), LIDER_GANA: d.lider.gana, LIDER_PCT: d.lider.pct + '%',
    N_LABS: d.tabla.length,
  }),

  labs: (d, c, meta) => {
    const catalogo = [...d.ranking.tabla].sort((a, b) => b.catalogo - a.catalogo)[0];
    return {
      ...comunes(c, meta),
      COMPARABLES: d.ranking.comparables,
      LIDER: lab(d.ranking.lider.lab),
      LIDER_GANA: d.ranking.lider.gana,
      LIDER_PCT: d.ranking.lider.pct + '%',
      CATALOGO_LIDER:   lab(catalogo.lab),
      CATALOGO_LIDER_N: catalogo.catalogo,
      CATALOGO_MIN_N:   d.ranking.lider.catalogo,
      CANASTA_MIN: mxn(d.canasta.min), CANASTA_MAX: mxn(d.canasta.max),
      CANASTA_BARATO: lab(d.canasta.barato), CANASTA_AHORRO: d.canasta.ahorroPct + '%',
      N_ESTUDIOS_CANASTA: d.canasta.nEstudios,
      N_LABS: d.ranking.tabla.length,
    };
  },

  guia: (d, c, meta) => ({
    ...comunes(c, meta),
    N_LABS: d.nLabs,
    N_ESTUDIOS: d.filas.length,
  }),
};

// ── Validación ────────────────────────────────────────────────────────────────

const CAMPOS_SIN_CIFRAS = ['titulo', 'h1', 'metaDescription', 'intro', 'respuesta'];

/**
 * Lo que sí puede llevar dígitos: unidades clínicas y nombres de panel. Se
 * admiten enumeraciones y rangos ("de 6, 27 y 35 elementos", "de 9 a 12
 * horas") y los nombres químicos con cifra ("25-hidroxi"), porque el número
 * solo tiene sentido pegado a lo que nombra, y nada de eso es un peso.
 */
const CLINICO = /\d+(?:\.\d+)?(?:\s*(?:,|y|a)\s*\d+(?:\.\d+)?)*[\s-]*(?:mg\/dL|mg|ml|horas?|años|elementos|hidroxi|dihidroxi)\b/gi;

/** Campos que describen la estructura de la página, no su prosa. */
const ESTRUCTURA = ['tipo', 'slug', 'estudio', 'corto', 'articulo', 'ciudad', 'tambien', 'canasta', 'canastaTambien'];

const OBLIGATORIOS = ['tipo', 'slug', 'corto', 'titulo', 'h1', 'metaDescription', 'intro',
                      'respuesta', 'porQueVaria', 'queEs', 'preparacion', 'elegir', 'faqs'];

/** Campos que solo existen en algunos tipos y no llevan prosa que validar. */
const ESTRUCTURA_EXTRA = ['laboratorios'];

function validarCopy(c, mapa) {
  const problemas = [];
  const conocidos = new Set(Object.keys(mapa));

  const revisar = (campo, texto) => {
    for (const t of String(texto).matchAll(/{{([A-Z_]+)}}/g)) {
      if (!conocidos.has(t[1])) problemas.push(`${campo}: token desconocido {{${t[1]}}}`);
      else if (mapa[t[1]] == null) problemas.push(`${campo}: {{${t[1]}}} sin valor`);
    }
    // Precios y porcentajes nunca a mano: cambian con cada scan y dejarían al
    // texto contradiciendo a la tabla de su propia página.
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
    if (/\d{2,}/.test(s)) problemas.push(`${campo}: cifra a mano fuera de una unidad clínica`);
  }

  const faltantes = OBLIGATORIOS.filter(k => !c[k]);
  if (faltantes.length) problemas.push(`faltan campos: ${faltantes.join(', ')}`);
  if (c.faqs && (c.faqs.length < 4 || c.faqs.length > 6)) problemas.push(`${c.faqs.length} FAQs (van de 4 a 6)`);

  return problemas;
}

function validarResuelto(c, titulo) {
  const p = [];
  if (c.metaDescription.length > 155) p.push(`metaDescription de ${c.metaDescription.length} caracteres`);
  // El h1 se mantiene corto por costumbre, no por regla: no es factor de
  // ranking. El de la comparativa de laboratorios llega a 61 porque repite
  // literal la consulta que la trae ("mejor laboratorio de análisis clínicos
  // en méxico", 116 impresiones), y recortarla para cumplir un número propio
  // sería romper lo que funciona.
  if (c.h1.length > 65)               p.push(`h1 de ${c.h1.length} caracteres`);
  if (titulo.length > 75)             p.push(`title de ${titulo.length} caracteres`);
  return p;
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

/** Cuánto de más pagas aquí frente al más barato. */
const sobreprecio = (precio, min) => {
  const p = Math.round(((precio - min) / min) * 100);
  return p === 0 ? '—' : `+${p}%`;
};

function tablaLabs(d) {
  return tabla(['Laboratorio', 'Precio', 'Sobre el más barato'], d.labs.map((x, i) =>
    `    <tr><td><strong>${esc(lab(x.lab))}</strong>${i === 0 ? ' <span class="badge-cheap">💰 Más barato</span>' : ''}</td>`
    + `<td${i === 0 ? ' style="font-weight:700;color:#059669;"' : ''}>${mxn(x.precio)}</td>`
    + `<td>${sobreprecio(x.precio, d.min)}</td></tr>`));
}

function tablaResumen(d, c) {
  const filas = [
    ['Precio más bajo hoy', `<strong style="color:#059669;">${mxn(d.min)}</strong> en ${esc(lab(d.barato))}`],
    ['Precio más alto', `${mxn(d.max)} en ${esc(lab(d.caro))}`],
    ['Mediana del mercado', mxn(d.mediana)],
    ['Diferencia entre extremos', `<span class="badge-cheap">−${d.ahorroPct}%</span> · ${d.veces} veces`],
    ['Laboratorios comparados', `${d.nLabs} con precio público`],
  ];
  const titulo = c.corto.charAt(0).toUpperCase() + c.corto.slice(1);
  return tabla(['Dato', esc(titulo)], filas.map(([a, b]) => `    <tr><td>${a}</td><td>${b}</td></tr>`));
}

/** Versiones hermanas del mismo estudio (la química de 6, 27 y 35). */
function tablaVersiones(principal, otras) {
  return tabla(['Versión', 'Desde', 'Hasta', 'Más barato', 'Diferencia'],
    [principal, ...otras].map(d =>
      `    <tr><td>${esc(d.estudio)}</td>`
      + `<td style="font-weight:700;color:#059669;">${mxn(d.min)}</td>`
      + `<td>${mxn(d.max)}</td><td>${esc(lab(d.barato))}</td>`
      + `<td><span class="badge-cheap">−${d.ahorroPct}%</span></td></tr>`));
}

function tablaCanastaTotal(d, nombre) {
  return tabla([esc(nombre), 'Total', 'Sobre el más barato'], d.total.map((t, i) =>
    `    <tr><td><strong>${esc(lab(t.lab))}</strong>${i === 0 ? ' <span class="badge-cheap">💰 Más barato</span>' : ''}</td>`
    + `<td${i === 0 ? ' style="font-weight:700;color:#059669;"' : ''}>${mxn(t.precio)}</td>`
    + `<td>${sobreprecio(t.precio, d.min)}</td></tr>`));
}

function tablaCanastaDesglose(d) {
  return tabla(['Estudio', 'Desde', 'Hasta', 'Más barato', 'Diferencia'], d.estudios.map(e =>
    `    <tr><td>${esc(e.estudio)}</td>`
    + `<td style="font-weight:700;color:#059669;">${mxn(e.min)}</td>`
    + `<td>${mxn(e.max)}</td><td>${esc(lab(e.barato))}</td>`
    + `<td><span class="badge-cheap">−${e.ahorroPct}%</span></td></tr>`));
}

function tablaRanking(d) {
  return tabla(['Laboratorio', 'Estudios donde es el más barato', 'Catálogo con precio público'],
    d.tabla.map((t, i) =>
      `    <tr><td><strong>${esc(lab(t.lab))}</strong>${i === 0 ? ' <span class="badge-cheap">💰 Gana más veces</span>' : ''}</td>`
      + `<td${i === 0 ? ' style="font-weight:700;color:#059669;"' : ''}>${t.gana} de ${d.comparables} (${t.pct}%)</td>`
      + `<td>${t.catalogo} estudios</td></tr>`));
}

function tablaGuia(d) {
  return tabla(['Estudio', 'Desde', 'Hasta', 'Más barato', 'Diferencia'], d.filas.map(f =>
    `    <tr><td>${esc(f.estudio)}</td>`
    + `<td style="font-weight:700;color:#059669;">${mxn(f.min)}</td>`
    + `<td>${mxn(f.max)}</td><td>${esc(lab(f.barato))}</td>`
    + `<td><span class="badge-cheap">−${f.ahorroPct}%</span></td></tr>`));
}

/**
 * Las fichas de cada laboratorio, con su cifra real dentro. La versión escrita
 * a mano afirmaba que LAPI tenía "precios más elevados" cuando el scan dice
 * que es el segundo que más veces gana en precio, y con el catálogo más
 * amplio de los seis. Una ficha cualitativa sin dato al lado envejece hacia
 * la afirmación cómoda, no hacia la verdadera.
 */
function fichasLabs(d, c) {
  const porLab = Object.fromEntries(d.ranking.tabla.map(t => [t.lab, t]));
  const canasta = Object.fromEntries(d.canasta.total.map(t => [t.lab, t.precio]));

  return c.laboratorios.map(f => {
    const t = porLab[f.lab];
    if (!t) return '';
    const cifras = [
      `Más barato en <strong>${t.gana} de ${d.ranking.comparables}</strong> estudios (${t.pct}%)`,
      `<strong>${t.catalogo}</strong> estudios con precio público`,
      canasta[f.lab] ? `Canasta de chequeo: <strong>${mxn(canasta[f.lab])}</strong>` : null,
    ].filter(Boolean).join(' · ');

    return `  <h3>${f.emoji} ${esc(lab(f.lab))} — ${esc(f.titular)}</h3>
  <p class="fuente-nota">${cifras}</p>
  <p>${esc(f.texto)}</p>
  <ul>
${f.pro.map(x => `    <li>✅ ${esc(x)}</li>`).join('\n')}
${f.contra.map(x => `    <li>❌ ${esc(x)}</li>`).join('\n')}
  </ul>`;
  }).join('\n\n');
}

// ── Página ────────────────────────────────────────────────────────────────────

function relacionados(c, todos) {
  const otros = todos
    .filter(o => o.slug !== c.slug && o.corto !== c.corto)
    .slice(0, 4)
    .map(o => `<a class="related-link" href="/blog/${o.slug}">${esc(o.h1.replace(/[¿?]/g, ''))}</a>`);

  return `  <div class="related-section">
  <h3>📚 Otros precios de laboratorio</h3>
  <div class="related-links">${otros.join('\n')}
<a class="related-link" href="/laboratorio">Comparar todos los estudios entre laboratorios</a></div>
</div>`;
}

function schemas(c, url, meta, oferta) {
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
      publisher: { '@type': 'Organization', name: 'Medcompara', url: BASE },
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

  // El rango de precio del resultado de Google sale de aquí: son ofertas
  // reales de laboratorios distintos por lo mismo, que es lo que
  // AggregateOffer describe. Las páginas sin un precio único —el ranking, la
  // guía— no lo declaran: inventarles un rango sería describir algo que nadie
  // vende como tal.
  if (oferta) {
    bloques.push({
      '@context': 'https://schema.org', '@type': 'Product',
      name: oferta.nombre, image: [tarjeta(c.slug)], category: 'Estudios de laboratorio',
      description: c.metaDescription,
      offers: {
        '@type': 'AggregateOffer', priceCurrency: 'MXN',
        lowPrice: Math.round(oferta.min), highPrice: Math.round(oferta.max),
        offerCount: oferta.n, availability: 'https://schema.org/InStock',
      },
    });
  }

  return bloques.map(s => `<script type="application/ld+json">${JSON.stringify(s)}</script>`).join('\n');
}

const ESTILO_EXTRA = `<style>
.tabla-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:24px 0;}
.tabla-scroll .price-table{margin:0;min-width:480px;}
.price-table td,.price-table th{white-space:nowrap;}
.price-table td:first-child{white-space:normal;min-width:150px;}
.fuente-nota{font-size:13px;color:var(--gray-400);margin-top:-8px;}
</style>`;

/**
 * El esqueleto es el mismo para los cuatro tipos: la respuesta arriba, las
 * tablas, por qué varía, el CTA, y sólo después el contenido de fondo. Lo que
 * cambia entre tipos son las tablas y de dónde sale el "verificado el".
 */
function pagina({ c, meta, todos, fuente, tablas, h2Precio, cta, oferta, eyebrow }) {
  const url    = `${BASE}/blog/${c.slug}`;
  const titulo = `${c.titulo} | Medcompara`;
  const donde  = c.ciudad || 'México';

  const head = HEAD
    .replace(/{{TITULO}}/g, esc(titulo))
    .replace(/{{DESC}}/g, esc(c.metaDescription))
    .replace(/{{URL}}/g, url)
    .replace(/{{IMAGEN}}/g, tarjeta(c.slug))
    .replace('</head>', ESTILO_EXTRA + '\n</head>');

  const bullets = xs => xs.map(x => `    <li>${esc(x)}</li>`).join('\n');

  return `${head}
${schemas(c, url, meta, oferta)}
<body>
<nav>
  <a href="/" class="nav-logo">Med<span>compara</span></a>
  <a href="/laboratorio" class="nav-btn">Comparar precios</a>
</nav>
<div class="breadcrumb">
  <a href="/">Inicio</a><span>›</span>
  <a href="/blog">Blog</a><span>›</span>
  ${esc(c.h1)}
</div>
<div class="article-wrap">
  <div class="article-eyebrow">${esc(eyebrow || `Estudios de laboratorio · Precio en ${donde}`)}</div>
  <h1>${esc(c.h1)}</h1>
  <p class="article-intro">${esc(c.intro)}</p>

  <div class="info-card">
  <p>${esc(fuente)}</p>
</div>

  <h2>${esc(h2Precio)}</h2>
  <p>${esc(c.respuesta)}</p>
${tablas.join('\n')}
  <p class="fuente-nota">Precios de lista publicados por cada laboratorio, en pesos mexicanos. Pueden variar por sucursal, promoción y convenio; confirma el precio final antes de acudir.</p>

  <h2>¿Por qué varía tanto el precio?</h2>
  <ul>
${bullets(c.porQueVaria)}
  </ul>

  <div class="cta-box">
  <h3>${esc(cta.titulo)}</h3>
  <p>${esc(cta.texto)}</p>
  <a href="/laboratorio" class="cta-btn">Comparar en Medcompara →</a>
</div>

  <h2>Qué es y para qué sirve</h2>
  <p>${esc(c.queEs)}</p>

  <h3>Cómo prepararte</h3>
  <p>${esc(c.preparacion)}</p>

  <h3>Qué revisar antes de elegir laboratorio</h3>
  <ul>
${bullets(c.elegir)}
  </ul>

  <div class="faq-section">
  <h2>Preguntas frecuentes</h2>
${bloqueFaqs(c.faqs)}
</div>

  <div class="info-card">
  <p>Esta página compara precios; no sustituye una consulta médica. La indicación y la interpretación de cualquier estudio las hace tu médico.</p>
</div>

${relacionados(c, todos)}
</div>
<footer>
  <div class="footer-brand">Medcompara</div>
  <p style="margin-bottom:12px;">Compara precios de estudios de laboratorio, medicinas y tratamientos en México.</p>
  <div><a href="/">Inicio</a><a href="/laboratorio">Laboratorios</a><a href="/blog">Blog</a><a href="/aviso-de-privacidad">Privacidad</a></div>
  <p style="margin-top:16px;font-size:11px;opacity:.5;">Medcompara es un comparador de precios. No somos un laboratorio clínico. Los precios son referenciales y pueden variar. © ${meta.anio} Medcompara.</p>
</footer>
</body></html>
`;
}

// ── Hechos y armado por tipo ──────────────────────────────────────────────────

/** Devuelve null cuando el scan no alcanza para publicar honestamente. */
function hechosDe(c, datos) {
  if (c.tipo === 'estudio') return E.hechos(c.estudio, datos);
  if (c.tipo === 'canasta') return E.hechosCanasta(c.canasta.estudios, datos);
  if (c.tipo === 'ranking') return E.ranking(datos);
  if (c.tipo === 'labs') {
    const ranking = E.ranking(datos);
    const canasta = E.hechosCanasta(c.canasta.estudios, datos);
    return ranking && canasta ? { ranking, canasta } : null;
  }
  if (c.tipo === 'guia') {
    const filas = DESTACADOS.map(n => E.hechos(n, datos)).filter(Boolean);
    if (filas.length < 5) return null;
    const nLabs = new Set(filas.flatMap(f => f.labs.map(x => x.lab))).size;
    return { filas, nLabs, generado: datos.generado };
  }
  return null;
}

function armar(c, d, meta, datos, todos) {
  const donde = c.ciudad || 'México';

  if (c.tipo === 'estudio') {
    const versiones = (c.tambien || []).map(n => E.hechos(n, datos)).filter(Boolean);
    const tablas = [tablaResumen(d, c), '\n  <h2>Precio por laboratorio</h2>', tablaLabs(d)];
    if (versiones.length) {
      tablas.push('\n  <h2>¿Cuál versión necesitas y cuánto cuesta cada una?</h2>',
        '  <p>El número de elementos cambia el precio, pero la diferencia entre laboratorios suele ser mayor que la que hay entre versiones.</p>',
        tablaVersiones(d, versiones));
    }
    return pagina({
      c, meta, todos, tablas,
      fuente: `Precios verificados el ${meta.fechaLarga} en ${lista(d.labs.map(x => lab(x.lab)))}. Se actualizan con cada scan semanal.`,
      h2Precio: `¿Cuánto cuesta ${c.articulo} ${c.corto} en ${donde}?`,
      cta: { titulo: `Compara los ${d.nLabs} laboratorios antes de ir`,
             texto: `${d.estudio} y cientos de estudios más, con precios actualizados cada semana.` },
      oferta: { nombre: `${d.estudio} — precio en ${donde}`, min: d.min, max: d.max, n: d.nLabs },
    });
  }

  if (c.tipo === 'canasta') {
    const tablas = [tablaCanastaTotal(d, c.canasta.nombre),
      '\n  <h2>Qué incluye y cuánto cuesta cada estudio</h2>', tablaCanastaDesglose(d)];

    const otra = c.canastaTambien && E.hechosCanasta(c.canastaTambien.estudios, datos);
    if (otra) {
      const extra = c.canastaTambien.estudios.filter(e => !c.canasta.estudios.includes(e));
      tablas.push(`\n  <h2>${esc(c.canastaTambien.nombre)}: cuánto sube</h2>`,
        `  <p>La versión ampliada añade ${esc(lista(extra))}.</p>`,
        tablaCanastaTotal(otra, c.canastaTambien.nombre));
    }

    return pagina({
      c, meta, todos, tablas,
      fuente: `Precios verificados el ${meta.fechaLarga} en los ${d.nLabs} laboratorios que publican precio de los ${d.nEstudios} estudios de la canasta. Se actualizan con cada scan semanal.`,
      h2Precio: `¿Cuánto cuesta ${c.articulo} ${c.corto} en ${donde}?`,
      cta: { titulo: 'Arma tu propia canasta',
             texto: 'Compara estudio por estudio entre laboratorios y paga solo lo que necesitas.' },
      oferta: { nombre: `${c.canasta.nombre} — precio en ${donde}`, min: d.min, max: d.max, n: d.nLabs },
    });
  }

  if (c.tipo === 'labs') {
    const tablas = [
      '  <h2>En cuántos estudios gana cada laboratorio</h2>',
      tablaRanking(d.ranking),
      `\n  <h2>La misma canasta de ${d.canasta.nEstudios} estudios, en cada laboratorio</h2>`,
      '  <p>Biometría hemática, química sanguínea, perfil de lípidos, examen general de orina y perfil tiroideo: lo que pide un chequeo general, sumado laboratorio por laboratorio.</p>',
      tablaCanastaTotal(d.canasta, 'Laboratorio'),
      `\n  <h2>Los ${c.laboratorios.length} laboratorios, uno por uno</h2>`,
      fichasLabs(d, c),
    ];
    return pagina({
      c, meta, todos, tablas,
      eyebrow: 'Guía · Laboratorios clínicos en México',
      fuente: `Calculado el ${meta.fechaLarga} sobre los ${d.ranking.comparables} estudios que al menos tres laboratorios publican. Se recalcula con cada scan semanal.`,
      h2Precio: '¿Cuál conviene según lo que buscas?',
      cta: { titulo: 'Compara el estudio que necesitas',
             texto: 'El ranking dice quién gana más veces; el comparador dice quién gana en tu estudio.' },
      oferta: null,
    });
  }

  if (c.tipo === 'ranking') {
    return pagina({
      c, meta, todos,
      tablas: [tablaRanking(d)],
      fuente: `Calculado el ${meta.fechaLarga} sobre los ${d.comparables} estudios que al menos tres laboratorios publican. Se recalcula con cada scan semanal.`,
      h2Precio: `¿Cuál es el laboratorio más barato en ${donde}?`,
      cta: { titulo: 'Busca tu estudio, no el promedio',
             texto: 'El ranking dice quién gana más veces; el comparador dice quién gana en el estudio que tú necesitas.' },
      oferta: null,
    });
  }

  return pagina({
    c, meta, todos,
    tablas: [tablaGuia(d)],
    fuente: `Precios verificados el ${meta.fechaLarga} en ${d.nLabs} laboratorios. Se actualizan con cada scan semanal.`,
    h2Precio: '¿Cuánto cuestan los estudios más pedidos?',
    cta: { titulo: 'Compara el estudio que te pidieron',
           texto: 'Cientos de estudios comparados entre laboratorios, con precios actualizados cada semana.' },
    oferta: null,
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

const datos = E.cargarPrecios();
const scan  = new Date(datos.generado);
const mes   = scan.toLocaleDateString('es-MX', { month: 'long' });
const meta  = {
  fecha: datos.generado.slice(0, 10),
  anio: scan.getFullYear(),
  mes,
  mesAnio: `${mes} ${scan.getFullYear()}`,
  fechaLarga: scan.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }),
};

const problemas = [];
const listos = [];

for (const c of COPY) {
  if (SOLO && c.slug !== SOLO) continue;

  const d = hechosDe(c, datos);
  if (!d) { problemas.push(`${c.slug} → el scan no alcanza para publicar esta página`); continue; }

  const mapa = tokens[c.tipo](d, c, meta);
  const errs = validarCopy(c, mapa);
  if (errs.length) { problemas.push(...errs.map(p => `${c.slug} → ${p}`)); continue; }

  const r = resolver(c, mapa);
  const malos = validarResuelto(r, `${r.titulo} | Medcompara`);
  if (malos.length) { problemas.push(...malos.map(p => `${c.slug} → ${p}`)); continue; }

  listos.push({ c, d, r });
}

if (problemas.length) {
  console.error('\nCopy inválido — no se escribió nada:\n');
  problemas.forEach(p => console.error('  ✗ ' + p));
  console.error('\nLas cifras van por token. Ver scripts/generar-blog-estudios.js → tokens.\n');
  process.exit(1);
}

// Los relacionados enlazan entre las páginas del lote, con el copy ya resuelto.
const resueltos = listos.map(x => x.r);

for (const { c, d, r } of listos) {
  const html = armar(r, d, meta, datos, resueltos);
  if (APPLY) fs.writeFileSync(path.join(ROOT, 'blog', c.slug + '.html'), html);
  console.log(`  ${APPLY ? '✓' : '·'} blog/${c.slug}.html  (${(html.length / 1024).toFixed(1)} KB · ${c.tipo})`);
}

console.log(`\n${APPLY ? 'Escritos' : 'Se escribirían'} ${listos.length} artículos · scan del ${meta.fechaLarga}`);
if (!APPLY) console.log('(dry-run — usa --apply)');
