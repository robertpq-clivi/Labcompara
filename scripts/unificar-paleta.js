#!/usr/bin/env node
/**
 * Medcompara — Una sola paleta para todo el sitio
 * -------------------------------------------------
 * El landing se diseñó aparte y los tres comparadores heredaron la paleta de
 * GLPcompara, así que al pasar de una página a otra cambian el fondo y el
 * texto: el azul del landing es #06142A y el de los comparadores #0B1F4B, el
 * acento es #00547c contra #00B4D8. Se nota sobre todo al navegar entre
 * secciones, que es justo lo que el menú unificado ahora invita a hacer.
 *
 *   node scripts/unificar-paleta.js            # reporta, no escribe
 *   node scripts/unificar-paleta.js --apply
 *
 * El mapeo va por ROL y no por nombre. `--teal` significa cosas distintas en
 * cada archivo: en el landing es el color primario (un teal profundo, para
 * texto sobre fondo claro) y en los comparadores era el cian brillante de los
 * botones. Traducir nombre por nombre habría dejado botones ilegibles.
 *
 * También se traducen los colores escritos a mano, incluidos los `rgba()`:
 * son la mitad de las apariciones —sombras, bordes, fondos translúcidos— y
 * dejarlos habría producido un azul distinto en cada sombra.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APLICAR = process.argv.includes('--apply');
const PAGINAS = ['pages/laboratorio.html', 'pages/medicamentos.html', 'pages/medicinas.html'];

/**
 * De la paleta de GLPcompara a la del landing, por el papel que cumple cada
 * color. Los comentarios son los del propio landing.
 */
const MAPEO = [
  // ── fondos y texto: lo que más se nota al cambiar de página ──────────────
  ['#0B1F4B', '#06142A', 'fondo oscuro'],
  ['#1a3a6e', '#183f5e', 'degradado sobre el fondo oscuro (mesh-2 del landing)'],
  ['#F8FAFC', '#F8F7F4', 'fondo claro (offwhite)'],
  ['#1E293B', '#242424', 'texto sobre fondo claro'],
  ['#475569', '#4B5563', 'texto secundario (ink-600)'],
  ['#E2E8F0', '#E5E7EB', 'líneas y bordes (line)'],
  ['#F1F5F9', '#EFEEEA', 'gris sutil, derivado del offwhite'],
  // ── acentos ──────────────────────────────────────────────────────────────
  ['#00B4D8', '#00547c', 'color primario'],
  ['#0077A8', '#003A56', 'primario oscuro, para degradados y hover'],
  ['#90E0EF', '#79C5E2', 'acento claro sobre fondos oscuros (sky)'],
];

/** Los mismos colores escritos como rgba(), que es donde viven las sombras. */
const RGBA = [
  ['11,31,75', '6,20,42', 'sombras y translúcidos del fondo oscuro'],
  ['0,180,216', '0,84,124', 'translúcidos del color primario'],
  ['144,224,239', '121,197,226', 'translúcidos del acento claro'],
  ['26,58,110', '24,63,94', 'translúcidos del degradado'],
];

let total = 0;
for (const rel of PAGINAS) {
  const archivo = path.join(ROOT, rel);
  let html = fs.readFileSync(archivo, 'utf8');
  const antes = html;
  const cuenta = [];

  for (const [de, a, papel] of MAPEO) {
    const re = new RegExp(de.replace('#', '#'), 'gi');
    const n = (html.match(re) || []).length;
    if (n) { html = html.replace(re, a); cuenta.push(`${n}× ${de}→${a} (${papel})`); }
  }
  for (const [de, a, papel] of RGBA) {
    const re = new RegExp('rgba\\(' + de.replace(/,/g, '\\s*,\\s*'), 'g');
    const n = (html.match(re) || []).length;
    if (n) { html = html.replace(re, 'rgba(' + a); cuenta.push(`${n}× rgba(${de})→rgba(${a}) (${papel})`); }
  }

  const cambios = cuenta.reduce((s, c) => s + Number(c.split('×')[0]), 0);
  total += cambios;
  console.log(`\n${rel} — ${cambios} colores`);
  for (const c of cuenta) console.log('   ' + c);
  if (APLICAR && html !== antes) fs.writeFileSync(archivo, html);
}

console.log(`\n${total} colores traducidos en ${PAGINAS.length} páginas`);
if (!APLICAR) console.log('(sin --apply: nada escrito)');
