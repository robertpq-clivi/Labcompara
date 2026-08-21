#!/usr/bin/env node
/**
 * Medcompara — Generador de artículos de precio por medicamento.
 *
 * Escribe blog/precio-<medicamento>-mexico.html para los medicamentos más
 * buscados del catálogo de medicinas. La estructura es la de una página de
 * intención de compra: el precio en el primer párrafo, tabla por presentación,
 * tabla por farmacia, genérico contra marca, y sólo después el contenido
 * clínico. Quien busca "paracetamol precio" quiere el número, no un ensayo.
 *
 * Los precios salen de data/medicinas/prices.json (scan semanal); el copy
 * cualitativo vive en scripts/medicinas-blog-copy.json y no lleva un solo
 * dígito de precio escrito a mano: todo va por {{TOKEN}}.
 *
 * Uso:
 *   node scripts/generar-blog-medicinas.js              (dry-run: qué escribiría)
 *   node scripts/generar-blog-medicinas.js --apply
 *   node scripts/generar-blog-medicinas.js --apply --solo paracetamol
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { anclas } = require('./lib/ancla');
// El índice y las anclas de sección van sobre el HTML ya armado, con la misma
// función que usó la pasada de los artículos escritos a mano.
const { conIndice } = require('./lib/indice-articulo');
const M    = require('./lib/medicinas-blog');

const ROOT  = path.join(__dirname, '..');
const BASE  = 'https://medcompara.com.mx';
// La tarjeta de 1200x630 que escribe scripts/generar-tarjetas-blog.js. Sin
// `image` Google no tiene thumbnail y no arma el rich result — ni de Article
// ni de Product. Si el PNG no existe, la referencia queda colgando: corre
// `node scripts/generar-tarjetas-blog.js --apply` cuando agregues un slug.
const tarjeta = slug => `${BASE}/images/blog/${slug}.png`;
const APPLY = process.argv.includes('--apply');
const SOLO  = (i => (i > -1 ? process.argv[i + 1] : null))(process.argv.indexOf('--solo'));

const CUANTOS = 10;

/**
 * Medicamentos del top que NO genera este script. Semaglutida ya tiene su
 * propio artículo escrito a mano, que cubre Ozempic, Wegovy y Rybelsus; el
 * scan de farmacia solo ve la presentación oral, así que regenerarlo sería
 * cambiar una página completa por una parcial. Al excluirlo, el décimo lugar
 * lo toma el siguiente medicamento del ranking.
 */
const EXCLUIDOS = {
  Semaglutida: 'ya cubierto por blog/precio-semaglutida-mexico.html',
};

const HEAD = fs.readFileSync(path.join(__dirname, 'plantillas', 'medicina-head.html'), 'utf8');
const COPY = JSON.parse(fs.readFileSync(path.join(__dirname, 'medicinas-blog-copy.json'), 'utf8'));

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

const mxn  = n => '$' + Number(n).toLocaleString('es-MX', { maximumFractionDigits: 0 });
const mxn2 = n => '$' + Number(n).toFixed(2);

const farm = f => M.NOMBRE_FARMACIA[f] || f;

/** "Ahorro, Guadalajara y Prixz" — la coma final del español, no la inglesa. */
const lista = xs => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' y ' + xs[xs.length - 1]);

/** "Paracetamol 500mg · 10 tabletas" → "500 mg · 10 tabletas". */
const caja = etiqueta => String(etiqueta)
  .replace(/^\S+\s+/, '')
  .replace(/(\d)\s*mg/g, '$1 mg')
  .replace(/(\d)\s*ml/g, '$1 ml');

/** La etiqueta completa, con la dosis separada para que se lea. */
const legible = etiqueta => String(etiqueta)
  .replace(/(\d)\s*mg/g, '$1 mg')
  .replace(/(\d)\s*ml/g, '$1 ml');

// ── Tokens ────────────────────────────────────────────────────────────────────

