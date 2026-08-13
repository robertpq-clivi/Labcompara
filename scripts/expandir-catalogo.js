#!/usr/bin/env node
/**
 * Labcompara — Ampliación del catálogo de estudios
 * -------------------------------------------------
 * El scan semanal refresca los precios de los estudios que YA están publicados;
 * nunca inventa filas nuevas (a propósito: consolidar y descubrir son
 * decisiones distintas, y una de ellas conviene revisarla a ojo).
 *
 * Este script hace la otra mitad: agrupa los ~8,265 nombres de los seis
 * laboratorios, encuentra los estudios que existen en varios y no están en el
 * comparador, y los agrega a RAW_DATA de index.html.
 *
 *   node scripts/expandir-catalogo.js              # solo reporta, no escribe
 *   node scripts/expandir-catalogo.js --apply      # escribe index.html
 *   node scripts/expandir-catalogo.js --min-labs=2 # baja el listón
 *
 * Los 124 estudios curados a mano se conservan intactos: sus nombres son las
 * llaves de STUDY_INFO y de las páginas SEO, así que renombrarlos rompería
 * cosas silenciosamente.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { agrupar } = require('./lib/agrupar');
const { clave, similitud } = require('./lib/match');
const { escribirRawData, LAB_IDS } = require('./lib/apply');

const ROOT = path.join(__dirname, '..');
const SCAN_DIR = path.join(ROOT, 'data', 'scan');

const ARCHIVO_A_LAB = {
  'salud-digna': 'Salud Digna', polanco: 'Polanco', labbe: 'Labbe',
  chopo: 'Chopo', lapi: 'LAPI', olab: 'OLAB',
};

// ── CLI ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const APPLY = argv.includes('--apply');
/**
 * Con 2 laboratorios ya se puede comparar, pero apenas. Con 3 la fila tiene
 * sustancia y —efecto secundario útil— casi todo lo de gabinete (RX, resonancia)
 * se queda fuera solo, porque suele estar en pocos laboratorios.
 */
const MIN_LABS = Number(arg('min-labs', '3')) || 3;

// ── datos ────────────────────────────────────────────────────────────────────
if (!fs.existsSync(SCAN_DIR) || !fs.readdirSync(SCAN_DIR).length) {
  console.error('No hay catálogos en data/scan/. Corre antes: npm run scan');
  process.exit(1);
}

const porLab = {};
for (const f of fs.readdirSync(SCAN_DIR).filter((x) => x.endsWith('.json'))) {
  const lab = ARCHIVO_A_LAB[f.replace('.json', '')];
  if (lab) porLab[lab] = JSON.parse(fs.readFileSync(path.join(SCAN_DIR, f), 'utf8'));
}

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const m = html.match(/const RAW_DATA\s*=\s*(\[[\s\S]*?\n\];)/);
if (!m) throw new Error('No se encontró RAW_DATA en index.html');
// eslint-disable-next-line no-new-func
const publicados = new Function(`return ${m[1].replace(/;$/, '')}`)();

// ── agrupar y quedarse con lo nuevo ──────────────────────────────────────────
const grupos = agrupar(porLab, { minLabs: MIN_LABS });

/**
 * Descartar los grupos que ya están publicados.
 *
 * No basta comparar claves exactas: "Tiempo de Tromboplastina Parcial" y
 * "Tiempo de Tromboplastina Parcial (TTP)" tienen claves distintas y son el
 * mismo estudio. Si se publican los dos, compiten por la misma fila del
 * laboratorio — una se queda con el precio bueno y la otra con el sobrante,
 * que suele ser una variante cara. Así apareció un TTP de $1,619 donde van $203.
 *
 * Por eso el descarte también usa la similitud, y contra TODAS las variantes
 * del grupo: basta que un laboratorio lo nombre como el estudio ya publicado.
 */
