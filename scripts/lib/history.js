/**
 * Labcompara — Serie histórica de precios
 * ----------------------------------------
 * Mismo formato que `data/price-history.json` de GLPcompara, para que los dos
 * comparadores se puedan graficar con el mismo código:
 *
 *   { generated_at, currency, labs, note,
 *     series: { "<estudio>": [ { date, prices: {lab: n|null}, avg, n } ] } }
 *
 * Un punto por estudio por día. Si el scan se re-corre el mismo día, el punto
 * se reemplaza en vez de duplicarse.
 *
 * Solo se guardan fechas con `MIN_LABS` o más precios verificados: si una
 * semana un laboratorio falla y su columna desaparece, el promedio se movería
 * solo por eso y la gráfica mostraría una caída de precio que nunca ocurrió.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MIN_LABS = 3;

/**
 * @param {string} archivo         ruta de data/price-history.json
 * @param {object[]} estudios      matriz consolidada [{name, <lab>: precio, …}]
 * @param {string[]} labs          orden de laboratorios
 * @param {string} generado        ISO timestamp de la corrida
 * @returns {{estudios:number, puntos:number}}
 */
function actualizarHistorial(archivo, estudios, labs, generado) {
  let hist;
  try {
    hist = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  } catch {
    hist = { currency: 'MXN', series: {} };
  }
  const series = hist.series || (hist.series = {});
  const dia = generado.slice(0, 10); // YYYY-MM-DD

  let puntos = 0;
  for (const e of estudios) {
    const precios = {};
    for (const l of labs) precios[l] = typeof e[l] === 'number' && e[l] > 0 ? e[l] : null;
    const vals = Object.values(precios).filter((v) => v !== null);
    if (vals.length < MIN_LABS) continue;

    const punto = {
      date: dia,
      prices: precios,
      avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
      n: vals.length,
    };
    const pts = series[e.name] || (series[e.name] = []);
    if (pts.length && pts[pts.length - 1].date === dia) pts[pts.length - 1] = punto;
    else pts.push(punto);
    puntos++;
  }

  hist.generated_at = generado;
  hist.currency = 'MXN';
  hist.labs = labs;
  hist.note = 'Precio por estudio a lo largo del tiempo: promedio y por laboratorio. ' +
    `Solo fechas con cobertura de ${MIN_LABS}+ laboratorios.`;

  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, JSON.stringify(hist, null, 0));
  return { estudios: Object.keys(series).length, puntos };
}

module.exports = { actualizarHistorial, MIN_LABS };