function tokens(h, meta) {
  // Para la comparación genérico/marca se elige la caja con más diferencia:
  // es la que decide una compra y la que el copy cita en prosa.
  const m = h.marcaVs[0] || null;

  return {
    MED:        h.medicamento,
    MED_L:      h.medicamento.toLowerCase(),
    CATEGORIA:  h.categoria,

    MIN:            mxn(h.min),
    MAX:            mxn(h.max),
    AHORRO_PCT:     h.ahorroPct + '%',
    AHORRO_MEDIANO: h.ahorroMedianoPct + '%',

    N_PRES:      h.presentaciones,
    N_FARMACIAS: h.nFarmacias,
    FARMACIAS:   lista(h.farmacias.map(farm)),

    LIDER:      farm(h.lider),
    LIDER_GANA: h.liderGana,
    LIDER_DE:   h.liderDe,

    DESTACADA:   legible(h.destacada.etiqueta),
    DEST_CAJA:   caja(h.destacada.etiqueta),
    DEST_MIN:    mxn(h.destacada.min),
    DEST_MAX:    mxn(h.destacada.max),
    DEST_AHORRO: h.destacada.ahorroPct + '%',
    DEST_BARATA: farm(h.destacada.masBarata),

    UNIDAD:         h.unidad,
    POR_UNIDAD:     h.porUnidad    != null ? mxn2(h.porUnidad)    : null,
    POR_UNIDAD_MIN: h.porUnidadMin != null ? mxn2(h.porUnidadMin) : null,
    POR_UNIDAD_MAX: h.porUnidadMax != null ? mxn2(h.porUnidadMax) : null,

    BRECHA:     legible(h.brechaMax.etiqueta),
    BRECHA_PCT: h.brechaMax.ahorroPct + '%',

    MARCA:             m ? m.nombre : null,
    MARCA_CAJA:        m ? caja(m.caja) : null,
    MARCA_GENERICO:    m ? mxn(m.generico) : null,
    MARCA_PRECIO:      m ? mxn(m.marca) : null,
    MARCA_SOBREPRECIO: m ? m.sobreprecio + '%' : null,
    MARCA_VECES:       m ? String(m.veces) : null,
    MARCAS:            h.marcas.length ? lista(h.marcas) : null,

    FECHA:    meta.fechaLarga,
    MES:      meta.mes,
    MES_ANIO: meta.mesAnio,
    ANIO:     meta.anio,
  };
}

// ── Validación del copy ───────────────────────────────────────────────────────

/** Campos donde un dígito escrito a mano casi siempre es un precio. */
const CAMPOS_SIN_CIFRAS = ['titulo', 'h1', 'metaDescription', 'intro', 'respuesta'];

/** Una dosis sí puede ir escrita: 500 mg no cambia con el scan. */
const DOSIS = /\d+(?:\.\d+)?\s*(?:mg|mcg|ml|g|gramos)\b/gi;

