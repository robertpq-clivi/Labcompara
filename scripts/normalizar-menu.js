#!/usr/bin/env node
/**
 * Medcompara — Un solo menú para todo el sitio
 * ----------------------------------------------
 * Las tres verticales tienen que estar siempre a un clic desde cualquier
 * página. Al crecer el sitio a mano cada plantilla quedó con su propia versión
 * del menú: una decía "Medicamentos", otra "Medicamentos GLP-1", otra "GLP-1";
 * las páginas SEO enlazaban con rutas relativas a archivos .html que hoy
 * redirigen; y en pages/farmacias.html el enlace rotulado "Medicamentos"
 * apuntaba a la página de estudios de laboratorio.
 *
 *   node scripts/normalizar-menu.js           # reporta, no escribe
 *   node scripts/normalizar-menu.js --apply
 *
 * Reglas:
 *   · En una página que ES una vertical, se listan **las otras dos**.
 *   · En cualquier otra página, las tres.
 *   · Siempre con la ruta limpia y absoluta: /medicinas, no
 *     ../pages/medicinas.html, que además pasa por un 301.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APLICAR = process.argv.includes('--apply');

/**
 * Las tres verticales, con el rótulo que ve el usuario.
 *
 * "/medicinas" es el comparador de farmacia general y "/medicamentos" el de
 * GLP-1 —el que venía de glpcompara—. Los nombres se parecen demasiado como
 * para dejarlos a criterio de cada plantilla: de ahí el paréntesis.
 */
const VERTICALES = [
  { ruta: '/medicinas', texto: 'Medicinas', archivo: 'medicinas.html' },
  { ruta: '/laboratorio', texto: 'Laboratorios', archivo: 'laboratorio.html' },
  { ruta: '/glp1', texto: 'GLP-1 (Pérdida peso)', archivo: 'medicamentos.html' },
];

/** Contenedores de menú que existen en el sitio, con la clase de sus enlaces. */
const CONTENEDORES = [
  { clase: 'navlinks', claseEnlace: null },      // landing
  { clase: 'nav-right', claseEnlace: 'nav-link' }, // comparadores
  { clase: 'nav-links', claseEnlace: 'nav-link' }, // páginas SEO y blog
];

/** ¿Este enlace apunta a alguna de las tres verticales, escrito como sea? */
function esVertical(href) {
  const h = String(href).replace(/^\.\.\//, '/').replace(/^\/pages\//, '/').replace(/\.html$/, '');
  return VERTICALES.some((v) => h === v.ruta || h === v.ruta + '/');
}

function normalizar(archivo) {
  const html = fs.readFileSync(archivo, 'utf8');
  const rel = path.relative(ROOT, archivo);
  const base = path.basename(archivo);

  const cont = CONTENEDORES.find((c) => html.includes(`class="${c.clase}"`));
  if (!cont) return null;

  const abre = html.indexOf(`class="${cont.clase}"`);
  const inicio = html.indexOf('>', abre) + 1;
  const cierra = html.indexOf('</div>', inicio);
  if (inicio <= 0 || cierra < 0) return null;

  const dentro = html.slice(inicio, cierra);
  const sangria = (dentro.match(/\n(\s+)</) || [null, '    '])[1];

  // Se conservan los enlaces que no son de vertical (Inicio, Blog, el botón):
  // esto solo unifica las tres, no rehace el menú de nadie.
  const anclas = dentro.match(/<a\b[^>]*>[\s\S]*?<\/a>|<button\b[^>]*>[\s\S]*?<\/button>/g) || [];
  const texto = (a) => a.replace(/<[^>]*>/g, '').trim().toLowerCase();
  const esBoton = (a) => /class="[^"]*\b(nav-btn|btn-nav|btn-light)\b/.test(a) || a.startsWith('<button');

  // Un enlace rotulado con el nombre de una vertical pero que apunta a otro
  // lado no es un enlace que valga la pena conservar, es un error: en
  // pages/farmacias.html "Medicamentos" llevaba a estudios de laboratorio.
  const ALIAS = new Set(['medicamentos', 'medicamentos glp-1', 'glp-1', 'glp1',
    'glp-1 (pérdida peso)', 'medicinas', 'laboratorios', 'laboratorio']);

  const conservados = anclas.filter((a) => {
    const href = (a.match(/href="([^"]*)"/) || [])[1];
    if (href && esVertical(href)) return false;
    return !ALIAS.has(texto(a));
  });

  // En la página de una vertical se listan las otras dos.
  const propia = VERTICALES.find((v) => base === v.archivo);
  const nuevos = VERTICALES.filter((v) => v !== propia).map((v) =>
    `<a href="${v.ruta}"${cont.claseEnlace ? ` class="${cont.claseEnlace}"` : ''}>${v.texto}</a>`);

  // Orden: Inicio · las verticales · lo demás · el botón al final. El botón
  // enlaza a la raíz igual que "Inicio", así que hay que distinguirlos por su
  // clase o termina abriendo el menú en vez de cerrarlo.
  const resto = [...conservados];
  const sacar = (pred) => {
    const i = resto.findIndex(pred);
    return i >= 0 ? resto.splice(i, 1) : [];
  };
  const botones = conservados.filter(esBoton);
  botones.forEach((b) => sacar((a) => a === b));
  const cabeza = sacar((a) => texto(a) === 'inicio');

  const orden = [...cabeza, ...nuevos, ...resto, ...botones];

  const dentroNuevo = '\n' + orden.map((a) => sangria + a).join('\n') + '\n' + sangria.slice(0, -2);
  const salida = html.slice(0, inicio) + dentroNuevo + html.slice(cierra);

  const antes = anclas.filter((a) => esVertical((a.match(/href="([^"]*)"/) || [])[1] || '')).length;
  return { rel, salida, cambio: salida !== html, antes, ahora: nuevos.length };
}

const archivos = [
  path.join(ROOT, 'index.html'),
  ...fs.readdirSync(path.join(ROOT, 'pages')).filter((f) => f.endsWith('.html')).map((f) => path.join(ROOT, 'pages', f)),
  ...fs.readdirSync(path.join(ROOT, 'blog')).filter((f) => f.endsWith('.html')).map((f) => path.join(ROOT, 'blog', f)),
];

let tocados = 0;
let sinMenu = 0;
for (const a of archivos) {
  const r = normalizar(a);
  if (!r) { sinMenu++; continue; }
  if (!r.cambio) continue;
  tocados++;
  console.log(`  ${r.rel.padEnd(52)} ${r.antes} → ${r.ahora} enlaces de vertical`);
  if (APLICAR) fs.writeFileSync(a, r.salida);
}

console.log(`\n${tocados} páginas con el menú unificado · ${sinMenu} sin menú (no se tocan)`);
if (!APLICAR) console.log('(sin --apply: nada escrito)');
