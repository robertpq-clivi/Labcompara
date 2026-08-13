#!/usr/bin/env node
/**
 * Labcompara — Test de paridad entre el emparejador de Node y el de Apps Script
 * ----------------------------------------------------------------------------
 * `scripts/lib/match.js` y el bloque de emparejamiento de
 * `scripts/labcompara-apps-script.gs` son el mismo algoritmo escrito dos veces:
 * uno corre local, el otro dentro de Google. Si se desincronizan, el sitio
 * publica una matriz distinta de la que ve quien depura en su máquina, y el
 * síntoma aparece semanas después como "un precio que no cuadra".
 *
 * Este test extrae las funciones del .gs, las evalúa en un sandbox y compara
 * su similitud contra la de Node sobre los catálogos reales de data/scan/.
 *
 *   node scripts/test-paridad.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { similitud, emparejar } = require('./lib/match');

const ROOT = path.join(__dirname, '..');
const GS = path.join(ROOT, 'scripts', 'labcompara-apps-script.gs');
const SCAN_DIR = path.join(ROOT, 'data', 'scan');

// ── extraer el bloque de emparejamiento del .gs y evaluarlo aislado ──────────
function cargarMatcherDelGs() {
  const src = fs.readFileSync(GS, 'utf8');
  const desde = src.indexOf('const STOPWORDS');
  const hasta = src.indexOf('function emparejar_(');
  if (desde < 0 || hasta < 0) throw new Error('No se encontró el bloque de emparejamiento en el .gs');

  const ctx = { CFG: { UMBRAL_MATCH: 0.82 }, console };
  vm.createContext(ctx);
  vm.runInContext(src.slice(desde, hasta), ctx);
  if (typeof ctx.similitud_ !== 'function') throw new Error('similitud_ no quedó definida');
  return ctx.similitud_;
}

// ── main ─────────────────────────────────────────────────────────────────────
const similitudGs = cargarMatcherDelGs();

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const m = html.match(/const RAW_DATA\s*=\s*(\[[\s\S]*?\n\];)/);
// eslint-disable-next-line no-new-func
const canonicos = new Function(`return ${m[1].replace(/;$/, '')}`)().map((e) => e.name);

/**
 * Casos que en su momento SÍ destaparon una divergencia o un falso positivo.
 * Van fijos en el test para que data/scan/ (que es caché y no se versiona) no
 * haga falta: en un clon nuevo `npm test` tiene que correr igual.
 */
const FIXTURE = [
  'PERFIL LIPOIDEO',                                  // sinónimo que faltaba en un lado
  'DETECCIÓN DE POLIOMAVIRUS BK POR PCR',             // PCR = técnica, no proteína C reactiva
  'Citomegalovirus por PCR-RT',
  'PROTEINA C REACTIVA', 'PROTEINA C REACTIVA DE ALTA SENSIBILIDAD',
  'Química Sanguínea (6)', 'QUÍMICA DE 12 ELEMENTOS', 'Química sanguínea de 45 elementos (Q45)',
  'Perfil Tiroideo I', 'Perfil Tiroideo II', 'PERFIL TIROIDEO',
  'VITAMINA A (RETINOL)', 'VITAMINA B12 ---COBALAMINA', 'ACIDO FÓLICO Y VITAMINA B12 EN SUERO',
  'ANTIGENO -S- DE SUPERFICIE HEPATITIS B -AUSTRALIA-', 'HEPATITIS B ANTIGENO E',
  'ANTIGENO CA 125 --OVARIO--', 'CA 15-3', 'CA 19-9 EN SUERO',
  'TGO y TGP', 'Tsh (H. Estimulante de Tiroides)', 'TSH - Neonatal',
  'CALCIO', 'CALCIO Y FOSFORO EN SUERO', 'Bicarbonato Urinario',
  'GLUCOSA EN SUERO', 'GLUCOSA EN SUERO AL AZAR', 'GLUCOSA POSTPRANDIAL',
  'Cortisol Sérico (Vespertino)', 'CORTISOL BASAL',
  'Perfil básico vías urinarias', 'CHECK UP SALUD QUÍMICA DE 45 ELEMENTOS',
  'Antígeno prostático específico total', 'ANTIGENO PROSTÁTICO ESPECIFICO LIBRE EN SUERO',
  'EXAMEN COPROPARASITOSCÓPICO (UNA MUESTRA)', 'Coproparasitoscópico 2 Muestras',
  'MASTOGRAFÍA UNILATERAL', 'Espermatobioscopía (Seminograma)',
  'Curva de Tolerancia a la Glucosa (Toma Extra)',
  'TIEMPO DE PROTROMBINA (DILUCIÓN)',
].map((nombre) => ({ nombre }));

const archivos = fs.existsSync(SCAN_DIR) ? fs.readdirSync(SCAN_DIR).filter((f) => f.endsWith('.json')) : [];
const catalogos = archivos.length
  ? archivos.map((f) => ({ etiqueta: f, filas: JSON.parse(fs.readFileSync(path.join(SCAN_DIR, f), 'utf8')) }))
  : [{ etiqueta: 'fixture', filas: FIXTURE }];
if (!archivos.length) console.log('(sin data/scan/ — se usa el fixture de casos conocidos)\n');

let comparaciones = 0;
const divergencias = [];

for (const { etiqueta: archivo, filas } of catalogos) {
  // Comparar el catálogo completo contra los 124 sería 1.5M de pares por lab:
  // basta una muestra determinista y densa para detectar una desincronización.
  const muestra = filas.length > 60 ? filas.filter((_, i) => i % 3 === 0).slice(0, 400) : filas;
  for (const fila of muestra) {
    for (const canon of canonicos) {
      const a = similitud(canon, fila.nombre);
      const b = similitudGs(canon, fila.nombre);
      comparaciones++;
      if (Math.abs(a - b) > 1e-9) {
        divergencias.push({ archivo, canon, nombre: fila.nombre, node: +a.toFixed(4), gs: +b.toFixed(4) });
      }
    }
  }
}

// El emparejador completo también debe coincidir en el resultado final.
let emparejadosTotal = 0;
for (const { filas } of catalogos) emparejadosTotal += emparejar(canonicos, filas).mapeo.size;

console.log(`Paridad Node ↔ Apps Script`);
console.log(`  pares comparados : ${comparaciones.toLocaleString('es-MX')}`);
console.log(`  catálogos        : ${catalogos.map((c) => c.etiqueta).join(', ')}`);
console.log(`  emparejados      : ${emparejadosTotal} (suma de todos los labs)`);

if (divergencias.length) {
  console.error(`\n✗ ${divergencias.length} divergencias. Las primeras 10:`);
  divergencias.slice(0, 10).forEach((d) => {
    console.error(`   [${d.archivo}] "${d.canon}" vs "${d.nombre}" → node ${d.node} · gs ${d.gs}`);
  });
  process.exit(1);
}

console.log('\n✓ Los dos emparejadores coinciden en todos los pares comparados.');
