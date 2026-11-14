#!/usr/bin/env node
/**
 * Medcompara — Test del emparejador de medicamentos
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

// ── vial vs pluma ────────────────────────────────────────────────────────────
// Ahorro y Guadalajara venden el mismo mg en pluma KwikPen y en frasco ámpula.
// El frasco cuesta ~4x menos, requiere jeringa aparte y no es la presentación
// que listan Benavides ni San Pablo. Compararlos hacía ver a esas farmacias
// como 4x más baratas justo en las dosis de inicio, que son las más buscadas.
console.log('\nMounjaro se compara en pluma, nunca en frasco:');
const famM = V.catalogo.families.Mounjaro;
const mezcla = [
  { titulo: 'Mounjaro 2.5 mg/0.5 ml 1 Frasco', precio: 1694, url: '' },
  { titulo: 'Mounjaro Kwikpen 2.5Mg/0.6Ml 3 ml', precio: 6250, url: '' },
  { titulo: 'Mounjaro 2.5mg/0.5ml en Frasco ámpula Solución Inyectable', precio: 2297, url: '' },
  { titulo: 'Mounjaro KwikPen 2.5mg/0.6ml Solución Inyectable Pluma Precargada', precio: 9186, url: '' },
];
const p25 = V.catalogo.products.find((x) => x.name.startsWith('Mounjaro 2.5'));
const conFam = V.elegir(mezcla, p25, 'Ahorro', famM);
check(conFam && conFam.precio === 6250, 'con la regla de familia elige la KwikPen (6250)',
  conFam ? String(conFam.precio) : 'sin match');
const sinFam = V.elegir(mezcla, p25, 'Ahorro');
check(sinFam && sinFam.precio === 1694, 'sin ella elegía el frasco — así se detectó el error');

// Benavides lista el frasco sin decir "frasco" y, buscando "mounjaro", también
// devuelve Foundayz (orforglipron). Ninguno de los dos debe ganarle a la pluma.
const benavides = [
  { titulo: '2.5 mg/0.5 ml Tirzepatida Solución Inyectable', precio: 1792, url: '', marca: 'Mounjaro', activos: 'Tirzepatida' },
  { titulo: '2.5 mg Orforglipron', precio: 4200, url: '', marca: 'Foundayz', activos: 'Orforglipron' },
  { titulo: '2.5 mg Tirzepatida/0.6 ml Solución', precio: 5867, url: '', marca: 'Mounjaro', activos: 'Tirzepatida' },
];
const ben = V.elegir(benavides, p25, 'Benavides', famM);
check(ben && ben.precio === 5867, 'Benavides: ni el frasco (0.5 ml) ni el orforglipron le ganan a la pluma',
  ben ? String(ben.precio) : 'sin match');
const benSinGA = V.elegir(benavides.map(({ marca, activos, ...r }) => r), p25, 'Benavides', famM);
check(benSinGA && benSinGA.precio === 5867, 'Benavides sin campos GA4: la sustancia en el título basta',
  benSinGA ? String(benSinGA.precio) : 'sin match');

// "2.5 mg" es subcadena de "12.5 mg"
console.log('\nLa dosis no se confunde con otra que la contenga:');
const doce = [{ titulo: 'Mounjaro KwikPen 12.5mg/0.6ml Pluma Precargada', precio: 14358, url: '' }];
check(V.elegir(doce, p25, 'Ahorro', famM) === null, '"2.5 mg" no captura la de 12.5 mg');

// ── Wegovy: pluma y tableta salen de la misma búsqueda ───────────────────────
// Títulos reales del 13 de noviembre de 2026, buscando «wegovy». La tableta es
// otra familia en el comparador, y ninguna de las dos debe colarse en la otra.
console.log('\nWegovy en pluma y en tableta no se cruzan:');
const famW = V.catalogo.families.Wegovy;
const famWT = V.catalogo.families['Wegovy tableta'];
const ahorroW = [
  { titulo: 'WEGOVY FlexTouch 1.5ml (0.5mg) 1 Pluma', precio: 2900, url: '' },
  { titulo: 'Wegovy Tabletas 4 mg 30 Tabs', precio: 4100, url: '' },
  { titulo: 'WEGOVY FlexTouch 1.5ml (0.25mg) 1 Pluma', precio: 2384, url: '' },
  { titulo: 'Wegovy Tabletas 1.5 mg 30 Tabs', precio: 3349, url: '' },
];
const sanPabloW = [
  { titulo: 'Wegovy 0.25 MG 1.5 ML Solución Pluma Prellenada', detalle: 'Semaglutida 0.25 MG', precio: 3178, url: '' },
  { titulo: 'Wegovy 30 Tabletas Caja', detalle: 'Semaglutida 4.0 MG MG', precio: 4100, url: '' },
  { titulo: 'Wegovy 30 Tabletas Caja', detalle: 'Semaglutida 1.5 MG', precio: 3349, url: '' },
];
const benavidesW = [
  { titulo: '0.25 mg Semaglutida Solución Inyectable', precio: 3177, url: '', marca: 'Wegovy', activos: 'Semaglutida' },
  { titulo: '1.5 MG 30 TAB', precio: 3640, url: '', marca: 'Wegovy', activos: 'Semaglutida' },
  // El Rybelsus reformulado trae las mismas dosis que la tableta de Wegovy.
  { titulo: '1.5 mg Semaglutida 30 Tabletas', precio: 1900, url: '', marca: 'Rybelsus', activos: 'Semaglutida' },
];
const elige = (lista, nombre, fuente, fam) => (V.elegir(lista, prod(nombre), fuente, fam) || {}).precio || null;
for (const [lista, fuente, nombre, fam, esperado] of [
  [ahorroW, 'Ahorro', 'Wegovy tableta 1.5 mg (30 tabletas)', famWT, 3349],
  [ahorroW, 'Ahorro', 'Wegovy tableta 4 mg (30 tabletas)', famWT, 4100],
  [ahorroW, 'Ahorro', 'Wegovy 0.5 mg (caja mensual)', famW, 2900],
  [sanPabloW, 'SanPablo', 'Wegovy tableta 1.5 mg (30 tabletas)', famWT, 3349],
  [sanPabloW, 'SanPablo', 'Wegovy tableta 4 mg (30 tabletas)', famWT, 4100],
  [sanPabloW, 'SanPablo', 'Wegovy 0.25 mg (caja mensual)', famW, 3178],
  [benavidesW, 'Benavides', 'Wegovy tableta 1.5 mg (30 tabletas)', famWT, 3640],
  [benavidesW, 'Benavides', 'Wegovy 0.25 mg (caja mensual)', famW, 3177],
  [ahorroW, 'Ahorro', 'Wegovy tableta 9 mg (30 tabletas)', famWT, null],
  [ahorroW, 'Ahorro', 'Wegovy tableta 25 mg (30 tabletas)', famWT, null],
]) {
  const got = elige(lista, nombre, fuente, fam);
  check(got === esperado, `${fuente}: ${nombre} → ${esperado ?? 'sin precio'}`, String(got));
}
// «0.25 mg» vive dentro de «25 mg»: la pluma de inicio no es la tableta de 25.
check(elige([{ titulo: 'Wegovy 25 mg 30 Tabletas', precio: 5999, url: '' }], 'Wegovy 0.25 mg (caja mensual)', 'Ahorro', famW) === null,
  'la pluma de 0.25 mg no captura la tableta de 25 mg');
check(elige([{ titulo: 'WEGOVY FlexTouch 1.5ml (0.25mg) 1 Pluma', precio: 2384, url: '' }], 'Wegovy tableta 25 mg (30 tabletas)', 'Ahorro', famWT) === null,
  'la tableta de 25 mg no captura la pluma de 0.25 mg');
// «tab» a secas está dentro de «inyectable»: la exclusión lleva espacio.
check(elige([{ titulo: 'Wegovy 1mg/dosis 1.34mg/ml Solución Inyectable, 1 Pluma Precargada.', precio: 3940, url: '' }], 'Wegovy 1 mg (caja mensual)', 'Guadalajara', famW) === 3940,
  '«Solución Inyectable» no cuenta como tableta');

// ── el catálogo está bien formado ────────────────────────────────────────────
console.log('\nIntegridad del catálogo:');
check(V.catalogo.products.every((p) => p.name && p.family), 'toda presentación tiene name y family');
check(V.catalogo.products.every((p) => V.catalogo.families[p.family]),
  'toda familia referenciada existe en families');
check(new Set(V.catalogo.products.map((p) => p.name)).size === V.catalogo.products.length,
  'no hay nombres duplicados');
check(V.adaptadores.every((a) => a.id && typeof a.buscar === 'function'),
  'todo adaptador expone id y buscar()');

// ── precio de venta vs precio de lista ───────────────────────────────────────
// Markup real de farmaciasguadalajara.com: la ficha trae el valor de lista y el
// de venta, y el de lista va PRIMERO en el DOM. Quedarse con el primero
// publicaba $9,186 donde el cliente paga $3,770.
console.log('\nEn una ficha con promoción se toma el precio de venta:');
const tileReal = `<div class="product-tile" data-pid="123">
  <a class="link" href="/mounjaro-kwikpen-2-5mg">Mounjaro KwikPen 2.5mg/0.6ml Solución Inyectable Pluma Precargada</a>
  <div class="price">
    <span class="strike-through list"><span class="value" content="9186.00">$9,186.00</span></span>
    <span class="sales offer-mini-cart offer campaign-badge-offer"><span class="value" content="3770.00"></span> $3,770.00</span>
  </div>
</div>`;
const gdl = V.adaptadores.find((a) => a.id === 'Guadalajara');
(async () => {
  const items = await gdl.buscar({ get: async () => tileReal }, 'mounjaro');
  check(items.length === 1 && items[0].precio === 3770,
    'toma 3770 (venta) y no 9186 (lista)', items.length ? String(items[0].precio) : 'sin resultados');

  // Sin promoción hay un solo valor y debe seguir funcionando.
  const sinPromo = tileReal.replace(/<span class="sales[\s\S]*?<\/span>\s*\$3,770\.00<\/span>/, '');
  const items2 = await gdl.buscar({ get: async () => sinPromo }, 'mounjaro');
  check(items2.length === 1 && items2[0].precio === 9186,
    'sin bloque .sales cae al valor único', items2.length ? String(items2[0].precio) : 'sin resultados');

  console.log(fallos ? `\n✗ ${fallos} casos fallaron` : '\n✓ Todos los casos pasaron');
  process.exit(fallos ? 1 : 0);
})();
