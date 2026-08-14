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

const { leer, etiqueta, marca, mililitros } = require('./lib/presentacion');
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
const deMarca = leer('Dimefor 850 Mg – Caja Con 30 Tabletas (Metformina)', 'Metformina').clave;
check(gen === deMarca, 'genérico y marca original comparten llave');

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

// ── la marca comercial cuenta como el activo ────────────────────────────────
// Media farmacia titula por marca. Sin esto, la caja de marca y la genérica
// —que es toda la comparación— quedarían en filas distintas.
console.log('\nMarcas comerciales:');
const DIMEN = { nombre: 'Dimenhidrinato', tambien: 'Dramamine', raiz: 'dimenhidrinato' };
check(leer('Dramamine 50 mg Con 12 Tabletas', DIMEN).clave === 'dimenhidrinato|50mg|tabletas|12',
  'Dramamine → dimenhidrinato', leer('Dramamine 50 mg Con 12 Tabletas', DIMEN).clave || 'rechazado');
check(leer('Dimenhidrinato 50 mg 12 tabletas', DIMEN).clave === leer('Dramamine 50 mg Con 12 Tabletas', DIMEN).clave,
  'marca y genérico comparten llave');
// La marca no debe abrir la puerta a cualquier cosa que la mencione.
check(leer('Dramamine 50 mg Con 12 Tabletas', { nombre: 'Loratadina', raiz: 'loratadina' }).clave === null,
  'la marca de otro activo no cuela');

// ── la marca del producto ───────────────────────────────────────────────────
// Comparar por principio activo no responde "¿dónde está más barata mi
// Tempra?", que para un medicamento conocido es LA pregunta. Para eso hay que
// poder leer la marca del título, y distinguirla del activo y del relleno.
console.log('\nMarca del producto:');
const PARA = { nombre: 'Paracetamol', raiz: 'paracetamol' };
for (const [titulo, med, esperada] of [
  ['Tempra 500 mg Adultos Paracetamol caja 20 tabletas', PARA, 'Tempra'],
  ['Dimefor 850 Mg – Caja Con 30 Tabletas (Metformina)', 'Metformina', 'Dimefor'],
  ['Tylenol Analgésico Paracetamol 500mg 20 Tabletas', PARA, 'Tylenol'],
  ['Inhibitron Twit 20 mg Oral 30 Caps', 'Omeprazol', 'Inhibitron'],
  // El activo al frente significa genérico, y la marca propia de la farmacia
  // es exactamente eso: su línea de sustitutos.
  ['Paracetamol 500 mg Oral 20 tabletas Marca del Ahorro', PARA, null],
  ['Omeprazol 20 Mg Con 14 Cápsulas', 'Omeprazol', null],
  // Benavides pone la dosis primero; los números no son marca.
  ['500 mg Paracetamol', PARA, null],
  // "g" y "mg" tampoco, aunque vayan al principio.
  ['g Paracetamol 500 mg 10 tabletas Kendrick', PARA, null],
]) {
  const r = marca(titulo, med);
  check(r === esperada, `${(esperada || '—genérico—').padEnd(12)} ${titulo.slice(0, 48)}`, String(r));
}

// La marca se acepta como evidencia del activo solo si es la palabra completa:
// "Temprafen" es ibuprofeno, no un Tempra más largo.
const CON_TEMPRA = { ...PARA, sinonimos: ['Tempra'] };
check(leer('Tempra 160 Mg 30 Tabletas Masticables', CON_TEMPRA).clave === 'paracetamol|160mg|tabletas|30',
  'un título que solo dice la marca sí se lee');
check(leer('Temprafen 400 Mg Con 10 Cápsulas', CON_TEMPRA).clave === null,
  'Temprafen no pasa por Tempra');
check(leer('Tempra 160 Mg 30 Tabletas Masticables', PARA).clave === null,
  'sin haber preguntado por la marca, no se asume');

