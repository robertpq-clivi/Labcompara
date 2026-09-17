#!/usr/bin/env node
/**
 * Medcompara — Repara las fechas del `Article` que el scan había inflado.
 *
 *   node scripts/reparar-fechas-blog.js                        # dry-run
 *   node scripts/reparar-fechas-blog.js --apply                # escribe
 *   node scripts/reparar-fechas-blog.js --apply --origen ../GLPcompara
 *
 * Pasada de una sola vez. `lib/fechas-articulo.js` evita que el problema vuelva
 * a partir de la próxima corrida; esto arregla lo que ya está publicado.
 *
 * QUÉ ESTABA MAL. Los generadores escribían las dos fechas con la fecha del
 * scan, así que cada domingo las 56 páginas generadas volvían a declararse
 * publicadas ese mismo día. La corrida del 30 de agosto de 2026 movió la fecha
 * de alta de 56 artículos —`salud-digna-vs-chopo-precios` pasó a decir que
 * nació ese día, cuando el archivo existe desde el 19 de marzo— y en buena
 * parte de ellos el único cambio del diff eran esas fechas.
 *
 * DE DÓNDE SALEN LAS BUENAS.
 *
 *   datePublished · la más antigua entre la que declara el archivo, el commit
 *                   que lo dio de alta aquí y —con `--origen`— el que lo dio de
 *                   alta en el repo del que se migró. Los 157 artículos que
 *                   vinieron de GLPcompara se publicaron meses antes de llegar
 *                   a este repo: su alta local es la migración, no su estreno.
 *
 *   dateModified  · el commit más reciente en el que el contenido cambió de
 *                   verdad. Se compara cada revisión con la anterior después de
 *                   neutralizar las fechas, con el mismo criterio que usará el
 *                   generador cada domingo, así que las corridas que sólo
 *                   movieron la fecha no cuentan como modificación.
 *
 * Nunca adelanta una fecha: si el cálculo da algo más reciente que lo que ya
 * dice la página, se queda lo que estaba.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT } = require('./lib/rutas');
const { sinFechas, fechaDe, masAntigua, ponerFechas } = require('./lib/fechas-articulo');

const BLOG = path.join(ROOT, 'blog');
const APLICAR = process.argv.includes('--apply');
const ORIGEN = (() => {
  const i = process.argv.indexOf('--origen');
  return i > -1 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : null;
})();

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

/** Fecha del commit que dio de alta el archivo en un repo, o null. */
function alta(rel, repo) {
  const out = git(['log', '--diff-filter=A', '--format=%as', '--', rel], repo);
  if (!out) return null;
  const lineas = out.trim().split('\n').filter(Boolean);
  return lineas[lineas.length - 1] || null;
}

/**
 * Último commit en el que el contenido cambió, ignorando las fechas.
 *
 * Recorre el historial de nuevo a viejo y se detiene en la primera revisión que
 * difiere de su antecesora. Si el archivo sólo tiene un commit, esa es.
 */
function ultimaModificacionReal(rel) {
  const out = git(['log', '--format=%H%x09%as', '--', rel], ROOT);
  if (!out) return null;
  const commits = out.trim().split('\n').filter(Boolean).map((l) => l.split('\t'));
  if (!commits.length) return null;

  let actual = null;
  for (let i = 0; i < commits.length; i++) {
    const [sha, fecha] = commits[i];
    if (actual === null) {
      const blob = git(['show', `${sha}:${rel}`], ROOT);
      actual = blob === null ? null : sinFechas(blob);
    }
    const siguiente = commits[i + 1];
    if (!siguiente) return fecha; // el commit de alta
    const previo = git(['show', `${siguiente[0]}:${rel}`], ROOT);
    const previoNorm = previo === null ? null : sinFechas(previo);
    if (actual !== previoNorm) return fecha;
    actual = previoNorm;
  }
  return commits[commits.length - 1][1];
}

function main() {
  const archivos = fs.readdirSync(BLOG)
    .filter((f) => f.endsWith('.html') && f !== 'index.html').sort();

  const cambios = [];
  let sinArticle = 0;

  for (const archivo of archivos) {
    const ruta = path.join(BLOG, archivo);
    const rel = `blog/${archivo}`;
    const html = fs.readFileSync(ruta, 'utf8');

    const pubActual = fechaDe(html, 'datePublished');
    const modActual = fechaDe(html, 'dateModified');
    if (!pubActual && !modActual) { sinArticle++; continue; }

    const publicado = masAntigua(
      pubActual,
      alta(rel, ROOT),
      ORIGEN ? alta(rel, ORIGEN) : null,
    ) || pubActual;

    // Sólo se atrasa: si el historial dice algo más nuevo, se respeta la página.
    const real = ultimaModificacionReal(rel);
    let modificado = masAntigua(modActual, real) || modActual;
    if (modificado && publicado && modificado < publicado) modificado = publicado;

    if (publicado === pubActual && modificado === modActual) continue;

    cambios.push({ archivo, pubActual, publicado, modActual, modificado });
    if (APLICAR) fs.writeFileSync(ruta, ponerFechas(html, publicado, modificado));
  }

  for (const c of cambios) {
    const pub = c.publicado === c.pubActual ? '' : `  publicado ${c.pubActual} → ${c.publicado}`;
    const mod = c.modificado === c.modActual ? '' : `  modificado ${c.modActual} → ${c.modificado}`;
    console.log(`  ${APLICAR ? '✓' : '·'} ${c.archivo}${pub}${mod}`);
  }

  console.log(`\n${APLICAR ? 'Reparados' : 'Se repararían'} ${cambios.length} de ${archivos.length} artículos`
    + (sinArticle ? ` · ${sinArticle} sin Article` : '')
    + (ORIGEN ? ` · origen: ${path.basename(ORIGEN)}` : ' · sin --origen'));
  if (!APLICAR) console.log('(dry-run — usa --apply)');
}

main();
