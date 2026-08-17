#!/usr/bin/env node
/**
 * Medcompara — Tabla de precios renderizada en el servidor
 * ---------------------------------------------------------------------------
 * El comparador pinta sus 620 estudios desde JavaScript: RAW_DATA vive dentro de
 * un <script> y la tabla se arma en el navegador. Para quien no ejecuta JS —y
 * Googlebot encola el renderizado aparte, con un presupuesto que un dominio
 * nuevo casi no tiene— la página son 549 palabras sin un solo precio, teniendo
 * 3,124 detrás.
 *
 * Este script publica los estudios más buscados como una tabla HTML de verdad,
 * en una sección propia que el JS del comparador no toca. El comparador
 * interactivo sigue exactamente igual: esto se suma, no lo reemplaza.
 *
 * Usage:
 *   node scripts/generar-tabla-precios.js            # dry-run
 *   node scripts/generar-tabla-precios.js --apply    # escribe
 *   node scripts/generar-tabla-precios.js --top=80   # cambia el corte
 *
 * POR QUÉ TIENE QUE CORRER CADA SEMANA
 * RAW_DATA puede envejecer sin consecuencia: es el fallback que sólo se ve si
 * /data/precios.json no carga, y el sitio consume el feed en caliente. Esta
 * tabla no — es contenido publicado, y un precio publicado que no se refresca
 * es exactamente la cifra a mano contra la que advierte CLAUDE.md. Por eso el
 * script va en el workflow semanal y por eso test-tabla-precios.js revienta si
 * una cifra de la tabla no coincide con el feed.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, COMPARADOR_LAB } = require('./lib/rutas');
const { LAB_IDS } = require('./lib/apply');

const APPLY = process.argv.includes('--apply');
const TOP = Number((process.argv.find((a) => a.startsWith('--top=')) || '').split('=')[1]) || 60;

const FEED = path.join(ROOT, 'data', 'precios.json');
const COPY_ESTUDIOS = path.join(ROOT, 'scripts', 'estudios-blog-copy.json');

const INICIO = '<!-- TABLA-PRECIOS:INICIO — generado por scripts/generar-tabla-precios.js, no editar a mano -->';
const FIN = '<!-- TABLA-PRECIOS:FIN -->';
const ANCLA = '  <!-- PROMO CTA -->';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const pesos = (n) => '$' + Math.round(n).toLocaleString('es-MX');

/**
 * Los estudios que se publican.
 *
 * El feed ya viene ordenado por relevancia en su primer tramo (Biometría,
 * Química Sanguínea, Glucosa, HbA1c…) y después se vuelve alfabético, así que
 * el corte por posición es una señal razonable. Pero no basta: Colesterol Total
 * cae en el #58, Creatinina en el #62 y Ácido Úrico en el #64, y los tres
 * tienen página propia porque hay demanda medida. De ahí la unión con los
 * estudios curados — publicar la tabla sin ellos sería dejar fuera justo los
 * que ya sabemos que la gente busca.
 */
function seleccionar(estudios) {
  const curados = new Set(
    JSON.parse(fs.readFileSync(COPY_ESTUDIOS, 'utf8'))
      .filter((x) => x.tipo === 'estudio' && x.estudio)
      .map((x) => x.estudio)
  );
  const vistos = new Set();
  const sel = [];
  estudios.forEach((e, i) => {
    if ((i < TOP || curados.has(e.name)) && !vistos.has(e.name)) {
      vistos.add(e.name);
      sel.push(e);
    }
  });
  return { sel, curadosFuera: [...curados].filter((c) => !vistos.has(c)) };
}

