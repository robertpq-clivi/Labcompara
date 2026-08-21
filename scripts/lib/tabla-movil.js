/**
 * Medcompara — Las tablas no empujan el ancho de la página en móvil
 * ---------------------------------------------------------------------------
 * `CLAUDE.md` ya lo advertía: «una tabla de seis columnas empuja el ancho de la
 * página entera». Igual pasó en 58 de los 178 artículos — ninguno traía el
 * envoltorio ni la regla, y a 390 px la página completa desbordaba en
 * horizontal, no sólo la tabla. Con el 77% del tráfico en móvil, eso es el
 * artículo entero corrido para un lado.
 *
 * Tres generadores envolvían sus tablas y `generar-comparativas.js` no, así que
 * el envoltorio vivía copiado en cuatro lugares y en ninguno para las páginas
 * escritas a mano. Aquí queda una sola vez, como `conIndice` y `lib/ancla`.
 *
 * Cubre las tres clases de tabla que existen en el sitio —`price-table`,
 * `table` y `cmp-table`—: una tabla sin clase también desborda.
 */

'use strict';

const CSS = `.tabla-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:24px 0;}
.tabla-scroll>table{margin:0;min-width:480px;}`;

const TABLA = /<table[\s\S]*?<\/table>/g;

/**
 * Envuelve en `.tabla-scroll` cada tabla que no lo esté ya, e inyecta la regla
 * si la hoja de la página no la trae. Idempotente.
 */
function conTablasScroll(html) {
  let cambió = false;

  html = html.replace(TABLA, (tabla, indice) => {
    // Lo que va inmediatamente antes decide si ya está envuelta. Se mira un
    // trozo corto: el envoltorio siempre abre justo pegado a la tabla.
    const antes = html.slice(Math.max(0, indice - 60), indice);
    if (/class="tabla-scroll"[^>]*>\s*$/.test(antes)) return tabla;
    cambió = true;
    return `<div class="tabla-scroll">${tabla}</div>`;
  });

  // La regla sin el envoltorio no hace nada, y el envoltorio sin la regla
  // tampoco: las dos cosas o ninguna.
  if (cambió && !/\.tabla-scroll\{/.test(html)) {
    html = html.replace(/\n?<\/style>/, '\n' + CSS + '\n</style>');
  }
  return html;
}

module.exports = { conTablasScroll, CSS };
