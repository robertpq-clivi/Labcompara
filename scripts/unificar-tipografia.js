#!/usr/bin/env node
/**
 * Medcompara — Una sola tipografía para todo el sitio
 * -----------------------------------------------------
 * Con la paleta ya unificada, lo que seguía delatando que el landing y los
 * comparadores se hicieron por separado era la letra: el landing usa
 * **Montserrat** para todo y los tres comparadores **Sora** para títulos y
 * **DM Sans** para texto. El color es lo primero que se nota; la tipografía es
 * lo que hace que dos páginas se sientan del mismo sitio o de dos sitios
 * distintos.
 *
 *   node scripts/unificar-tipografia.js            # reporta, no escribe
 *   node scripts/unificar-tipografia.js --apply
 *
 * Se toma la del landing porque es la referencia que pidió el cliente. Como
 * Montserrat cubre de 400 a 800, las dos familias colapsan en una sola sin
 * perder la distinción entre título y texto: esa la marcan el peso y el
 * tamaño, no la familia.
 *
 * También se adopta la píldora del landing (999px) en los botones de acción.
 * Los radios de tarjetas y campos se dejan como están: cambiarlos rehace la
 * página, y lo que se pidió homologar es el fondo, la letra y el acento.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APLICAR = process.argv.includes('--apply');
const PAGINAS = [
  ...fs.readdirSync(path.join(ROOT, 'pages')).filter((f) => f.endsWith('.html')).map((f) => 'pages/' + f),
  ...fs.readdirSync(path.join(ROOT, 'blog')).filter((f) => f.endsWith('.html')).map((f) => 'blog/' + f),
];

/**
 * Se cambia solo la URL, no la etiqueta completa: dos de las tres páginas
 * cargan las fuentes de forma asíncrona (`media="print" onload=...` más un
 * `<noscript>` de respaldo) y reemplazar la etiqueta entera habría tirado esa
 * optimización sin que nadie lo notara hasta medir la carga.
 */
const FUENTE_VIEJA = /family=Sora:wght@[\d;]+&family=DM\+Sans:wght@[\d;]+/g;
const FUENTE_NUEVA = 'family=Montserrat:wght@400;500;600;700;800';

/** La pila completa del landing, para que el respaldo también coincida. */
const PILA = "'Montserrat',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";

const CAMBIOS = [
  // Las dos familias colapsan en Montserrat.
  [/'Sora',\s*sans-serif/g, PILA, 'títulos: Sora → Montserrat'],
  [/'DM Sans',\s*system-ui,\s*sans-serif/g, PILA, 'texto: DM Sans → Montserrat'],
  [/'DM Sans',\s*sans-serif/g, PILA, 'texto: DM Sans → Montserrat'],
  [/Sora,sans-serif/g, 'Montserrat,sans-serif', 'tipografía dentro de los SVG'],
  // La píldora del landing en los botones de acción.
  [/(\.btn-primary\{[^}]*?)border-radius:12px/g, '$1border-radius:999px', 'botón principal: píldora'],
  [/(\.btn-nav\{[^}]*?)border-radius:10px/g, '$1border-radius:999px', 'botón de la nav: píldora'],
];

let total = 0;
for (const rel of PAGINAS) {
  const archivo = path.join(ROOT, rel);
  let html = fs.readFileSync(archivo, 'utf8');
  const antes = html;
  const detalle = [];

  const nLinks = (html.match(FUENTE_VIEJA) || []).length;
  if (nLinks) {
    html = html.replace(FUENTE_VIEJA, FUENTE_NUEVA);
    detalle.push(`${nLinks}× URL de Google Fonts`);
  }
  for (const [re, a, papel] of CAMBIOS) {
    const n = (html.match(re) || []).length;
    if (n) { html = html.replace(re, a); detalle.push(`${n}× ${papel}`); }
  }

  const n = detalle.reduce((s, d) => s + Number(d.split('×')[0]), 0);
  total += n;
  if (n) console.log(`  ${rel.padEnd(52)} ${n}`);
  // Si queda una familia suelta, es que algo se escribió de otra forma.
  const sobrante = (html.match(/'(Sora|DM Sans)'|family=(Sora|DM\+Sans)/g) || []).length;
  if (sobrante) console.log(`   ⚠ quedan ${sobrante} menciones sueltas de la familia vieja`);
  if (APLICAR && html !== antes) fs.writeFileSync(archivo, html);
}

console.log(`\n${total} cambios en ${PAGINAS.length} páginas`);
if (!APLICAR) console.log('(sin --apply: nada escrito)');