/** Fecha del scan en palabras. Nunca new Date(): prometería una frescura que la tabla no tiene. */
function fechaLegible(iso) {
  const d = new Date(iso);
  return `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

function construir(feed) {
  const { sel, curadosFuera } = seleccionar(feed.estudios);
  const iso = String(feed.generado || feed.generated_at).slice(0, 10);
  const restantes = feed.estudios.length - sel.length;

  const encabezado = ['Estudio', ...LAB_IDS, 'Más barato']
    .map((h) => `<th>${esc(h)}</th>`).join('');

  const filas = sel.map((e) => {
    const celdas = LAB_IDS.map((lab) => {
      const v = e[lab];
      if (typeof v !== 'number' || !(v > 0)) return '<td>—</td>';
      const barato = e.cheapest === lab;
      return barato
        ? `<td><strong style="color:#059669;">${pesos(v)}</strong></td>`
        : `<td>${pesos(v)}</td>`;
    }).join('');
    const mejor = e.cheapest ? `<span class="badge-cheap">${esc(e.cheapest)}</span>` : '—';
    return `      <tr><th scope="row">${esc(e.name)}</th>${celdas}<td>${mejor}</td></tr>`;
  }).join('\n');

  // La banda propia no es decorativa: la sección cae entre el bloque blanco de
  // confianza y el CTA en navy, así que sin un fondo explícito hereda el oscuro
  // y la tabla queda texto negro sobre negro.
  const html = `${INICIO}
  <div class="precios-publicos-bg">
    <div class="precios-publicos">
      <h2>Precios de los ${sel.length} estudios más buscados</h2>
      <p class="precios-fecha">Comparados entre ${LAB_IDS.length} laboratorios. Precios del <time datetime="${iso}">${fechaLegible(iso)}</time>.</p>
      <div class="tabla-scroll"><table class="price-table">
        <tr>${encabezado}</tr>
${filas}
      </table></div>
      <p class="precios-resto">Y ${restantes.toLocaleString('es-MX')} estudios más en el comparador de arriba.</p>
    </div>
  </div>
  ${FIN}`;

  return { html, sel, curadosFuera, iso };
}

/**
 * Valida antes de escribir, como el resto de los generadores: si una cifra de la
 * tabla no sale del feed, no se publica nada. Mejor no publicar que publicar un
 * precio inventado.
 */
function validar(html, sel) {
  const delFeed = new Set();
  for (const e of sel) {
    for (const lab of LAB_IDS) {
      if (typeof e[lab] === 'number' && e[lab] > 0) delFeed.add(pesos(e[lab]));
    }
  }
  const publicadas = html.match(/\$[\d,]+/g) || [];
  const intrusas = [...new Set(publicadas.filter((p) => !delFeed.has(p)))];
  if (intrusas.length) {
    console.error(`\n❌ ${intrusas.length} cifra(s) en la tabla que no vienen del feed:`);
    intrusas.forEach((p) => console.error('     ' + p));
    console.error('\n   No se escribió nada.\n');
    process.exit(1);
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
if (!fs.existsSync(FEED)) {
  console.error(`No existe ${path.relative(ROOT, FEED)}. Corre antes: npm run scan:labs`);
  process.exit(1);
}
const feed = JSON.parse(fs.readFileSync(FEED, 'utf8'));
const { html, sel, curadosFuera, iso } = construir(feed);
validar(html, sel);

console.log('\n🧾 Medcompara · tabla de precios en servidor');
console.log(`   feed      : ${iso} · ${feed.estudios.length} estudios`);
console.log(`   corte     : primeros ${TOP} + curados`);
console.log(`   publicados: ${sel.length} estudios · ${(html.length / 1024).toFixed(1)} KB de HTML`);
if (curadosFuera.length) {
  console.log(`   ⚠️  ${curadosFuera.length} estudio(s) curado(s) sin fila en el feed:`);
  curadosFuera.forEach((c) => console.log(`        ${c}`));
}

const antes = fs.readFileSync(COMPARADOR_LAB, 'utf8');
const rx = new RegExp(`${INICIO.replace(/[.*+?^${}()|[\]\\—]/g, '\\$&')}[\\s\\S]*?${FIN}`);
let despues;
if (rx.test(antes)) {
  despues = antes.replace(rx, html);
} else if (antes.includes(ANCLA)) {
  despues = antes.replace(ANCLA, `${html}\n\n${ANCLA}`);
} else {
  console.error(`\nNo se encontró dónde insertar: falta el bloque ${INICIO} y el ancla "${ANCLA.trim()}".\n`);
  process.exit(1);
}

if (!APPLY) {
  console.log('\n   (nada escrito — corre con --apply para aplicarlo)\n');
} else {
  fs.writeFileSync(COMPARADOR_LAB, despues);
  console.log(`\n✅ pages/laboratorio.html actualizado: ${sel.length} estudios publicados en HTML.\n`);
}
