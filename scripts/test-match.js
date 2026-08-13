#!/usr/bin/env node
/**
 * Medcompara — Test del emparejador de nombres de estudio
 * --------------------------------------------------------
 * Emparejar mal no rompe nada visiblemente: publica un precio equivocado y se
 * ve igual de normal que uno correcto. Por eso cada caso de aquí es un fallo
 * real que se encontró revisando el scan de los 6 laboratorios, congelado como
 * assertion para que no vuelva.
 *
 *   node scripts/test-match.js
 */

'use strict';

const { similitud, emparejar } = require('./lib/match');

const UMBRAL = 0.82;

/**
 * DEBEN emparejar: el laboratorio nombra el mismo estudio de otra forma.
 */
const IGUALES = [
  ['Química Sanguínea 6 Elementos', 'Química Sanguínea (6)'],
  ['Química Sanguínea 45 Elementos', 'Química sanguínea de 45 elementos (Q45)'],
  ['Proteína C Reactiva (PCR)', 'PROTEINA C REACTIVA'],
  ['Proteína C Reactiva (PCR)', 'Proteina C. Reactiva'],
  ['Grupo Sanguíneo y Rh', 'GRUPO SANGUÍNEO Y FACTOR RH'],
  ['Ácido Fólico', 'FOLATOS (ACIDO FOLICO)'],
  ['CA-125 (Marcador Tumoral Ovario)', 'ANTIGENO CA 125 --OVARIO--'],
  ['Marcadores Tumorales Páncreas (CA 19-9)', 'CA 19-9 EN SUERO'],
  ['Colesterol HDL', 'Colesterol de Alta Densidad (HDL)'],
  ['Colesterol LDL', 'Colesterol de Baja Densidad (LDL)'],
  ['Deshidrogenasa Láctica (DHL)', 'DESHIDROGENASA LACTICA (LDH)'],
  ['Velocidad de Sedimentación Globular (VSG)', 'Sedimentación Globular'],
  ['TSH (Hormona Estimulante de Tiroides)', 'Tsh (H. Estimulante de Tiroides)'],
  ['Antígeno Prostático Específico (PSA Total)', 'ANTÍGENO PROSTÁTICO ESPECÍFICO TOTAL EN SUERO'],
  ['Perfil de Lípidos', 'PERFIL LIPOIDEO'],
  ['Perfil de Lípidos', 'PERFIL DE LÍPIDOS EN SUERO'],
  ['Calcio Sérico', 'CALCIO'],
  ['Examen General de Orina (EGO)', 'EXAMEN GENERAL DE ORINA'],
];

/**
 * NO deben emparejar: se parecen mucho pero son estudios distintos, con precios
 * distintos. Cada uno cuesta un precio equivocado publicado.
 */
