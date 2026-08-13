/**
 * Medcompara — Rutas de los archivos que el pipeline lee y escribe
 * ------------------------------------------------------------------
 * El comparador de laboratorio vivía en index.html, y cuatro scripts distintos
 * tenían esa ruta escrita a mano. Al mover el comparador a pages/laboratorio.html
 * para dejarle la raíz al landing, cualquiera de los cuatro que se olvidara
 * habría fallado en silencio: unos leyendo un archivo sin RAW_DATA, otros
 * escribiéndolo donde ya nadie lo lee.
 *
 * Un solo lugar donde cambiarlo.
 */

'use strict';

const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

module.exports = {
  ROOT,
  /** Página del comparador de estudios de laboratorio (contiene RAW_DATA). */
  COMPARADOR_LAB: path.join(ROOT, 'pages', 'laboratorio.html'),
  /** Landing de Medcompara: no contiene datos, solo dirige a cada vertical. */
  LANDING: path.join(ROOT, 'index.html'),
  /** Página del comparador de medicamentos GLP-1. */
  COMPARADOR_GLP: path.join(ROOT, 'pages', 'medicamentos.html'),
};