// ── combinados que SÍ son lo que se buscó ───────────────────────────────────
// "Vildagliptina/Metformina" se descarta porque se buscaba metformina sola.
// Amoxicilina con clavulánico es lo contrario: la combinación es el producto,
// y exigir los dos activos es lo que impide que se cuele la amoxicilina sola,
// que cuesta la tercera parte.
console.log('\nCombinados declarados:');
const AMOXI = {
  nombre: 'Amoxicilina con Ác. Clavulánico',
  activos: ['Amoxicilina', 'Ácido clavulánico'],
  raices: ['amoxicilina', 'clavulan'],
};
for (const [titulo, esperada] of [
  ['Amoxicilina con Ácido Clavulánico 875/125 mg Con 14 Tabletas', 'amoxicilina+acido clavulanico|875/125mg|tabletas|14'],
  ['Amoxicilina/Clavulanato de Potasio 875 mg / 125 mg 14 tabletas', 'amoxicilina+acido clavulanico|875/125mg|tabletas|14'],
]) {
  const r = leer(titulo, AMOXI);
  check(r.clave === esperada, `${titulo.slice(0, 48)}`, r.clave || 'rechazado');
}
check(leer('Amoxicilina 500 mg Con 12 Cápsulas', AMOXI).clave === null,
  'la amoxicilina sola no pasa por el combinado');
// Y al revés: buscando el activo simple, el combinado se sigue descartando.
check(leer('Amoxicilina con Ácido Clavulánico 875/125 mg 14 Tabletas', 'Amoxicilina').clave === null,
  'el combinado no pasa por el activo simple');
// Dos dosis distintas del mismo combinado no son la misma caja.
check(leer('Amoxicilina con Ácido Clavulánico 875/125 mg 14 Tabletas', AMOXI).clave
   !== leer('Amoxicilina con Ácido Clavulánico 500/125 mg 14 Tabletas', AMOXI).clave,
  '875/125 y 500/125 son filas distintas');

// ── los ml de un inyectable no son una unidad de comparación ────────────────
// Los ml de una pluma precargada son el volumen del dispositivo. Compararlos
// contra los de un frasco ámpula es el mismo error que ya costó una corrección
// en la vertical de GLP-1; aquí se corta antes de que pueda repetirse.
console.log('\nInyectables y líquidos:');
for (const [titulo, sust, debe] of [
  ['Mounjaro Tirzepatida 2.5 mg / 0.5 ml Pluma Precargada', 'Tirzepatida', null],
  ['Insulina Glargina 100 UI 3 ml Cartucho', 'Insulina Glargina', null],
  ['Ceftriaxona 1 g Solución Inyectable Frasco Ámpula 10 ml', 'Ceftriaxona', null],
]) {
  const r = leer(titulo, sust);
  check(r.clave === debe, `sin llave: ${titulo.slice(0, 46)}`, r.clave || '');
}
const jarabe = leer('Paracetamol 100 mg Suspensión Infantil Frasco 15 ml', 'Paracetamol');
check(jarabe.clave === 'paracetamol|100mg|líquido|15ml', 'la suspensión oral sí se compara por ml', jarabe.clave || 'rechazado');

// ── las abreviaturas de las farmacias ───────────────────────────────────────
// Ahorro escribe "30 Caps" y "24 Tabs". En una sola corrida hay 686 "tabs",
// 176 "caps" y 20 "pz": sin reconocerlas, esos productos se quedaban sin
// número de piezas y por tanto sin fila. Son 110 productos más legibles.
console.log('\nAbreviaturas de forma:');
for (const [titulo, sust, esperada] of [
  ['Omeprazol 20 mg Oral 30 Caps', 'Omeprazol', 'omeprazol|20mg|cápsulas|30'],
  ['Paracetamol 500 mg 24 Tabs', 'Paracetamol', 'paracetamol|500mg|tabletas|24'],
  ['Metformina 850 mg 30 Tab', 'Metformina', 'metformina|850mg|tabletas|30'],
]) {
  const r = leer(titulo, sust);
  check(r.clave === esperada, `${titulo.padEnd(34)} → ${esperada}`, r.clave || 'rechazado');
}

