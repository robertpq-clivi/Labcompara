/**
 * Medcompara — Índice de contenido de un artículo, y las anclas que lo sostienen
 * ---------------------------------------------------------------------------
 * Google pone «jump links» —los enlaces a secciones debajo del resultado— sólo
 * cuando encuentra dos cosas: secciones con ancla descriptiva y una tabla de
 * contenidos que enlace a esas anclas. El blog no tenía ninguna de las dos: los
 * 1,000 `<h2>` salían sin `id` y ningún artículo traía índice.
 *
 * Hay un tercer requisito que no es marcado: la página tiene que ser larga y
 * multi-tema. Un artículo de 400 palabras no va a recibir jump links por mucho
 * ancla que le pongamos, y un índice de dos renglones sobre una página corta
 * sólo empuja el contenido hacia abajo. De ahí los umbrales de abajo.
 *
 * Vive en lib/ porque lo llaman dos lados que no se pueden desincronizar: los
 * cuatro generadores, sobre el HTML ya armado, y la pasada de una sola vez
 * sobre los artículos escritos a mano. Misma función, mismo resultado — es lo
 * que hace que regenerar el domingo no borre el índice.
 */

'use strict';

const { ancla, legible } = require('./ancla');

/** Debajo de esto Google no da jump links y el índice sólo estorba. */
const MIN_PALABRAS = 900;
const MIN_SECCIONES = 4;

// `display` y `position` se declaran explícitos porque la hoja del sitio trae
// un `nav{display:flex;position:sticky}` para la barra superior, y un <nav>
// hereda de ahí: sin esto el título del índice se va al lado de la lista.
const CSS = `.toc{display:block;position:static;background:var(--gray-50);border:1px solid var(--gray-200);border-radius:12px;padding:16px 20px;margin:24px 0;}
.toc-title{font-weight:700;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--teal-dark);margin:0 0 10px;}
.toc ol{margin:0;padding-left:20px;}
.toc li{margin-bottom:4px;font-size:14px;}
.toc a{color:var(--teal-dark);text-decoration:none;}
.toc a:hover{text-decoration:underline;}`;

const NAV = /[ \t]*<nav class="toc"[\s\S]*?<\/nav>\n?/g;

function palabras(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .split(/\s+/).filter(Boolean).length;
}

/**
 * Devuelve el HTML con `id` en cada `<h2>` y un índice antes de la primera
 * sección. Idempotente: reconstruye el índice en vez de acumularlo, así que si
 * cambian las secciones el índice las sigue.
 */
function conIndice(html) {
  // Fuera el índice anterior antes de medir y de recolectar ids: si no, sus
  // propios enlaces cuentan como contenido y sus anclas como ocupadas.
  let limpio = html.replace(NAV, '');

  const h2 = [...limpio.matchAll(/<h2([^>]*)>([\s\S]*?)<\/h2>/g)];
  if (h2.length < MIN_SECCIONES || palabras(limpio) < MIN_PALABRAS) return limpio;

  const usados = new Set(
    [...limpio.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])
      .filter((id) => !h2.some((x) => x[1].includes(`id="${id}"`))),
  );

  const secciones = [];
  limpio = limpio.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/g, (entero, attrs, dentro) => {
    const texto = legible(dentro);
    if (!texto) return entero;
    let id = ancla(texto), n = 2;
    while (usados.has(id)) id = `${ancla(texto)}-${n++}`;
    usados.add(id);
    secciones.push({ id, texto });
    const sinId = attrs.replace(/\s*\bid="[^"]*"/, '');
    return `<h2${sinId} id="${id}">${dentro}</h2>`;
  });

  const indice =
    `  <nav class="toc" aria-label="Contenido del artículo">\n` +
    `    <p class="toc-title">En este artículo</p>\n    <ol>\n` +
    secciones.map((s) => `      <li><a href="#${s.id}">${s.texto}</a></li>`).join('\n') +
    `\n    </ol>\n  </nav>\n`;

  // Después de la entradilla si existe; si no, justo antes de la primera sección.
  const intro = limpio.match(/<p class="article-intro">[\s\S]*?<\/p>\n?/);
  if (intro) {
    limpio = limpio.replace(intro[0], intro[0] + indice);
  } else {
    const primera = limpio.match(/[ \t]*<h2[^>]*>/);
    if (!primera) return limpio;
    limpio = limpio.replace(primera[0], indice + primera[0]);
  }

  if (!limpio.includes('.toc{')) {
    limpio = limpio.replace(/\n?<\/style>/, '\n' + CSS + '\n</style>');
  }
  return limpio;
}

module.exports = { conIndice, MIN_PALABRAS, MIN_SECCIONES };