function validarCopy(c, mapa) {
  const problemas = [];
  const conocidos = new Set(Object.keys(mapa));

  const revisarTokens = (campo, texto) => {
    for (const t of String(texto).matchAll(/{{([A-Z_]+)}}/g)) {
      if (!conocidos.has(t[1])) problemas.push(`${campo}: token desconocido {{${t[1]}}}`);
      else if (mapa[t[1]] == null) problemas.push(`${campo}: {{${t[1]}}} no existe para este medicamento`);
    }
    // Precios y porcentajes nunca a mano: cambian con cada scan y dejarían al
    // texto contradiciendo a la tabla de su propia página.
    const s = String(texto).replace(/{{[A-Z_]+}}/g, '');
    if (/\$\s*\d/.test(s))    problemas.push(`${campo}: precio escrito a mano`);
    if (/\d\s*%/.test(s))     problemas.push(`${campo}: porcentaje escrito a mano`);
  };

  const recorrer = (campo, v) => {
    if (Array.isArray(v)) return v.forEach((x, i) => recorrer(`${campo}[${i}]`, x));
    if (v && typeof v === 'object') return Object.entries(v).forEach(([k, x]) => recorrer(`${campo}.${k}`, x));
    if (typeof v === 'string') revisarTokens(campo, v);
  };

  Object.entries(c).forEach(([k, v]) => { if (k !== 'med') recorrer(k, v); });

  // En los campos de cabecera, además, ninguna cifra que pueda leerse como
  // precio. Se descuentan las dosis (500 mg no cambia con el scan) y los
  // números de un solo dígito, que en prosa clínica son "diabetes tipo 2" y no
  // pesos: un precio de una cifra que además valga la pena escribir a mano no
  // existe.
  for (const campo of CAMPOS_SIN_CIFRAS) {
    const s = String(c[campo] || '').replace(/{{[A-Z_]+}}/g, '').replace(DOSIS, '');
    if (/\d{2,}/.test(s)) problemas.push(`${campo}: cifra a mano fuera de una dosis`);
  }

  const faltantes = ['titulo', 'h1', 'metaDescription', 'intro', 'respuesta', 'comprar',
                     'receta', 'paraQue', 'comoSeToma', 'cuidados', 'faqs']
    .filter(k => !c[k]);
  if (faltantes.length) problemas.push(`faltan campos: ${faltantes.join(', ')}`);
  if (c.faqs && (c.faqs.length < 4 || c.faqs.length > 6)) problemas.push(`${c.faqs.length} FAQs (van de 4 a 6)`);

  return problemas;
}

