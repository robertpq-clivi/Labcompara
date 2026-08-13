#!/usr/bin/env node
/**
 * Labcompara → Medcompara — Migración de dominio
 * -----------------------------------------------
 * Reescribe el dominio en todo el sitio: canónicas, og:url, JSON-LD, sitemaps,
 * robots.txt y enlaces absolutos. Se hizo script y no búsqueda-y-reemplazo a
 * mano porque son ~180 archivos y porque el mismo movimiento se repitió ya dos
 * veces (glpcompara → labcompara → medcompara); la tercera conviene que sea
 * reproducible y verificable.
 *
 *   node scripts/migrar-dominio.js                  # reporta, no escribe
 *   node scripts/migrar-dominio.js --apply
 *   node scripts/migrar-dominio.js --de=X --a=Y     # otro par de dominios
 *
 * NO toca:
 *   · utm_source=glpcompara  — es la etiqueta con la que Revert atribuye el
 *     tráfico; cambiarla rompería el reporte del socio.
 *   · data/  — precios y catálogos crudos, sin dominios propios dentro.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const DE = arg('de', 'labcompara.com');
const A = arg('a', 'medcompara.com.mx');
const APPLY = argv.includes('--apply');

/** Marcas de texto: "Labcompara" → "Medcompara", incluida la partida en etiquetas. */
const nombrePropio = (d) => d.split('.')[0].replace(/^./, (c) => c.toUpperCase());
const MARCA_DE = nombrePropio(DE);      // Labcompara
const MARCA_A = nombrePropio(A);        // Medcompara
const PREFIJO_DE = MARCA_DE.slice(0, 3); // Lab
const PREFIJO_A = MARCA_A.slice(0, 3);   // Med
const RESTO = MARCA_DE.slice(3);         // compara

// El utm del socio se protege con un centinela mientras se reescribe el resto.
const CENTINELA = '__UTM_SOCIO__';
const UTM_PROTEGIDO = /utm_source=glpcompara/g;

function reescribir(texto) {
  let t = texto.replace(UTM_PROTEGIDO, CENTINELA);
  t = t.split(`https://${DE}`).join(`https://${A}`);
  t = t.split(DE).join(A);
  t = t.split(MARCA_DE).join(MARCA_A);
  // marca partida entre etiquetas: Lab<span>compara</span>
  t = t.split(`${PREFIJO_DE}<span>${RESTO}`).join(`${PREFIJO_A}<span>${RESTO}`);
  // Y en minúsculas: nombre del paquete, del bot de commits y del archivo
  // labcompara-apps-script.gs, que además se renombra más abajo. Sin esto
  // quedan enlaces rotos hacia un archivo que ya no existe.
  t = t.split(MARCA_DE.toLowerCase()).join(MARCA_A.toLowerCase());
  return t.split(CENTINELA).join('utm_source=glpcompara');
}

/** Archivos de texto del sitio; se excluyen datos y dependencias. */
function archivos() {
  const out = [];
  const salta = new Set(['node_modules', '.git', 'data', '.vercel']);
  const ext = new Set(['.html', '.xml', '.txt', '.json', '.js', '.md', '.yml', '.gs']);
  // El propio script se excluye: reescribirlo convertiría su documentación en
  // "Medcompara → Medcompara" y borraría el rastro de qué migró.
  const propio = path.join(ROOT, 'scripts', 'migrar-dominio.js');
  const caminar = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (salta.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) caminar(p);
      else if (ext.has(path.extname(e.name)) && p !== propio) out.push(p);
    }
  };
  caminar(ROOT);
  return out;
}

const tocados = [];
let ocurrencias = 0;

for (const f of archivos()) {
  const antes = fs.readFileSync(f, 'utf8');
  // El filtro debe mirar las tres formas, o descarta el archivo antes de
  // llegar al reemplazo: así se quedaron atrás package.json ("labcompara") y
  // las referencias al .gs renombrado.
  if (!antes.includes(DE) && !antes.includes(MARCA_DE) && !antes.includes(MARCA_DE.toLowerCase())) continue;
  const despues = reescribir(antes);
  if (despues === antes) continue;
  const n = (antes.match(new RegExp(MARCA_DE, 'gi')) || []).length;
  ocurrencias += n;
  tocados.push({ f: path.relative(ROOT, f), n });
  if (APPLY) fs.writeFileSync(f, despues);
}

console.log(`Migración de dominio: ${DE} → ${A}`);
console.log(`  archivos afectados : ${tocados.length}`);
console.log(`  ocurrencias        : ${ocurrencias}`);
const porDir = {};
for (const t of tocados) {
  const d = t.f.includes('/') ? t.f.split('/')[0] : '(raíz)';
  porDir[d] = (porDir[d] || 0) + 1;
}
for (const [d, n] of Object.entries(porDir).sort((a, b) => b[1] - a[1])) {
  console.log(`     ${d.padEnd(14)}${n}`);
}

// El Apps Script lleva el nombre viejo en el propio archivo.
const gsViejo = path.join(ROOT, 'scripts', `${DE.split('.')[0]}-apps-script.gs`);
const gsNuevo = path.join(ROOT, 'scripts', `${A.split('.')[0]}-apps-script.gs`);
const hayRename = fs.existsSync(gsViejo);
if (hayRename) console.log(`  renombrar         : ${path.basename(gsViejo)} → ${path.basename(gsNuevo)}`);

if (!APPLY) {
  console.log('\n(nada escrito — corre con --apply)');
} else {
  if (hayRename) fs.renameSync(gsViejo, gsNuevo);
  console.log('\nListo. Falta:');
  console.log('  1. npm run generate:sitemaps');
  console.log('  2. revisar que no quede el dominio viejo:  grep -rl "' + DE + '" --exclude-dir={.git,node_modules,data} .');
  console.log('  3. desplegar y luego activar el 301 desde ' + DE);
}
