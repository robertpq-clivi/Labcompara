/**
 * Medcompara — Fechas honestas en el `Article` de las páginas generadas.
 * ----------------------------------------------------------------------------
 * Los cuatro generadores escribían `datePublished` y `dateModified` con la fecha
 * del scan. Como el scan corre cada domingo, cada corrida volvía a declarar las
 * 56 páginas generadas como publicadas *hoy*: el 30 de agosto de 2026 una sola
 * corrida movió la fecha de alta de 56 artículos, y en la mitad de ellos el
 * único cambio del diff eran esas mismas fechas.
 *
 * Eso es justo lo que CLAUDE.md ya prohibía para los artículos escritos a mano
 * («un `dateModified` de hoy sobre un texto que nadie reescribió es una promesa
 * de frescura falsa»). La regla no estaba en los generadores, que son los que
 * la rompen cada semana.
 *
 * Las dos fechas se resuelven distinto porque responden preguntas distintas:
 *
 *   datePublished · cuándo salió la página. No se mueve nunca. Sale de lo que ya
 *                   declara el archivo o del commit que lo dio de alta, y entre
 *                   los dos gana **el más antiguo**: así una fecha inflada se
 *                   corrige sola y este módulo nunca puede inventar frescura.
 *
 *   dateModified  · cuándo cambió el contenido. Sólo avanza a la fecha del scan
 *                   si el HTML nuevo difiere del publicado en algo que no sea
 *                   una fecha. Si el domingo ningún precio se movió, la página
 *                   se reescribe igual pero conserva su fecha.
 *
 * Se usa como `conIndice` y `conTablasScroll`: envuelve el HTML ya armado, justo
 * antes de escribirlo.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT } = require('./rutas');

const MESES = 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre';
const CAMPO = /"(datePublished|dateModified)"\s*:\s*"[^"]*"/g;
const LARGA = new RegExp(`\\d{1,2}\\s+de\\s+(?:${MESES})\\s+de\\s+\\d{4}`, 'gi');
const MES_ANIO = new RegExp(`(?:${MESES})\\s+(?:de\\s+)?\\d{4}`, 'gi');

/**
 * Neutraliza toda fecha para poder comparar sólo el contenido.
 *
 * No basta con el JSON-LD: la fecha del scan también viaja en el `<title>`
 * («agosto 2026») y en la línea de fuente («Precios verificados el 30 de agosto
 * de 2026»). Sin borrar esas dos, ninguna página sería nunca igual a la anterior
 * y `dateModified` avanzaría siempre — que es el problema que esto arregla.
 */
function sinFechas(html) {
  return String(html)
    .replace(CAMPO, '"$1":"·"')
    .replace(LARGA, '·fecha·')
    .replace(MES_ANIO, '·mes·');
}

/** Primer valor de un campo de fecha del JSON-LD, o null. */
function fechaDe(html, campo) {
  const m = String(html).match(new RegExp(`"${campo}"\\s*:\\s*"(\\d{4}-\\d{2}-\\d{2})"`));
  return m ? m[1] : null;
}

/** Fecha del commit que dio de alta el archivo, o null si aún no está en git. */
function altaEnGit(rel) {
  try {
    const salida = execFileSync('git', ['log', '--diff-filter=A', '--format=%as', '--', rel],
      { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    return salida[salida.length - 1] || null;
  } catch {
    return null;
  }
}

/** La más antigua de las fechas recibidas, ignorando las vacías. */
function masAntigua(...fechas) {
  const buenas = fechas.filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f || ''));
  return buenas.length ? buenas.sort()[0] : null;
}

/** Reescribe los dos campos en todos los nodos del marcado. */
function ponerFechas(html, publicado, modificado) {
  return String(html).replace(CAMPO, (_, campo) =>
    `"${campo}":"${campo === 'datePublished' ? publicado : modificado}"`);
}

/**
 * Devuelve el HTML con las dos fechas resueltas contra lo ya publicado.
 *
 * @param {string} html      HTML recién armado por el generador.
 * @param {string} archivo   Ruta absoluta donde se va a escribir.
 * @param {string} fechaScan `YYYY-MM-DD` del scan que alimenta esta corrida.
 */
function conFechas(html, archivo, fechaScan) {
  const previo = fs.existsSync(archivo) ? fs.readFileSync(archivo, 'utf8') : null;
  const rel = path.relative(ROOT, archivo);

  const publicado = masAntigua(previo && fechaDe(previo, 'datePublished'), altaEnGit(rel)) || fechaScan;

  // Página nueva, o contenido que sí cambió → la fecha del scan. Si no, la que ya tenía.
  const cambio = !previo || sinFechas(previo) !== sinFechas(html);
  const modificado = cambio
    ? fechaScan
    : (fechaDe(previo, 'dateModified') || fechaScan);

  // dateModified nunca puede quedar antes de datePublished.
  return ponerFechas(html, publicado, modificado < publicado ? publicado : modificado);
}

module.exports = { conFechas, sinFechas, fechaDe, altaEnGit, masAntigua, ponerFechas };
