#!/usr/bin/env node
/**
 * Medcompara — El mismo fondo de hero que el landing
 * ----------------------------------------------------
 * El landing pinta su hero con tres capas de CSS —una malla de degradados
 * radiales, un resplandor y un desvanecido hacia el navy— y los comparadores
 * lo pintaban con un canvas de manchas desenfocadas animadas. Con la paleta y
 * la tipografía ya iguales, el fondo del hero era lo que seguía delatando que
 * son páginas distintas: es lo primero que se ve al entrar.
 *
 *   node scripts/unificar-hero.js            # reporta, no escribe
 *   node scripts/unificar-hero.js --apply
 *
 * Se adopta el del landing, que además sale más barato: tres divs con
 * degradados contra un requestAnimationFrame que no para nunca y obliga al
 * navegador a recomponer una capa desenfocada de pantalla completa en cada
 * cuadro.
 *
 * Se mata el canvas y su script. El orbit se conserva girando porque el
 * landing también lo gira: quitarle esa animación lo alejaría del landing en
 * vez de acercarlo, que es lo contrario de lo que se pide.
 *
 * Y se copia la escala tipográfica, que es la otra mitad de por qué dos
 * páginas con los mismos colores y la misma letra se siguen sintiendo
 * distintas: el h1 del landing llega a 80px y el de los comparadores se
 * quedaba en 46.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APLICAR = process.argv.includes('--apply');
const PAGINAS = ['pages/laboratorio.html', 'pages/medicamentos.html', 'pages/medicinas.html'];

/** Las tres capas del landing, tal cual, con su misma geometría. */
const CSS = `
/* ── FONDO DEL HERO ──────────────────────────────────────────────────────── */
/* Las mismas tres capas del landing: la malla da el color, el resplandor abre
   el centro y el desvanecido cierra contra el navy para que la sección
   siguiente empalme sin costura. */
#sec-hero .mesh{position:absolute;inset:0;background:radial-gradient(125% 115% at 6% 96%,var(--mesh-1) 0%,var(--mesh-2) 22%,var(--teal) 54%,var(--indigo) 78%,var(--periwinkle) 100%);opacity:.6;pointer-events:none;}
#sec-hero .glow{position:absolute;inset:0;background:radial-gradient(90% 65% at 52% -12%,rgba(202,209,251,.18),rgba(202,209,251,0) 62%);pointer-events:none;}
#sec-hero .fade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(6,20,42,0) 62%,var(--navy) 100%);pointer-events:none;}
`;

/** Los tokens de la malla, que los comparadores no tenían. */
const TOKENS = '  --mesh-1:#142534;--mesh-2:#183f5e;--indigo:#414392;--periwinkle:#cad1fb;\n';

const CAPAS = '  <div class="mesh" aria-hidden="true"></div><div class="glow" aria-hidden="true"></div><div class="fade" aria-hidden="true"></div>';

/**
 * La escala del landing, mapeada por el papel de cada texto.
 * A la izquierda lo que usaban los comparadores; a la derecha el landing.
 */
const ESCALA = [
  // h1 del hero
  ['clamp(28px,4.3vw,46px)', 'clamp(38px,6.4vw,80px)', 'h1 del hero'],
  ['clamp(30px,5.5vw,56px)', 'clamp(38px,6.4vw,80px)', 'h1 del hero'],
  // subtítulo bajo el h1
  ['clamp(16px,2.5vw,19px)', 'clamp(17px,1.9vw,22px)', 'entrada del hero'],
  ['clamp(17px,2vw,20px)', 'clamp(17px,1.9vw,22px)', 'entrada del hero'],
  // títulos de sección
  ['clamp(24px,4vw,36px)', 'clamp(30px,4.2vw,52px)', 'título de sección'],
  ['clamp(22px,4vw,34px)', 'clamp(30px,4.2vw,52px)', 'título de sección'],
  ['clamp(24px,3.4vw,34px)', 'clamp(30px,4.2vw,52px)', 'título de sección'],
];

let tocados = 0;
for (const rel of PAGINAS) {
  const archivo = path.join(ROOT, rel);
  let html = fs.readFileSync(archivo, 'utf8');
  const antes = html;
  const hechos = [];

  // 1. Tokens de la malla, junto a los demás.
  if (!html.includes('--mesh-1')) {
    html = html.replace(/(:root\{\n)/, `$1${TOKENS}`);
    hechos.push('tokens de la malla');
  }

  // 2. Las tres capas donde estaba el canvas.
  if (html.includes('<canvas id="hero-canvas"')) {
    html = html.replace(/[ \t]*<canvas id="hero-canvas"[^>]*><\/canvas>\n?/, CAPAS + '\n');
    hechos.push('canvas → tres capas');
  }

  // 3. El overlay del canvas sobra: la capa `fade` hace ese trabajo, y
  //    dejarlos a los dos apagaba la malla.
  if (html.includes('class="hero-overlay"')) {
    html = html.replace(/[ \t]*<div class="hero-overlay"[^>]*><\/div>\n?/, '');
    html = html.replace(/^\.hero-overlay\{[^}]*\}\n?/m, '');
    hechos.push('overlay retirado');
  }

  // 4. El CSS del canvas y su animación.
  if (/^#hero-canvas\{/m.test(html)) {
    html = html.replace(/^#hero-canvas\{[^}]*\}\n?/m, '');
    hechos.push('css del canvas');
  }
  const beams = html.match(/\/\/ ── BEAMS DEL HERO[\s\S]*?\n\}\)\(\);\n/);
  if (beams) {
    html = html.replace(beams[0], '');
    hechos.push('script de los beams');
  }

  // 5. Las capas nuevas.
  if (!html.includes('#sec-hero .mesh')) {
    html = html.replace(/\n\/\* ── SECCIONES/, CSS + '\n/* ── SECCIONES');
    if (!html.includes('#sec-hero .mesh')) html = html.replace('</style>', CSS + '</style>');
    hechos.push('css de las capas');
  }

  // 6. La escala del landing.
  for (const [de, a, papel] of ESCALA) {
    if (html.includes(de)) {
      const n = html.split(de).length - 1;
      html = html.split(de).join(a);
      hechos.push(`${n}× ${papel}`);
    }
  }
  // El logo del landing es bastante mayor que el de los comparadores.
  if (/\.nav-logo\{font-weight:700;font-size:20px/.test(html)) {
    html = html.replace(/(\.nav-logo\{font-weight:700;)font-size:20px/, '$1font-size:clamp(22px,2.2vw,28px)');
    hechos.push('logo');
  }

  if (hechos.length) tocados++;
  console.log(`  ${rel.padEnd(28)} ${hechos.join(' · ') || 'sin cambios'}`);
  if (APLICAR && html !== antes) fs.writeFileSync(archivo, html);
}

console.log(`\n${tocados} páginas con el fondo del landing`);
if (!APLICAR) console.log('(sin --apply: nada escrito)');