const DISTINTOS = [
  // "PCR" es la técnica, no la proteína C reactiva
  ['Proteína C Reactiva (PCR)', 'DETECCIÓN DE POLIOMAVIRUS BK POR PCR'],
  ['Proteína C Reactiva (PCR)', 'Citomegalovirus por PCR-RT'],
  // sensibilidad distinta = ensayo distinto
  ['Proteína C Reactiva (PCR)', 'PROTEINA C REACTIVA DE ALTA SENSIBILIDAD'],
  // el número del panel importa
  ['Química Sanguínea 6 Elementos', 'QUÍMICA DE 12 ELEMENTOS'],
  ['Química Sanguínea 27 Elementos', 'Química sanguínea de 45 elementos (Q45)'],
  // los romanos distinguen variantes del perfil
  ['Perfil Tiroideo', 'Perfil Tiroideo II'],
  ['Perfil Hepático', 'Perfil Hepático I'],
  // la letra de la vitamina / del antígeno lo es todo
  ['Vitamina B12', 'VITAMINA A (RETINOL)'],
  ['Vitamina D (25-Hidroxi)', 'VITAMINA A (RETINOL)'],
  ['Antígeno Superficie Hepatitis B', 'HEPATITIS B ANTIGENO E'],
  // un estudio suelto no es su paquete
  ['Química Sanguínea 45 Elementos', 'CHECK UP SALUD QUÍMICA DE 45 ELEMENTOS'],
  ['Prueba Antidoping', 'Perfil Antidoping'],
  // un panel no es otro panel que lo contiene
  ['Perfil Básico', 'Perfil básico vías urinarias'],
  ['Perfil Básico', 'Perfil hipertensión básico'],
  ['Perfil Hormonal Femenino', 'Perfil hormonal'],
  // un token no alcanza para inferir
  ['TGO (Transaminasa Glutámico Oxalacética)', 'TGO y TGP'],
  ['TSH (Hormona Estimulante de Tiroides)', 'TSH - Neonatal'],
  ['Cortisol Sérico', 'CORTISOL BASAL'],
  ['Glucosa en Suero', 'GLUCOSA EN SUERO AL AZAR'],
  ['Mastografía', 'MASTOGRAFÍA UNILATERAL'],
  ['Calcio Sérico', 'CALCIO Y FOSFORO EN SUERO'],
  // la matriz de la muestra cambia el estudio
  ['Bicarbonato en Sangre', 'Bicarbonato Urinario'],
  // fracción distinta
  ['Antígeno Prostático Específico (PSA Total)', 'ANTIGENO PROSTÁTICO ESPECIFICO LIBRE EN SUERO'],
  // una letra suelta no se alinea con una palabra solo por compartir inicial:
  // la "S" de "Proteína S" no es "sanguínea"
  ['Pruebas de Coagulación Sanguínea', 'Proteina S de Coagulación (Antigénica)'],
  // plural/singular sí colapsa, pero no borra la diferencia de analito
  ['Marcadores Tumorales Colon (CEA)', 'MARCADOR TUMORAL CA 15-3'],
  ['Vitamina B12', 'ACIDO FÓLICO Y VITAMINA B12 EN SUERO'],
  // el paréntesis con número identifica: $426 vs $2,016
  ['Baciloscopia BAAR (5 Muestras)', 'Baciloscopia BAAR'],
  // el método cambia el precio 15x
  ['Nicotina en Orina', 'NICOTINA EN ORINA PRUEBA RÁPIDA'],
  // el líquido de la muestra cambia el estudio
  ['Adenosin deaminasa', 'Adenosin deaminasa en Liq. Peritoneal'],
  // un cultivo de hongos no es un cultivo bacteriano
  ['Cultivo de Expectoración', 'CULTIVO DE HONGOS EN EXPECTORACIÓN'],
];

let fallos = 0;
const linea = (ok, a, b, s) => {
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${s.toFixed(3)}  "${a}"  ${ok ? '·' : '·'}  "${b}"`);
};

console.log('Deben emparejar (similitud ≥ %s):', UMBRAL);
for (const [a, b] of IGUALES) {
  const s = similitud(a, b);
  linea(s >= UMBRAL, a, b, s);
}

console.log('\nNO deben emparejar (similitud < %s):', UMBRAL);
for (const [a, b] of DISTINTOS) {
  const s = similitud(a, b);
  linea(s < UMBRAL, a, b, s);
}

// El emparejador completo: sin match no se inventa nada.
console.log('\nComportamiento de emparejar():');
const canonicos = ['Biometría Hemática', 'Perfil Tiroideo'];
const { mapeo, sinMatch } = emparejar(canonicos, [
  { nombre: 'BIOMETRIA HEMATICA', precio: 115 },
  { nombre: 'Perfil Tiroideo II', precio: 811 },
  { nombre: 'ESTUDIO QUE NO EXISTE EN MEDCOMPARA', precio: 999 },
]);

// Gana el mejor parecido, no el precio más bajo: un match exacto caro debe
// vencer a uno difuso barato.
const puntaje = emparejar(['Antitrombina III (Funcional)'], [
  { nombre: 'Antitrombina III (Antigénica)', precio: 482 },
  { nombre: 'Antitrombina III (Funcional)', precio: 1843 },
]).mapeo.get('Antitrombina III (Funcional)');

// Con el mismo parecido sí manda el precio: un lab que lista dos veces el
// mismo estudio no debe encarecer la comparativa.
const empate = emparejar(['Glucosa en Suero'], [
  { nombre: 'GLUCOSA EN SUERO', precio: 120 },
  { nombre: 'Glucosa en suero', precio: 94 },
]).mapeo.get('Glucosa en Suero');

const casos = [
  ['empareja el que sí corresponde', mapeo.get('Biometría Hemática') && mapeo.get('Biometría Hemática').precio === 115],
  ['no inventa el que no corresponde', !mapeo.has('Perfil Tiroideo')],
  ['reporta los no emparejados', sinMatch.length === 2],
  ['gana el mejor parecido, no el más barato', puntaje && puntaje.precio === 1843],
  ['a igual parecido, gana el más barato', empate && empate.precio === 94],
];
for (const [nombre, ok] of casos) {
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}`);
}

console.log(fallos ? `\n✗ ${fallos} casos fallaron` : `\n✓ Los ${IGUALES.length + DISTINTOS.length + casos.length} casos pasaron`);
process.exit(fallos ? 1 : 0);
