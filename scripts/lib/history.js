/**
 * Medcompara — Serie histórica de precios
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
 * Retención. Sin recorte, 626 estudios × un punto semanal con el desglose de
 * los seis laboratorios crecen ~5 MB al año — y este archivo se commitea en
 * cada corrida, así que el peso se paga en cada clon del repo.
 *
 * Política: detalle completo en lo reciente, y de ahí hacia atrás un punto por
 * mes y solo el promedio. Para ver la tendencia de un año no hace falta el
 * desglose por laboratorio de cada semana de hace ocho meses.
 */
const PUNTOS_DETALLADOS = 12;   // ~3 meses con desglose por laboratorio
const MAX_PUNTOS = 60;          // ~12 semanales + ~4 años de mensuales

/** Deja un punto por mes y sin desglose en la parte antigua de la serie. */
function compactar(pts) {
  if (pts.length <= PUNTOS_DETALLADOS) return pts;

  const recientes = pts.slice(-PUNTOS_DETALLADOS);
  const antiguos = pts.slice(0, -PUNTOS_DETALLADOS);

  const porMes = new Map();
  for (const p of antiguos) porMes.set(p.date.slice(0, 7), { date: p.date, avg: p.avg, n: p.n });

  return [...porMes.values()].slice(-(MAX_PUNTOS - PUNTOS_DETALLADOS)).concat(recientes);
}

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
    series[e.name] = compactar(pts);
    puntos++;
  }

  hist.generated_at = generado;
  hist.currency = 'MXN';
  hist.labs = labs;
  hist.note = 'Precio por estudio a lo largo del tiempo: promedio y por laboratorio. ' +
    `Solo fechas con cobertura de ${MIN_LABS}+ laboratorios. ` +
    `Los últimos ${PUNTOS_DETALLADOS} puntos llevan desglose por laboratorio; ` +
    'antes de eso queda un punto mensual con el promedio.';

  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, JSON.stringify(hist, null, 0));
  return { estudios: Object.keys(series).length, puntos };
}

module.exports = { actualizarHistorial, MIN_LABS };