const yaPublicado = new Set(publicados.map((e) => clave(e.name)));
const nombresPublicados = publicados.map((e) => e.name);
const UMBRAL_DUPLICADO = 0.82;

function duplicaAlgoPublicado(g) {
  const candidatos = [g.nombre, ...Object.values(g.variantes).map((v) => v.nombre)];
  for (const c of candidatos) {
    if (yaPublicado.has(clave(c))) return true;
    for (const pubName of nombresPublicados) {
      if (similitud(pubName, c) >= UMBRAL_DUPLICADO) return true;
    }
  }
  return false;
}

const nuevos = grupos.filter((g) => !duplicaAlgoPublicado(g));

// ── construir las filas ──────────────────────────────────────────────────────
function filaDesdeGrupo(g) {
  const fila = { name: g.nombre };
  for (const l of LAB_IDS) fila[l] = g.variantes[l] ? g.variantes[l].precio : null;
  const vals = LAB_IDS.map((l) => fila[l]).filter((v) => v > 0);
  fila.avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  fila.cheapest = LAB_IDS.reduce((best, l) => (fila[l] && (!best || fila[l] < fila[best]) ? l : best), null);
  return fila;
}

const filasNuevas = nuevos.map(filaDesdeGrupo);
// Orden alfabético entre los nuevos; los curados a mano conservan el suyo.
filasNuevas.sort((a, b) => a.name.localeCompare(b.name, 'es'));
const catalogo = publicados.concat(filasNuevas);

// ── reporte ──────────────────────────────────────────────────────────────────
const porNumLabs = {};
for (const g of nuevos) porNumLabs[g.labs] = (porNumLabs[g.labs] || 0) + 1;

console.log('Labcompara · ampliación de catálogo');
console.log(`  nombres agrupados   : ${Object.values(porLab).reduce((n, r) => n + r.length, 0).toLocaleString('es-MX')}`);
console.log(`  umbral              : ${MIN_LABS}+ laboratorios`);
console.log(`  estudios publicados : ${publicados.length}`);
console.log(`  estudios nuevos     : ${filasNuevas.length}`);
console.log(`  catálogo resultante : ${catalogo.length}`);
console.log(`  nuevos por nº labs  : ${Object.keys(porNumLabs).sort().map((k) => `${k}→${porNumLabs[k]}`).join('  ')}`);

const cobertura = {};
for (const l of LAB_IDS) cobertura[l] = catalogo.filter((e) => e[l] > 0).length;
console.log('  cobertura final     :');
for (const l of LAB_IDS) console.log(`     ${l.padEnd(13)}${String(cobertura[l]).padStart(5)}/${catalogo.length}`);

if (!APPLY) {
  console.log('\nMuestra de lo que se agregaría:');
  for (let i = 0; i < filasNuevas.length; i += Math.max(1, Math.floor(filasNuevas.length / 12))) {
    const f = filasNuevas[i];
    if (!f) continue;
    const precios = LAB_IDS.filter((l) => f[l]).map((l) => `${l} ${f[l]}`).join(' · ');
    console.log(`  ${f.name.slice(0, 46).padEnd(48)}${precios}`);
  }
  console.log('\n(nada escrito — corre con --apply para aplicarlo)');
} else {
  escribirRawData(catalogo);
  fs.writeFileSync(
    path.join(ROOT, 'data', 'catalogo-nuevos.json'),
    JSON.stringify({ generado: new Date().toISOString(), minLabs: MIN_LABS, estudios: nuevos.map((g) => ({
      nombre: g.nombre, labs: g.labs,
      variantes: Object.fromEntries(Object.entries(g.variantes).map(([l, v]) => [l, { nombre: v.nombre, precio: v.precio, url: v.url }])),
    })) }, null, 2)
  );
  console.log(`\nindex.html actualizado: ${catalogo.length} estudios.`);
  console.log('Trazabilidad de los nuevos en data/catalogo-nuevos.json');
}
