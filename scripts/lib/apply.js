/**
 * Labcompara — Reescritura de RAW_DATA dentro de index.html
 * ----------------------------------------------------------
 * index.html es un solo archivo sin build: los estudios viven en un literal
 * `const RAW_DATA = [ … ];`. Este módulo reemplaza ese bloque conservando el
 * formato de una línea por estudio que ya usa el archivo.
 *
 * Solo se usa con `node scripts/scan-labs.js --apply`. El flujo semanal normal
 * NO toca index.html: publica el feed y el sitio lo consume en caliente.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const LAB_IDS = ['Labbe', 'Polanco', 'Chopo', 'Salud Digna', 'LAPI', 'OLAB'];

/** Serializa un estudio igual que el literal existente. */
function fila(e) {
  const val = (v) => (typeof v === 'number' && v > 0 ? v : 'null');
  const campos = LAB_IDS.map((l) => {
    const key = l.includes(' ') ? `"${l}"` : l;
    return `${key}:${val(e[l])}`;
  });
  return `  {name:${JSON.stringify(e.name)},${campos.join(',')},avg:${val(e.avg)},cheapest:${e.cheapest ? JSON.stringify(e.cheapest) : 'null'}},`;
}

function escribirRawData(matriz, archivo) {
  const file = archivo || path.join(__dirname, '..', '..', 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  const m = html.match(/(const RAW_DATA\s*=\s*\[)[\s\S]*?(\n\];)/);
  if (!m) throw new Error('No se encontró el bloque RAW_DATA en index.html');
  const cuerpo = '\n' + matriz.map(fila).join('\n');
  const nuevo = html.slice(0, m.index) + m[1] + cuerpo + m[2] + html.slice(m.index + m[0].length);
  fs.writeFileSync(file, nuevo);
  return matriz.length;
}

module.exports = { escribirRawData, LAB_IDS };