// ── lo que la farmacia dice aparte del título ───────────────────────────────
// Benavides y San Pablo casi nunca ponen el contenido de la caja en el título,
// y por eso aportaban 8 y 11 filas de miles de productos. Las dos lo dicen en
// otro campo que ya venía en la misma respuesta y se estaba tirando: Benavides
// en el slug de la URL, San Pablo en `additionalDescription`.
console.log('\nEl contenido de la caja, cuando no está en el título:');
for (const [titulo, detalle, sust, esperada] of [
  // Benavides: "20 mg Omeprazol" a secas; el slug trae las cápsulas.
  ['20 mg Omeprazol', 'farmacias benavides 20 mg omeprazol 120 capsulas', 'Omeprazol', 'omeprazol|20mg|cápsulas|120'],
  ['500 mg Paracetamol', 'tylenol 500 mg paracetamol 20 tabletas', 'Paracetamol', 'paracetamol|500mg|tabletas|20'],
  // San Pablo: el nombre trae la dosis y la descripción la caja.
  ['Omeprazol 20 MG', 'Aurax 120 Cápsulas Frasco', 'Omeprazol', 'omeprazol|20mg|cápsulas|120'],
  ['Metformina 850 MG', 'Dabex 30 Tabletas Caja', 'Metformina', 'metformina|850mg|tabletas|30'],
]) {
  const r = leer(`${titulo} ${detalle}`, sust);
  check(r.clave === esperada, `${titulo.padEnd(20)} + detalle → ${esperada}`, r.clave || 'rechazado');
}
// Sin el campo extra, esos mismos títulos no se pueden comparar: es justo la
// diferencia que este cambio recupera.
check(leer('20 mg Omeprazol', 'Omeprazol').clave === null, 'el título solo sigue sin alcanzar');

// ── los ml del envase no son los de la concentración ────────────────────────
// "Febraxito 100 mg / 1 ml Paracetamol 30 ml Gotas": el frasco es de 30 ml y
// el "1 ml" es el denominador de la dosis. Tomar el primero inventaba una
// presentación de 1 ml y metía en la misma fila frascos de distinto tamaño.
console.log('\nEnvase contra concentración:');
for (const [titulo, esperado] of [
  ['Febraxito 100 mg 1 ml Paracetamol 30 ml Gotas', 30],
  ['Paracetamol 100 mg/1 ml Solución 15 ml', 15],
  ['Amoxil 250 mg Amoxicilina 75 ml Suspensión', 75],
]) {
  check(mililitros(titulo) === esperado, `${esperado} ml · ${titulo.slice(0, 44)}`, String(mililitros(titulo)));
}

// ── la llave se lee de vuelta ───────────────────────────────────────────────
console.log('\nEtiqueta legible:');
check(etiqueta('omeprazol|20mg|cápsulas|14') === 'Omeprazol 20mg · 14 cápsulas', '"Omeprazol 20mg · 14 cápsulas"');
check(etiqueta('paracetamol|100mg|líquido|15ml') === 'Paracetamol 100mg · 15ml', 'líquidos se etiquetan por ml');

// ── el catálogo y las farmacias están bien formados ─────────────────────────
console.log('\nIntegridad:');
const meds = V.catalogo.medicamentos;
// No se afirma un número: la hoja crece —empezó en 100 y ya va en 200— y un
// número a mano solo dice cuándo se actualizó el test. Lo que sí tiene que ser
// cierto es que el catálogo esté al día con la hoja de la que sale: si alguien
// agrega renglones y olvida reconstruirlo, aquí se ve.
const hoja = require('fs').readFileSync(
  require('path').join(__dirname, '..', 'data', 'medicinas', 'hoja-origen.csv'), 'utf8');
