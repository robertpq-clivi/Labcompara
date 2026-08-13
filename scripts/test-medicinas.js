#!/usr/bin/env node
/**
 * Medcompara — Test de la lectura de presentaciones
 * --------------------------------------------------
 * Esta vertical es la más fácil de equivocar de las tres. El mismo principio
 * activo se vende en decenas de cajas distintas, y las farmacias mezclan en los
 * resultados de búsqueda productos que NO son el medicamento buscado:
 * combinaciones con otro activo, presentaciones pediátricas, inyectables.
 *
 * Cada caso de aquí salió de datos reales y de un error que estuvo a punto de
 * publicarse. Los títulos son literales de Ahorro, Benavides y Prixz.
 *
 *   node scripts/test-medicinas.js
 */

'use strict';

const { leer, etiqueta } = require('./lib/presentacion');
const V = require('./verticales/medicinas');

let fallos = 0;
const check = (ok, desc, extra = '') => {
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${desc}${!ok && extra ? '  → ' + extra : ''}`);
};

// ── se publica: el medicamento simple, con caja identificable ───────────────
console.log('Presentaciones que SÍ se pueden comparar:');
for (const [titulo, sust, esperada] of [
  ['Omeprazol 20 Mg Con 14 Cápsulas', 'Omeprazol', 'omeprazol|20mg|cápsulas|14'],
  ['Omeprazol 20 mg Oral 14 cápsulas Marca del Ahorro', 'Omeprazol', 'omeprazol|20mg|cápsulas|14'],
  ['Metformina 850 mg Oral 30 tabletas Marca del Ahorro', 'Metformina', 'metformina|850mg|tabletas|30'],
  ['Dimefor 850 Mg – Caja Con 30 Tabletas (Metformina)', 'Metformina', 'metformina|850mg|tabletas|30'],
  ['Tempra 500 mg Adultos Paracetamol caja 20 tabletas', 'Paracetamol', 'paracetamol|500mg|tabletas|20'],
]) {
  const r = leer(titulo, sust);
  check(r.clave === esperada, `${titulo.slice(0, 46)} → ${esperada}`, r.clave || 'rechazado');
}

// Dos farmacias distintas deben producir la MISMA llave, o no hay comparación.
const a = leer('Omeprazol 20 Mg Con 14 Cápsulas', 'Omeprazol').clave;
const b = leer('Omeprazol 20 mg Oral 14 cápsulas Marca del Ahorro', 'Omeprazol').clave;
check(a === b && a !== null, 'dos farmacias, misma caja → misma llave');

// El genérico y la marca original SÍ son comparables: misma caja, distinto precio.
const gen = leer('Metformina 850 mg Oral 30 tabletas Marca del Ahorro', 'Metformina').clave;
const marca = leer('Dimefor 850 Mg – Caja Con 30 Tabletas (Metformina)', 'Metformina').clave;
check(gen === marca, 'genérico y marca original comparten llave');

// ── NO se publica: no es el medicamento que se buscó ────────────────────────
console.log('\nProductos que NO son el medicamento buscado:');
for (const [titulo, sust, porque] of [
  // Vildagliptina/Sitagliptina + Metformina son antidiabéticos de marca que
  // cuestan el doble. Su primera dosis (50 mg) se leía como si fuera la del
  // principio activo, creando una "Metformina 50 mg" que no existe.
  ['Vildagliptina, Metformina 50/850 Mg Con 30 Comprimidos', 'Metformina', 'doble dosis'],
  ['Vildagliptina/Metformina 50/1000 mg 30 Comprimidos Marca del Ahorro', 'Metformina', 'doble dosis'],
  ['Sitagliptina, Metformina 50 mg/ 850 mg Oral 56 Comprimidos', 'Metformina', 'doble dosis'],
  // Paracetamol + Tramadol es un controlado, no paracetamol.
  ['325 mg / 37.5 mg Paracetamol + Tramadol', 'Paracetamol', 'combinación'],
  // Sin número de piezas no hay caja que comparar.
  ['20 mg Omeprazol', 'Omeprazol', 'sin piezas'],
  // Otra sustancia que solo comparte raíz.
  ['Esomeprazol 40 Mg Con 28 Tabletas', 'Omeprazol', 'otra sustancia'],
]) {
  const r = leer(titulo, sust);
  check(r.clave === null, `${porque.padEnd(15)} ${titulo.slice(0, 50)}`, r.clave || '');
}

// ── la llave se lee de vuelta ───────────────────────────────────────────────
console.log('\nEtiqueta legible:');
check(etiqueta('omeprazol|20mg|cápsulas|14') === 'Omeprazol 20mg · 14 cápsulas', '"Omeprazol 20mg · 14 cápsulas"');
check(etiqueta('paracetamol|100mg|líquido|15ml') === 'Paracetamol 100mg · 15ml', 'líquidos se etiquetan por ml');

// ── el catálogo y las farmacias están bien formados ─────────────────────────
console.log('\nIntegridad:');
const meds = V.catalogo.medicamentos;
check(meds.length === 100, `${meds.length} medicamentos en el catálogo`);
check(meds.every((m) => m.nombre && m.query && m.rank), 'todos con nombre, query y rank');
check(new Set(meds.map((m) => m.nombre)).size === meds.length, 'sin nombres duplicados');
check(V.adaptadores.every((x) => x.id && typeof x.buscar === 'function'), 'todo adaptador expone buscar()');
// YZA no debe reaparecer: su robots.txt prohíbe todo rastreo.
check(!V.columnas.includes('YZA') && !V.adaptadores.some((x) => x.id === 'YZA'),
  'YZA fuera (robots.txt: Disallow: /)');
check(!V.columnas.includes('Clivi') && !V.columnas.includes('Revert'),
  'Clivi y Revert fuera de esta vertical');

console.log(fallos ? `\n✗ ${fallos} casos fallaron` : '\n✓ Todos los casos pasaron');
process.exit(fallos ? 1 : 0);