function validarResuelto(c, titulo) {
  const problemas = [];
  if (c.metaDescription.length > 155) problemas.push(`metaDescription de ${c.metaDescription.length} caracteres ya resuelta`);
  if (c.h1.length > 60)               problemas.push(`h1 de ${c.h1.length} caracteres ya resuelto`);
  if (titulo.length > 75)             problemas.push(`title de ${titulo.length} caracteres ya resuelto`);
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

// ── Piezas de la página ───────────────────────────────────────────────────────

function tablaResumen(h) {
  const filas = [
    ['Presentación más comparada', `${esc(legible(h.destacada.etiqueta))} · en ${h.destacada.farmacias.length} farmacias`],
    ['Precio más bajo hoy', `<strong style="color:#059669;">${mxn(h.destacada.min)}</strong> en ${esc(farm(h.destacada.masBarata))}`],
    ['Precio más alto', `${mxn(h.destacada.max)}`],
    ['Diferencia por la misma caja', `<span class="badge-cheap">−${h.destacada.ahorroPct}%</span> si compras en la más barata`],
  ];
  if (h.porUnidad != null) filas.push([`Precio por ${esc(h.unidad)}`, `desde ${mxn2(h.porUnidad)}`]);
  filas.push(['Presentaciones comparadas', `${h.presentaciones} en ${h.nFarmacias} farmacias`]);

  return `  <div class="tabla-scroll"><table class="price-table">
    <tr><th>Dato</th><th>${esc(h.medicamento)}</th></tr>
${filas.map(([a, b]) => `    <tr><td>${a}</td><td>${b}</td></tr>`).join('\n')}
  </table></div>`;
}

function tablaPresentaciones(h) {
  const conUnidad = h.tabla.some(p => p.porUnidad != null && p.piezas);
  const filas = h.tabla.map(p => {
    const unidad = p.piezas ? `<td>${mxn2(p.porUnidad)}</td>` : '<td>—</td>';
    return `    <tr><td>${esc(legible(p.etiqueta))}</td>`
      + `<td style="font-weight:700;color:#059669;">${mxn(p.min)}</td>`
      + `<td>${mxn(p.max)}</td>`
      + `<td>${esc(farm(p.masBarata))}</td>`
      + `<td><span class="badge-cheap">−${p.ahorroPct}%</span></td>`
      + (conUnidad ? unidad : '')
      + '</tr>';
  }).join('\n');

  return `  <div class="tabla-scroll"><table class="price-table">
    <tr><th>Presentación</th><th>Desde</th><th>Hasta</th><th>Más barata</th><th>Diferencia</th>${conUnidad ? '<th>Por pieza</th>' : ''}</tr>
${filas}
  </table></div>`;
}

function tablaFarmacias(h) {
  const filas = h.destacada.farmacias
    .map(f => ({ f, ...h.destacada.precios[f] }))
    .sort((a, b) => a.precio - b.precio)
    .map((x, i) => `    <tr><td><strong>${esc(farm(x.f))}</strong>${i === 0 ? ' <span class="badge-cheap">💰 Más barata</span>' : ''}</td>`
      + `<td style="font-size:13px;color:var(--gray-400);">${esc(x.titulo)}</td>`
      + `<td${i === 0 ? ' style="font-weight:700;color:#059669;"' : ''}>${mxn(x.precio)}</td></tr>`)
    .join('\n');

  return `  <div class="tabla-scroll"><table class="price-table">
    <tr><th>Farmacia</th><th>Producto</th><th>Precio</th></tr>
${filas}
  </table></div>`;
}

function tablaMarcas(h) {
  const filas = h.marcaVs.slice(0, 6).map(m =>
    `    <tr><td>${esc(caja(m.caja))}</td>`
    + `<td style="font-weight:700;color:#059669;">${mxn(m.generico)}</td>`
    + `<td>${esc(m.nombre)} · ${mxn(m.marca)}</td>`
    + `<td><span class="badge-rated">+${m.sobreprecio}%</span></td></tr>`).join('\n');

  return `  <div class="tabla-scroll"><table class="price-table">
    <tr><th>Misma caja</th><th>Genérico</th><th>De marca</th><th>Pagas de más</th></tr>
${filas}
  </table></div>`;
}

function tablaSueltas(h) {
  if (!h.sueltas.length) return '';
  const filas = h.sueltas.slice(0, 6).map(s =>
    `    <tr><td>${esc(legible(s.etiqueta))}</td><td>${esc(farm(s.farmacia))}</td><td>${mxn(s.precio)}</td></tr>`).join('\n');

  return `  <h2>Otras presentaciones de ${esc(h.medicamento.toLowerCase())}</h2>
  <p>Estas cajas hoy solo aparecen en una farmacia, así que no entran en la comparación de arriba. Sirven de referencia si es la presentación que te recetaron.</p>
  <div class="tabla-scroll"><table class="price-table">
    <tr><th>Presentación</th><th>Farmacia</th><th>Precio</th></tr>
${filas}
  </table></div>`;
}

function relacionados(h, todos) {
  const hermanos = todos
    .filter(o => o.slug !== h.slug)
    .sort((a, b) =>
      (b.categoria === h.categoria) - (a.categoria === h.categoria)
      || Math.abs(a.rank - h.rank) - Math.abs(b.rank - h.rank))
    .slice(0, 4)
    .map(o => `<a class="related-link" href="/blog/${o.slug}">Precio de ${esc(o.medicamento.toLowerCase())} en México</a>`);

  return `  <div class="related-section">
  <h3>📚 Precios de otros medicamentos</h3>
  <div class="related-links">${hermanos.join('\n')}
<a class="related-link" href="/medicinas">Comparar precios de medicinas entre farmacias</a></div>
</div>`;
}

function schemas(h, c, url, titulo, meta) {
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
    image: [tarjeta(h.slug)],
    description: c.metaDescription,
    url,
    datePublished: meta.fecha,
    dateModified:  meta.fecha,
    inLanguage: 'es-MX',
    author:    { '@type': 'Organization', name: 'Medcompara', url: BASE },
    publisher: { '@type': 'Organization', name: 'Medcompara', url: BASE, logo: { '@type': 'ImageObject', url: BASE + '/images/logo-medcompara-512.png', width: 512, height: 512 } },
    about: { '@type': 'Drug', name: h.medicamento, activeIngredient: h.medicamento },
  };

  // Product + AggregateOffer es lo que hace que el rango de precio salga en el
  // resultado de Google. Los datos son los de la presentación titular, no los
  // del catálogo entero: un rango que mezcla cajas distintas no es un precio.
  const producto = {
    '@context': 'https://schema.org', '@type': 'Product',
    name: `${h.medicamento} ${caja(h.destacada.etiqueta)}`,
    image: [tarjeta(h.slug)],
    category: h.categoria,
    description: `Precio de ${h.medicamento.toLowerCase()} ${caja(h.destacada.etiqueta)} comparado entre farmacias de México.`,
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'MXN',
      lowPrice:  h.destacada.min,
      highPrice: h.destacada.max,
      offerCount: h.destacada.farmacias.length,
      availability: 'https://schema.org/InStock',
    },
  };

  const breadcrumb = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Inicio', item: BASE + '/' },
      { '@type': 'ListItem', position: 2, name: 'Blog',   item: BASE + '/blog' },
      { '@type': 'ListItem', position: 3, name: c.h1,     item: url },
    ],
  };

  return [faq, article, producto, breadcrumb]
    .map(s => `<script type="application/ld+json">${JSON.stringify(s)}</script>`)
    .join('\n');
}