const ranksHoja = new Set([...hoja.matchAll(/(?:^|")(\d{1,3}),[A-ZÁÉÍÓÚÑ]/gm)].map((m) => Number(m[1])));
const ranksCat = new Set(meds.map((m) => m.rank));
const sinConstruir = [...ranksHoja].filter((r) => !ranksCat.has(r));
check(sinConstruir.length === 0,
  `${meds.length} medicamentos, al día con los ${ranksHoja.size} renglones de la hoja`,
  `faltan los rangos ${sinConstruir.join(',')} — corre construir-catalogo-medicinas.js --apply`);
check(meds.every((m) => m.nombre && m.query && m.rank), 'todos con nombre, query y rank');
// Sin raíz no hay forma de reconocer el activo dentro de un título.
check(meds.every((m) => m.raiz || (m.raices && m.raices.length)), 'todos con raíz para reconocer el activo');
check(new Set(meds.map((m) => m.nombre)).size === meds.length, 'sin nombres duplicados');
check(V.adaptadores.every((x) => x.id && typeof x.buscar === 'function'), 'todo adaptador expone buscar()');
// YZA no debe reaparecer: su robots.txt prohíbe todo rastreo.
check(!V.columnas.includes('YZA') && !V.adaptadores.some((x) => x.id === 'YZA'),
  'YZA fuera (robots.txt: Disallow: /)');
check(!V.columnas.includes('Clivi') && !V.columnas.includes('Revert'),
  'Clivi y Revert fuera de esta vertical');

// ── la página y el feed no se pueden desincronizar ──────────────────────────
// El comparador de laboratorio lleva los datos incrustados en el HTML; este no:
// los pide a data/medicinas/prices.json al cargar. Eso lo hace más simple de
// refrescar, pero también significa que un cambio de nombre de campo en el
// scanner rompe la página sin que nada falle en el scan. Estas pruebas son ese
// candado.
console.log('\nPágina del comparador:');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PAGINA = path.join(ROOT, 'pages', 'medicinas.html');
const html = fs.readFileSync(PAGINA, 'utf8');

// Los ids que busca el script tienen que existir en el marcado.
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const usados = [...new Set([...html.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]))];
const idsFaltantes = usados.filter((i) => !ids.has(i));
check(idsFaltantes.length === 0, `los ${usados.length} ids referenciados existen`, idsFaltantes.join(', '));

// Los logos del orbit tienen que estar en disco: un src roto se ve como un
// hueco blanco en el hero, que es lo primero que ve cualquiera.
const assets = [...html.matchAll(/(?:src|href)="(\/[^"]+\.(?:png|jpe?g|webp|svg))"/g)].map((m) => m[1]);
const rotos = assets.filter((r) => !fs.existsSync(path.join(ROOT, r)));
check(rotos.length === 0, `los ${assets.length} logos del orbit existen`, rotos.join(', '));

// Toda ruta interna necesita rewrite en vercel.json, o es un 404.
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const rutas = new Set(vercel.rewrites.map((r) => r.source).concat(['/', '/blog']));
const enlaces = [...new Set([...html.matchAll(/href="(\/[a-z0-9-]*)"/g)].map((m) => m[1]))];
const huerfanos = enlaces.filter((l) => !rutas.has(l));
check(huerfanos.length === 0, `los ${enlaces.length} enlaces internos tienen destino`, huerfanos.join(', '));
check(rutas.has('/medicinas'), '/medicinas tiene rewrite en vercel.json');

// Ninguna de las dos marcas que el cliente pidió sacar de esta vertical puede
// reaparecer en la página, ni como logo ni como texto.
check(!/yza/i.test(html) && !/clivi/i.test(html) && !/revert/i.test(html),
  'ni YZA ni Clivi ni Revert aparecen en la página');

// El feed publicado trae los campos que la página lee.
const feed = path.join(ROOT, 'data', 'medicinas', 'prices.json');
if (fs.existsSync(feed)) {
  const d = JSON.parse(fs.readFileSync(feed, 'utf8'));
  const campos = ['etiqueta', 'categoria', 'medicamento', 'precios', 'min', 'ahorro', 'piezas'];
  const primera = d.presentaciones[0] || {};
  const sin = campos.filter((k) => !(k in primera));
  check(d.presentaciones.length > 0 && sin.length === 0,
    `el feed trae los ${campos.length} campos que la página lee`, sin.join(', '));
  // Las marcas conocidas del activo tienen que viajar con la presentación.
  // Sin ellas, buscar "Ozempic" o "Wegovy" en la página no encontraba la
  // semaglutida que sí estaba publicada: el alias vivía en el catálogo y nunca
  // llegaba al navegador.
  const conAlias = require('path').join(ROOT, 'scripts', 'verticales', 'medicinas-catalogo.json');
  const alias = Object.fromEntries(require(conAlias).medicamentos
    .filter((m) => m.tambien).map((m) => [m.nombre, m.tambien]));
  const sinAlias = d.presentaciones.filter((p) => alias[p.medicamento] && !p.tambien);
  check(sinAlias.length === 0, 'las presentaciones llevan las marcas conocidas de su activo',
    sinAlias.slice(0, 3).map((p) => p.medicamento).join(' · '));

  // Cada fila publicada debe tener al menos dos farmacias: es la premisa de
  // toda la vertical, y lo único que hace honesta la etiqueta "más barata".
  const flacas = d.presentaciones.filter((p) => Object.keys(p.precios).length < 2);
  check(flacas.length === 0, 'ninguna fila publicada tiene una sola farmacia',
    flacas.slice(0, 3).map((p) => p.etiqueta).join(' · '));
}

console.log(fallos ? `\n✗ ${fallos} casos fallaron` : '\n✓ Todos los casos pasaron');
process.exit(fallos ? 1 : 0);
