/**
 * Medcompara — Respaldo de fichas por laboratorio
 * ------------------------------------------------
 * Los laboratorios en modo `catalogo` descubren sus fichas en el sitemap. Si el
 * sitemap se cae, el adaptador no tiene qué escanear y la columna entera se
 * congela, aunque las fichas sigan respondiendo.
 *
 * Es lo que le pasó a OLAB desde el 25/10/2026: olab.com.mx/sitemap.xml
 * responde 503 a cualquier User-Agent (su robots.txt lo sigue anunciando y
 * permite todo), Zyte reintenta, recibe lo mismo y lo reporta como "Website
 * Ban". Las fichas en /estudios/detalle/… responden 200 directo y el parser las
 * lee bien; lo único roto es el índice.
 *
 * Por eso, al cerrar una corrida completa, se guardan en data/fichas/<lab>.json
 * las URLs que dieron precio. Si la próxima vez el sitemap falla, se escanean
 * esas. Se commitea (a diferencia de data/scan/) porque el runner de Actions
 * arranca sin caché: un respaldo que solo existe en la máquina de alguien no
 * respalda nada.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'data', 'fichas');

const archivo = (id, dir = DIR) => path.join(dir, `${id.replace(/\s+/g, '-').toLowerCase()}.json`);

/** URLs guardadas de la última corrida completa; [] si no hay. */
function leerFichas(id, dir = DIR) {
  const f = archivo(id, dir);
  if (!fs.existsSync(f)) return [];
  const urls = JSON.parse(fs.readFileSync(f, 'utf8'));
  return Array.isArray(urls) ? urls : [];
}

/**
 * Guarda las URLs ordenadas y sin repetir. No reescribe si no cambiaron: el
 * archivo entra en el commit semanal y reordenarlo cada vez sería ruido.
 * @returns {boolean} si escribió
 */
function guardarFichas(id, urls, dir = DIR) {
  const limpias = [...new Set(urls.filter(Boolean))].sort();
  if (!limpias.length) return false;
  const nuevo = JSON.stringify(limpias, null, 1) + '\n';
  const f = archivo(id, dir);
  if (fs.existsSync(f) && fs.readFileSync(f, 'utf8') === nuevo) return false;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(f, nuevo);
  return true;
}

/**
 * `lab.urls(ctx)` con respaldo. Un sitemap que responde pero no trae ninguna
 * ficha cuenta como caído: lo más probable es que cambió de formato, y escanear
 * cero fichas congela la columna igual que un 503.
 * @returns {Promise<{urls: string[], respaldo: string|null}>} `respaldo` trae el
 *   motivo cuando se usaron las fichas guardadas
 */
async function urlsConRespaldo(lab, ctx, { log = () => {}, dir = DIR } = {}) {
  let urls = [], error = null;
  try { urls = await lab.urls(ctx); } catch (e) { error = e; }
  if (urls.length) return { urls, respaldo: null };

  const previas = leerFichas(lab.id, dir);
  if (!previas.length) {
    // Sin respaldo, el lab falla igual que antes: mismo error, mismo reporte.
    if (error) throw error;
    return { urls: [], respaldo: null };
  }
  const motivo = error ? String(error.message || error) : 'sitemap sin fichas';
  log(`sitemap no disponible (${motivo.slice(0, 120)}): se escanean las ${previas.length} fichas de la última corrida completa`);
  return { urls: previas, respaldo: motivo };
}

module.exports = { leerFichas, guardarFichas, urlsConRespaldo, archivo };