// ── Página completa ───────────────────────────────────────────────────────────

const ESTILO_EXTRA = `<style>
.receta-pill{display:inline-block;background:var(--gray-100);color:var(--navy);border-radius:999px;padding:6px 16px;font-weight:700;font-size:13px;margin-bottom:12px;}
.fuente-nota{font-size:13px;color:var(--gray-400);margin-top:-8px;}
/* Estas tablas llevan hasta seis columnas y el ~70% del tráfico es móvil: sin
   este contenedor la tabla empuja el ancho de la página entera y el artículo
   se lee de lado. Scroll dentro de la tabla, nunca en el body. */
.tabla-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:24px 0;}
.tabla-scroll .price-table{margin:0;min-width:520px;}
.price-table td,.price-table th{white-space:nowrap;}
.price-table td:first-child{white-space:normal;min-width:150px;}
</style>`;

function pagina(h, c, todos, meta) {
  const url    = `${BASE}/blog/${h.slug}`;
  const titulo = `${c.titulo} | Medcompara`;
  const med    = esc(h.medicamento.toLowerCase());
  // "el paracetamol" pero "la amoxicilina": los encabezados se arman solos y
  // sin esto la mitad del lote saldría con el artículo equivocado.
  const el     = c.genero === 'f' ? 'la' : 'el';
  const barato = c.genero === 'f' ? 'barata' : 'barato';

  const head = HEAD
    .replace(/{{TITULO}}/g, esc(titulo))
    .replace(/{{DESC}}/g, esc(c.metaDescription))
    .replace(/{{URL}}/g, url)
    .replace(/{{IMAGEN}}/g, tarjeta(h.slug))
    .replace('</head>', ESTILO_EXTRA + '\n</head>');

  const bullets = xs => xs.map(x => `    <li>${esc(x)}</li>`).join('\n');

  const seccionMarca = h.marcaVs.length ? `
  <h2>Genérico contra marca: cuánto pagas de más</h2>
  <p>Es la misma caja: mismo activo, misma dosis, mismas piezas. Lo único que cambia es el nombre impreso.</p>
${tablaMarcas(h)}
  <p>Si tu receta dice el nombre de la sustancia, puedes pedir el genérico. Si dice una marca concreta, pregúntale a tu médico si acepta el intercambiable.</p>
` : '';

  return `${head}
${schemas(h, c, url, titulo, meta)}
<body>
<nav>
  <a href="/" class="nav-logo">Med<span>compara</span></a>
  <a href="/medicinas" class="nav-btn">Comparar precios</a>
</nav>
<div class="breadcrumb">
  <a href="/">Inicio</a><span>›</span>
  <a href="/blog">Blog</a><span>›</span>
  ${esc(c.h1)}
</div>
<div class="article-wrap">
  <div class="article-eyebrow">Medicamentos · Precio en México</div>
  <h1>${esc(c.h1)}</h1>
  <p class="article-intro">${esc(c.intro)}</p>

  <div class="info-card">
  <p>Precios verificados el ${meta.fechaLarga} en ${esc(lista(h.farmacias.map(farm)))}. Se actualizan con cada scan semanal.</p>
</div>

  <h2>¿Cuánto cuesta ${el} ${med} en México?</h2>
  <p>${esc(c.respuesta)}</p>
${tablaResumen(h)}

  <h2>Precio de ${med} por presentación</h2>
${tablaPresentaciones(h)}
  <p class="fuente-nota">Precios de lista publicados por cada farmacia, en pesos mexicanos. Pueden variar por sucursal, promoción y existencias; confirma el precio final antes de comprar.</p>

  <h2>${esc(legible(h.destacada.etiqueta))}: precio en cada farmacia</h2>
${tablaFarmacias(h)}
${seccionMarca}
  <h2>¿Dónde comprar ${med} más ${barato}?</h2>
  <ul>
${bullets(c.comprar)}
  </ul>

  <div class="cta-box">
  <h3>Compara el precio antes de ir a la farmacia</h3>
  <p>${esc(h.medicamento)} y cientos de medicamentos más, con precios de varias farmacias actualizados cada semana.</p>
  <a href="/medicinas?q=${encodeURIComponent(h.medicamento.toLowerCase())}" class="cta-btn">Ver precios de ${med} →</a>
</div>

  <h2>¿Necesita receta?</h2>
  <div class="receta-pill">${esc(c.receta.estado)}</div>
  <p>${esc(c.receta.texto)}</p>

  <h2>Para qué sirve ${el} ${med}</h2>
  <p>${esc(c.paraQue)}</p>

  <h3>Cómo se toma</h3>
  <p>${esc(c.comoSeToma)}</p>

  <h3>Precauciones</h3>
  <ul>
${bullets(c.cuidados)}
  </ul>

${tablaSueltas(h)}

  <div class="faq-section">
  <h2>Preguntas frecuentes</h2>
${bloqueFaqs(c.faqs)}
</div>

  <div class="info-card">
  <p>Esta página compara precios; no sustituye una consulta médica. La dosis, la duración y la conveniencia de cualquier medicamento las decide tu médico.</p>
</div>

${relacionados(h, todos)}
</div>
<footer>
  <div class="footer-brand">Medcompara</div>
  <p style="margin-bottom:12px;">Compara precios de medicinas, estudios de laboratorio y tratamientos en México.</p>
  <div><a href="/">Inicio</a><a href="/medicinas">Medicinas</a><a href="/blog">Blog</a><a href="/aviso-de-privacidad">Privacidad</a></div>
  <p style="margin-top:16px;font-size:11px;opacity:.5;">Medcompara es un comparador de precios. No vendemos medicamentos ni damos consejo médico. Los precios son referenciales y pueden variar. © ${meta.anio} Medcompara.</p>
</footer>
</body></html>
`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const datos = M.cargar();
const scan  = new Date(datos.generated_at);
// El mes sale de la fecha del scan, nunca de new Date(): un título que dice
// "agosto 2026" sobre precios de junio promete una frescura que la página no
// tiene. Como el scan corre cada domingo, el mes se actualiza solo dentro de
// la semana siguiente al cambio de mes.
const mes   = scan.toLocaleDateString('es-MX', { month: 'long' });
const meta  = {
  fecha: datos.generated_at.slice(0, 10),
  anio:  scan.getFullYear(),
  mes,
  mesAnio: `${mes} ${scan.getFullYear()}`,
  fechaLarga: scan.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }),
};

