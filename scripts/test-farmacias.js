#!/usr/bin/env node
/**
 * Labcompara — Test del emparejador de medicamentos
 * --------------------------------------------------
 * En la vertical de laboratorio, equivocarse de estudio cuesta cientos de pesos.
 * Aquí cuesta miles: "Mounjaro 2.5 mg" y "Mounjaro 15 mg" son la misma caja con
 * distinto número, y el precio se multiplica. Por eso el emparejamiento va por
 * tokens declarados y no por similitud, y por eso estos casos van fijos.
 *
 * Los títulos son reales, tomados de data/medicamentos/crudo.json.
 *
 *   node scripts/test-farmacias.js
 */

'use strict';

const V = require('./verticales/farmacias');

const prod = (name) => {
  const p = V.catalogo.products.find((x) => x.name === name);
  if (!p) throw new Error(`No existe en el catálogo: ${name}`);
  return p;
};

let fallos = 0;
const check = (ok, desc, extra = '') => {
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${desc}${extra && !ok ? '  → ' + extra : ''}`);
};

// ── la dosis correcta gana, y solo esa ───────────────────────────────────────
console.log('Selección de dosis dentro de una familia:');

const ozempic = [
  { titulo: 'Ozempic 0.25/0.5 mg Semaglutida 1.34 mg/ml pluma', precio: 3200, url: '' },
  { titulo: 'Ozempic 1 mg Semaglutida pluma prellenada', precio: 4100, url: '' },
  { titulo: 'Ozempic 2 mg Semaglutida pluma prellenada', precio: 5600, url: '' },
];
for (const [nombre, esperado] of [
  ['Ozempic 0.25/0.5 mg (1 pluma)', 3200],
  ['Ozempic 1 mg (1 pluma)', 4100],
  ['Ozempic 2 mg (1 pluma)', 5600],
]) {
  const p = V.catalogo.products.find((x) => x.name === nombre);
  if (!p) { console.log(`  · ${nombre} no está en el catálogo, se omite`); continue; }
  const hit = V.elegir(ozempic, p, 'Ahorro');
  check(hit && hit.precio === esperado, `${nombre} → ${esperado}`, hit ? String(hit.precio) : 'sin match');
}

// ── la marca es obligatoria salvo en Benavides ───────────────────────────────
console.log('\nLa marca debe aparecer en el título:');
const sinMarca = [{ titulo: '1 mg Semaglutida solución inyectable', precio: 3900, url: '' }];
const p1mg = V.catalogo.products.find((x) => /Ozempic 1 mg/.test(x.name));
if (p1mg) {
  check(V.elegir(sinMarca, p1mg, 'Ahorro') === null,
    'una fuente con marca en el título no adivina sin ella');
  check(V.elegir(sinMarca, p1mg, 'Benavides') !== null,
    'Benavides sí, porque su búsqueda ya viene acotada por familia');
}

// ── exclusiones ──────────────────────────────────────────────────────────────
console.log('\nExclusiones declaradas:');
const conExcluidos = V.catalogo.products.filter((p) => (p.exclude || []).length);
check(conExcluidos.length > 0, `${conExcluidos.length} presentaciones declaran exclude`);
for (const p of conExcluidos.slice(0, 3)) {
  const ex = p.exclude[0];
  const falso = [{ titulo: `${p.family} ${ex} presentación`, precio: 999, url: '' }];
  check(V.elegir(falso, p, 'Ahorro') === null, `"${p.name}" excluye "${ex}"`);
}

// ── normalización de dosis ───────────────────────────────────────────────────
console.log('\nNormalización de dosis:');
check(V.normalizar('Mounjaro 12.5Mg') === 'mounjaro 12.5 mg', '"12.5Mg" → "12.5 mg"');
check(V.normalizar('OZEMPIC  1mg') === 'ozempic 1 mg', '"1mg" → "1 mg" y minúsculas');

// ── el más barato entre variantes equivalentes ───────────────────────────────
console.log('\nEntre variantes que sí coinciden, gana el más barato:');
if (p1mg) {
  const dos = [
    { titulo: 'Ozempic 1 mg pluma', precio: 4500, url: '' },
    { titulo: 'Ozempic 1 mg pluma prellenada', precio: 4100, url: '' },
  ];
  const hit = V.elegir(dos, p1mg, 'Ahorro');
  check(hit && hit.precio === 4100, 'elige 4100 sobre 4500', hit ? String(hit.precio) : 'sin match');
}

// ── el catálogo está bien formado ────────────────────────────────────────────
console.log('\nIntegridad del catálogo:');
check(V.catalogo.products.every((p) => p.name && p.family), 'toda presentación tiene name y family');
check(V.catalogo.products.every((p) => V.catalogo.families[p.family]),
  'toda familia referenciada existe en families');
check(new Set(V.catalogo.products.map((p) => p.name)).size === V.catalogo.products.length,
  'no hay nombres duplicados');
check(V.adaptadores.every((a) => a.id && typeof a.buscar === 'function'),
  'todo adaptador expone id y buscar()');

console.log(fallos ? `\n✗ ${fallos} casos fallaron` : '\n✓ Todos los casos pasaron');
process.exit(fallos ? 1 : 0);
