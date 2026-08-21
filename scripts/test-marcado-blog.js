#!/usr/bin/env node
/**
 * Medcompara — El marcado del blog no se degrada solo
 * ---------------------------------------------------------------------------
 * Este repo no tenía ningún test que mirara el JSON-LD, y se notó: los 178
 * artículos declaraban `Article` y `Product` sin `image`, así que Google no
 * tenía thumbnail y ningún rich result se armaba. 72 páginas no tenían ni
 * `og:image`; las otras 106 compartían el mismo genérico.
 *
 * El arreglo entra por los generadores, y ahí está el riesgo que este test
 * cubre: el ciclo semanal reescribe 72 de estos archivos. Si alguien toca una
 * plantilla o un generador y se lleva el `image` de paso, sin este test nadie
 * se enteraría hasta revisar Search Console meses después.
 *
 *   node scripts/test-marcado-blog.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT } = require('./lib/rutas');
const { legible } = require('./lib/ancla');

const BLOG = path.join(ROOT, 'blog');
const fallos = [];
const ok = [];

const LD = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const TIPOS_ARTICULO = ['Article', 'BlogPosting', 'NewsArticle'];

const archivos = fs.readdirSync(BLOG)
  .filter((f) => f.endsWith('.html') && f !== 'index.html')
  .sort();

const sinImagenArticle = [];
const sinImagenProduct = [];
const sinOg            = [];
const roto             = [];
const tokenSuelto      = [];
const pngFaltante      = [];
const sinFaq           = [];
const divPregunta      = [];
const preguntaSinId    = [];
const idRepetido       = [];
const cssSinMargen     = [];
const desincronizado   = [];
const sinBreadcrumb    = [];
const sinAutor         = [];
const sinFecha         = [];
const ancaRota         = [];
const tocSinCss        = [];
const seccionSinId     = [];
const sinLogo          = [];
const sinIcono         = [];

for (const archivo of archivos) {
  const html = fs.readFileSync(path.join(BLOG, archivo), 'utf8');
  const nodos = [];

  let m;
  LD.lastIndex = 0;
  while ((m = LD.exec(html))) {
    let json;
    try { json = JSON.parse(m[1]); }
    catch (e) { roto.push(`${archivo}: ${e.message.slice(0, 60)}`); continue; }
    nodos.push(...(Array.isArray(json) ? json : (json['@graph'] || [json])));
  }

  // Una plantilla a medio resolver sirve una URL literal "{{IMAGEN}}".
  if (/\{\{[A-Z_]+\}\}/.test(html)) tokenSuelto.push(archivo);

  // Las preguntas del bloque FAQ tienen que ser <h3> con ancla: un div no entra
  // al esquema de encabezados ni puede ser destino de un jump link.
  if (/<div class="faq-q"/.test(html)) divPregunta.push(archivo);
  for (const m of html.matchAll(/<h3[^>]*class="faq-q"[^>]*>/g)) {
    if (!/\bid="/.test(m[0])) preguntaSinId.push(`${archivo}: ${m[0].slice(0, 50)}`);
  }

  // Un id repetido manda al navegador siempre a la primera coincidencia.
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const vistos = new Set();
  for (const id of ids) {
    if (vistos.has(id)) { idRepetido.push(`${archivo}: #${id}`); break; }
    vistos.add(id);
  }

  // Sin `margin:0` el h3 hereda el margen superior global y abre un hueco
  // dentro de la caja de la pregunta.
  const regla = (html.match(/\.faq-q\{[^}]*\}/) || [])[0];
  if (regla && !/margin:0/.test(regla)) cssSinMargen.push(archivo);

  // La pregunta vive en dos lugares: el <h3> visible y el Question.name del
  // JSON-LD. Si se separan, el marcado le promete a Google una pregunta que la
  // página no tiene — y nada más en el repo lo notaría.
  const visibles = [...html.matchAll(/<h3 class="faq-q" id="[^"]*">([\s\S]*?)<\/h3>/g)]
    .map((x) => legible(x[1])).sort().join('|');
  const enLd = [];
  const recorrer = (o) => {
    if (Array.isArray(o)) return o.forEach(recorrer);
    if (o && typeof o === 'object') {
      if (o['@type'] === 'Question') enLd.push(legible(o.name || ''));
      Object.values(o).forEach(recorrer);
    }
  };
  nodos.forEach(recorrer);
  if (visibles !== enLd.sort().join('|')) desincronizado.push(archivo);

  const article = nodos.find((n) => n && TIPOS_ARTICULO.includes(n['@type']));
  const product = nodos.find((n) => n && n['@type'] === 'Product');

  // Las imágenes referenciadas tienen que existir en disco: un 404 en `image`
  // es peor que no declararla, porque Google reporta el error.
  const revisarPng = (urls, destino) => {
    for (const u of [].concat(urls || [])) {
      const rel = String(u).replace(/^https?:\/\/[^/]+\//, '');
      if (!fs.existsSync(path.join(ROOT, rel))) destino.push(`${archivo} → ${rel}`);
    }
  };

  if (article) {
    if (!article.image || ![].concat(article.image).length) sinImagenArticle.push(archivo);
    else revisarPng(article.image, pngFaltante);
  }
  if (product) {
    if (!product.image || ![].concat(product.image).length) sinImagenProduct.push(archivo);
    else revisarPng(product.image, pngFaltante);
  }

  // El logo de marca: en publisher —que es de donde Google lo toma— y en los
  // <link rel="icon">, que es lo que ve la pestaña.
  if (article && !(article.publisher && article.publisher.logo)) sinLogo.push(archivo);
  if (!/logo-medcompara-512\.png"\/>/.test(html)) sinIcono.push(archivo);

  if (!nodos.some((n) => n && n['@type'] === 'BreadcrumbList')) sinBreadcrumb.push(archivo);
  if (article && !article.author) sinAutor.push(archivo);
  if (article && !(article.datePublished && article.dateModified)) sinFecha.push(archivo);

  // El índice del artículo: sus enlaces tienen que aterrizar, sus secciones
  // tienen que tener ancla, y la hoja de estilo tiene que traer la regla.
  if (/<nav class="toc"/.test(html)) {
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((x) => x[1]));
    for (const x of html.matchAll(/<li><a href="#([^"]+)"/g)) {
      if (!ids.has(x[1])) ancaRota.push(`${archivo} → #${x[1]}`);
    }
    if (!/\.toc\{/.test(html)) tocSinCss.push(archivo);
    const conId = [...html.matchAll(/<h2([^>]*)>/g)].filter((x) => /\bid=/.test(x[1])).length;
    if (conId < 4) seccionSinId.push(`${archivo} (${conId} h2 con ancla)`);
  }

  revisarPng(['https://medcompara.com.mx/images/logo-medcompara-512.png'], pngFaltante);

  const og = (html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || [])[1];
  if (!og) sinOg.push(archivo);
  else revisarPng([og], pngFaltante);

  // El marcado de FAQPage se queda a propósito — ver «Rich snippets» en
  // CLAUDE.md. Google ya no lo renderiza, pero Bing y los crawlers de IA sí lo
  // leen, y borrarlo sería perder esa superficie sin ganar nada.
  if (!nodos.some((n) => n && n['@type'] === 'FAQPage')) sinFaq.push(archivo);
}

function caso(lista, mal, bien, pista) {
  if (lista.length) {
    fallos.push(`${lista.length} ${mal}${pista ? ' — ' + pista : ''}`);
    lista.slice(0, 5).forEach((x) => fallos.push(`    ${x}`));
  } else ok.push(bien);
}

caso(roto, 'archivo(s) con JSON-LD que no parsea', `el JSON-LD de los ${archivos.length} artículos parsea`);
caso(tokenSuelto, 'archivo(s) con un token {{...}} sin resolver', 'ninguna plantilla quedó a medio resolver');
caso(sinImagenArticle, 'Article sin `image`', 'todos los Article declaran `image`',
  'corre: node scripts/generar-tarjetas-blog.js --apply && node scripts/poner-imagen-blog.js --apply');
caso(sinImagenProduct, 'Product sin `image`', 'todos los Product declaran `image`',
  'Google no renderiza el snippet de precio sin imagen');
caso(sinOg, 'archivo(s) sin og:image', `los ${archivos.length} artículos tienen og:image`);
caso(pngFaltante, 'referencia(s) a una imagen que no existe en disco', 'todas las imágenes referenciadas existen');
caso(sinFaq, 'archivo(s) que perdieron el marcado de FAQPage', `los ${archivos.length} conservan FAQPage`,
  'si se quitó a propósito, actualiza «Rich snippets» en CLAUDE.md y borra este caso');

caso(divPregunta, 'archivo(s) con preguntas todavía en <div>', 'las preguntas del FAQ son encabezados',
  'corre: node scripts/preguntas-como-encabezado.js --apply');
caso(preguntaSinId, 'pregunta(s) sin ancla', 'todas las preguntas tienen ancla');
caso(idRepetido, 'archivo(s) con un id repetido', 'ningún id se repite dentro de una página');
caso(cssSinMargen, 'archivo(s) donde .faq-q no fija margin:0', 'la regla .faq-q anula el margen del h3');

caso(desincronizado, 'archivo(s) donde el <h3> y el JSON-LD no dicen la misma pregunta',
  'el FAQ visible y el JSON-LD coinciden en las 824 preguntas');

caso(sinLogo, 'Article sin publisher.logo', 'todos los Article declaran publisher.logo',
  'corre: node scripts/generar-logo.js --apply');
caso(sinIcono, 'archivo(s) sin el icono de marca de 512', 'los iconos de marca están declarados');
caso(sinBreadcrumb, 'archivo(s) sin BreadcrumbList', `los ${archivos.length} declaran BreadcrumbList`,
  'es el único rich result que este sitio gana hoy — corre: node scripts/completar-marcado-blog.js --apply');
caso(sinAutor, 'Article sin author', 'todos los Article declaran author');
caso(sinFecha, 'Article sin datePublished o dateModified', 'todos los Article traen las dos fechas');
caso(ancaRota, 'enlace(s) del índice que no aterrizan', 'todos los enlaces del índice aterrizan en una sección');
caso(tocSinCss, 'archivo(s) con índice pero sin la regla .toc', 'todo índice trae su CSS');
caso(seccionSinId, 'archivo(s) con índice y menos de 4 secciones con ancla', 'los índices cubren sus secciones');

console.log('Marcado del blog\n');
ok.forEach((o) => console.log(`  ✓ ${o}`));
fallos.forEach((f) => console.log(`  ✗ ${f}`));
console.log(fallos.length ? `\n✗ ${fallos.length} casos fallaron` : '\n✓ Todos los casos pasaron');
process.exit(fallos.length ? 1 : 0);