const elegidos = M.masBuscados(datos, CUANTOS + Object.keys(EXCLUIDOS).length + 5)
  .filter(m => !EXCLUIDOS[m.nombre])
  .slice(0, CUANTOS);

const todos   = elegidos.map(m => M.hechos(m.nombre, datos)).filter(Boolean);
const porMed  = new Map(COPY.map(c => [c.med, c]));

for (const [nombre, razon] of Object.entries(EXCLUIDOS)) {
  console.log(`  · ${nombre} fuera del lote: ${razon}`);
}

// Validar todo antes de escribir nada: mejor no publicar que publicar la mitad.
const problemas = todos
  .filter(h => !SOLO || h.slugMed === SOLO)
  .flatMap(h => {
    const c = porMed.get(h.medicamento);
    if (!c) return [`${h.slugMed} → sin copy en medicinas-blog-copy.json`];
    const mapa = tokens(h, meta);
    const errs = validarCopy(c, mapa);
    if (errs.length) return errs.map(p => `${h.slugMed} → ${p}`);
    const r = resolver(c, mapa);
    return validarResuelto(r, `${r.titulo} | Medcompara`).map(p => `${h.slugMed} → ${p}`);
  });

if (problemas.length) {
  console.error('\nCopy inválido — no se escribió nada:\n');
  problemas.forEach(p => console.error('  ✗ ' + p));
  console.error('\nLas cifras van por token. Ver scripts/generar-blog-medicinas.js → tokens().\n');
  process.exit(1);
}

