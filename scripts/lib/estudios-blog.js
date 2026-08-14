/**
 * Medcompara — Hechos de precio por estudio de laboratorio.
 *
 * El equivalente de lib/medicinas-blog.js para la vertical de laboratorio.
 * Existe por la misma razón: las páginas de precio por estudio se escribieron
 * a mano en 2024 y se quedaron ahí. En agosto de 2026 la de biometría hemática
 * seguía anunciando "desde $95" y cotizando $491 a laboratorios que hoy cobran
 * $310, con el precio verdadero a un require de distancia en data/precios.json.
 *
 * Toda cifra publicada sale de aquí, y aquí sale del scan semanal.
 */

'use strict';

const path = require('path');
const { LABS, cargarPrecios } = require('./comparativas');

/** Cómo se escriben en prosa los laboratorios que el catálogo abrevia. */
const NOMBRE_LAB = {
  'Salud Digna': 'Salud Digna',
  Chopo:         'Laboratorio Chopo',
  OLAB:          'OLAB',
  LAPI:          'LAPI',
  Labbe:         'Labbe',
  Polanco:       'Laboratorio Médico Polanco',
};

const mediana = xs => {
  if (!xs.length) return 0;
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.floor(o.length / 2)];
};

const pct = (bajo, alto) => (alto > 0 ? Math.round(((alto - bajo) / alto) * 100) : 0);

/**
 * Hechos de un estudio. `nombre` es el nombre canónico del catálogo; si el
 * scan deja de traerlo, esto devuelve null y el generador se niega a publicar
 * la página en vez de inventarle precios.
 */
function hechos(nombre, datos = cargarPrecios()) {
  const e = datos.estudios.find(x => x.name === nombre);
  if (!e) return null;

  const conPrecio = LABS
    .filter(l => typeof e[l] === 'number' && e[l] > 0)
    .map(l => ({ lab: l, precio: e[l] }))
    .sort((a, b) => a.precio - b.precio);

  // Con menos de tres laboratorios no hay comparación que publicar: una tabla
  // de dos filas no contesta "¿dónde me lo hago?".
  if (conPrecio.length < 3) return null;

  const precios = conPrecio.map(x => x.precio);
  const min = precios[0];
  const max = precios[precios.length - 1];

  return {
    estudio: nombre,
    labs: conPrecio,
    nLabs: conPrecio.length,
    min,
    max,
    barato: conPrecio[0].lab,
    caro:   conPrecio[conPrecio.length - 1].lab,
    ahorroPct: pct(min, max),
    veces: Math.round((max / min) * 10) / 10,
    mediana: mediana(precios),
    generado: datos.generado,
  };
}

/**
 * Hechos de una canasta de estudios (un check-up). Solo entran los
 * laboratorios que tienen precio de TODOS los estudios de la canasta: sumar
 * lo que un laboratorio sí publica y omitir lo que no lo haría ver barato por
 * incompleto, que es justo la comparación que la página promete evitar.
 */
function hechosCanasta(nombres, datos = cargarPrecios()) {
  const estudios = nombres
    .map(n => ({ nombre: n, e: datos.estudios.find(x => x.name === n) }))
    .filter(x => x.e);
  if (estudios.length < 2) return null;

  const completos = LABS.filter(l =>
    estudios.every(({ e }) => typeof e[l] === 'number' && e[l] > 0));
  if (completos.length < 3) return null;

  const total = completos
    .map(l => ({ lab: l, precio: Math.round(estudios.reduce((s, { e }) => s + e[l], 0)) }))
    .sort((a, b) => a.precio - b.precio);

  const filas = estudios.map(({ nombre, e }) => {
    const vs = completos.map(l => e[l]);
    const min = Math.min(...vs), max = Math.max(...vs);
    return {
      estudio: nombre,
      min, max,
      barato: completos.find(l => e[l] === min),
      ahorroPct: pct(min, max),
      precios: Object.fromEntries(completos.map(l => [l, e[l]])),
    };
  });

  return {
    estudios: filas,
    nEstudios: filas.length,
    labs: completos,
    nLabs: completos.length,
    total,
    min: total[0].precio,
    max: total[total.length - 1].precio,
    barato: total[0].lab,
    caro:   total[total.length - 1].lab,
    ahorroPct: pct(total[0].precio, total[total.length - 1].precio),
    generado: datos.generado,
  };
}

/**
 * Ranking de laboratorios sobre todo el catálogo comparable: en cuántos
 * estudios cada uno pone el precio más bajo. Es el hecho que sostiene una
 * página de "el laboratorio más barato" sin tener que elegir a mano.
 */
function ranking(datos = cargarPrecios()) {
  const gana = Object.fromEntries(LABS.map(l => [l, 0]));
  const catalogo = Object.fromEntries(LABS.map(l => [l, 0]));
  let comparables = 0;

  for (const e of datos.estudios) {
    const vs = LABS.filter(l => typeof e[l] === 'number' && e[l] > 0);
    for (const l of vs) catalogo[l]++;
    if (vs.length < 3) continue;
    comparables++;
    const min = Math.min(...vs.map(l => e[l]));
    for (const l of vs) if (e[l] === min) { gana[l]++; break; }
  }

  const tabla = LABS
    .map(l => ({ lab: l, gana: gana[l], catalogo: catalogo[l], pct: Math.round((gana[l] / comparables) * 100) }))
    .sort((a, b) => b.gana - a.gana);

  return { tabla, comparables, lider: tabla[0], generado: datos.generado };
}

module.exports = { LABS, NOMBRE_LAB, hechos, hechosCanasta, ranking, cargarPrecios, pct, mediana };