let escritos = 0;
for (const h of todos) {
  if (SOLO && h.slugMed !== SOLO) continue;
  const c    = resolver(porMed.get(h.medicamento), tokens(h, meta));
  const html = conIndice(pagina(h, c, todos, meta));
  if (APPLY) fs.writeFileSync(path.join(ROOT, 'blog', h.slug + '.html'), html);
  escritos++;
  console.log(`  ${APPLY ? '✓' : '·'} blog/${h.slug}.html  (${(html.length / 1024).toFixed(1)} KB · ${h.presentaciones} presentaciones · desde ${mxn(h.min)})`);
}

// ── Índice del blog ───────────────────────────────────────────────────────────

/**
 * El índice manda enlaces internos a las páginas nuevas. Se escribe entre
 * marcas para poder regenerarlo: la lista de medicamentos cambia con el
 * ranking del catálogo, y una sección pegada a mano se queda enlazando a un
 * artículo que ya no existe.
 */
function actualizarIndice(todos) {
  const archivo = path.join(ROOT, 'blog', 'index.html');
  let html = fs.readFileSync(archivo, 'utf8');

  const tarjetas = todos.map(h => {
    const c = porMed.get(h.medicamento);
    return `<a class="blog-card" href="/blog/${h.slug}">
  <div class="blog-card-inner">
    <div class="blog-card-title">${esc(resolver(c.h1, tokens(h, meta)))}</div>
    <span class="blog-card-cta">Desde ${mxn(h.min)} →</span>
  </div>
</a>`;
  }).join('');

  const bloque = `<!-- medicinas:inicio -->\n  <h2 class="cat-title">Precios de medicamentos</h2><div class="blog-grid">${tarjetas}</div>\n  <!-- medicinas:fin -->`;

  html = /<!-- medicinas:inicio -->[\s\S]*?<!-- medicinas:fin -->/.test(html)
    ? html.replace(/<!-- medicinas:inicio -->[\s\S]*?<!-- medicinas:fin -->/, bloque)
    : html.replace('<div class="wrap">\n', `<div class="wrap">\n  ${bloque}\n`);

  if (APPLY) fs.writeFileSync(archivo, html);
  console.log(`  ${APPLY ? '✓' : '·'} blog/index.html  (sección «Precios de medicamentos» con ${todos.length} tarjetas)`);
}

if (!SOLO) actualizarIndice(todos);

console.log(`\n${APPLY ? 'Escritos' : 'Se escribirían'} ${escritos} artículos · scan del ${meta.fechaLarga}`);
if (!APPLY) console.log('(dry-run — usa --apply)');
