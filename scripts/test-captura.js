#!/usr/bin/env node
/**
 * Medcompara — Test del receptor de leads, búsquedas y clicks
 * ------------------------------------------------------------
 * El Apps Script vive en Google y no se puede correr aquí, pero es JavaScript:
 * se carga con un `SpreadsheetApp` de mentira y se le mandan los mismos POSTs
 * que mandan las páginas reales.
 *
 * Vale la pena tener este test porque el modo de fallar de este archivo es el
 * peor posible: la fila se escribe igual, solo que con la columna que
 * importaba en blanco. No hay error, no hay alerta, y el dato se pierde
 * durante semanas. Eso ya pasó una vez —el comparador GLP-1 mandaba `farmacia`
 * y el script leía `laboratorio`— y es lo que estos casos impiden que vuelva.
 *
 *   node scripts/test-captura.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

let fallos = 0;
const check = (ok, desc, extra = '') => {
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${desc}${!ok && extra ? '  → ' + extra : ''}`);
};

// ── Hoja de cálculo de mentira ──────────────────────────────────────────────
function hojaFalsa(pestanasIniciales = {}) {
  const pestanas = {};
  const crear = (nombre, filas = []) => {
    const s = {
      filas,
      appendRow: (f) => s.filas.push(f.slice()),
      getLastRow: () => s.filas.length,
      getLastColumn: () => (s.filas[0] ? s.filas[0].length : 0),
      getRange: (fila, col, nf, nc) => ({
        getValues: () => {
          const out = [];
          for (let i = 0; i < nf; i++) {
            const f = s.filas[fila - 1 + i] || [];
            out.push(Array.from({ length: nc }, (_, j) => f[col - 1 + j] !== undefined ? f[col - 1 + j] : ''));
          }
          return out;
        },
        setValues: (vals) => {
          vals.forEach((v, i) => {
            const idx = fila - 1 + i;
            s.filas[idx] = s.filas[idx] || [];
            v.forEach((x, j) => { s.filas[idx][col - 1 + j] = x; });
          });
          return { setFontWeight: () => {} };
        },
        setFontWeight: () => ({}),
      }),
      setFrozenRows: () => {},
    };
    return s;
  };
  for (const [n, filas] of Object.entries(pestanasIniciales)) pestanas[n] = crear(n, filas);
  return {
    pestanas,
    getSheetByName: (n) => pestanas[n] || null,
    insertSheet: (n) => (pestanas[n] = crear(n)),
  };
}

/** Carga el .gs con los globales que Apps Script le daría. */
function cargar(ss) {
  const src = fs.readFileSync(path.join(__dirname, 'medcompara-apps-script.gs'), 'utf8');
  const salida = [];
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (t) => ({ setMimeType: () => { salida.push(JSON.parse(t)); return t; } }),
    },
  };
  const fn = new Function('SpreadsheetApp', 'ContentService', src + '\nreturn { doPost: doPost, doGet: doGet };');
  const api = fn(ctx.SpreadsheetApp, ctx.ContentService);
  return { api, salida };
}

const post = (api, cuerpo) => api.doPost({ postData: { contents: JSON.stringify(cuerpo) } });

/** Lee una pestaña como objetos {columna: valor}. */
function comoObjetos(ss, nombre) {
  const s = ss.getSheetByName(nombre);
  if (!s) return [];
  const [cab, ...resto] = s.filas;
  return resto.map((f) => Object.fromEntries(cab.map((c, i) => [c, f[i]])));
}

// ── 1. Los tres comparadores mandan nombres distintos para lo mismo ─────────
console.log('Cada vertical usa sus propios nombres de campo:');
{
  const ss = hojaFalsa();
  const { api } = cargar(ss);

  // Lo que manda hoy pages/medicamentos.html (GLP-1)
  post(api, { tipo:'click', origen:'medcompara.com.mx', nombre:'Ana', correo:'a@x.com',
              farmacia:'Farmacias del Ahorro', medicamento:'Ozempic 1 mg', precio:3400 });
  // Lo que mandaría la vertical de laboratorio, con los nombres viejos
  post(api, { tipo:'click', origen:'medcompara.com.mx', vertical:'laboratorio',
              laboratorio:'Chopo', estudio:'Biometría hemática', precio:180 });
  // Lo que manda pages/medicinas.html
  post(api, { tipo:'click', origen:'medcompara.com.mx', vertical:'medicinas', nombre:'Beto',
              farmacia:'Prixz', medicamento:'Omeprazol 20mg · 14 cápsulas', precio:13, destino:'https://prixz.com/x' });

  const clicks = comoObjetos(ss, 'Clicks');
  check(clicks.length === 3, '3 clicks registrados', String(clicks.length));
  check(clicks.every((c) => c['Farmacia o laboratorio']), 'ninguna fila queda sin farmacia o laboratorio',
    JSON.stringify(clicks.map((c) => c['Farmacia o laboratorio'])));
  check(clicks.every((c) => c['Producto']), 'ninguna fila queda sin producto',
    JSON.stringify(clicks.map((c) => c['Producto'])));
  check(clicks[0]['Farmacia o laboratorio'] === 'Farmacias del Ahorro' && clicks[1]['Farmacia o laboratorio'] === 'Chopo',
    'farmacia y laboratorio caen en la misma columna');
  check(clicks.map((c) => c['Vertical']).join(',') === 'laboratorio,laboratorio,medicinas',
    'cada fila dice de qué vertical viene');
}

// ── 2. Una pestaña que ya existe con los encabezados viejos ────────────────
// Esta es la que de verdad importa: agregar columnas a una hoja con historial
// no puede correr los valores de lugar.
console.log('\nPestaña preexistente con los encabezados de la versión 1:');
{
  const ss = hojaFalsa({
    Clicks: [
      ['Fecha', 'Nombre', 'Correo', 'Laboratorio', 'Estudio', 'Precio', 'Origen'],
      ['2026-08-01', 'Vieja', 'v@x.com', 'Labbe', 'Glucosa', 120, 'medcompara.com.mx'],
    ],
  });
  const { api } = cargar(ss);
  post(api, { tipo:'click', vertical:'medicinas', nombre:'Beto', correo:'b@x.com',
              farmacia:'Prixz', medicamento:'Metformina 850mg', precio:393, origen:'medcompara.com.mx' });

  const filas = comoObjetos(ss, 'Clicks');
  const vieja = filas[0], nueva = filas[1];
  check(vieja['Laboratorio'] === 'Labbe' && vieja['Estudio'] === 'Glucosa',
    'la fila histórica queda intacta');
  check(nueva['Nombre'] === 'Beto' && nueva['Correo'] === 'b@x.com',
    'los valores no se corren de columna al agregar encabezados',
    JSON.stringify(nueva));
  check(nueva['Farmacia o laboratorio'] === 'Prixz', 'la columna nueva se llena');
  check(nueva['Laboratorio'] === 'Prixz',
    'la columna histórica se sigue llenando, para no cortar la serie a la mitad');
  check(ss.getSheetByName('Clicks').filas[0].includes('Vertical'), 'la columna Vertical se agregó');
}

// ── 3. Búsquedas, incluidas las que no encuentran nada ─────────────────────
console.log('\nBúsquedas:');
{
  const ss = hojaFalsa();
  const { api } = cargar(ss);
  post(api, { tipo:'busqueda', vertical:'medicinas', consulta:'tempra', resultados:3, origen:'medcompara.com.mx' });
  post(api, { tipo:'busqueda', vertical:'medicinas', consulta:'clonixinato', resultados:0, origen:'medcompara.com.mx' });
  const b = comoObjetos(ss, 'Busquedas');
  check(b.length === 2, 'se registran las dos búsquedas');
  // Un 0 es un dato, no un vacío: es exactamente la demanda que no cubrimos.
  check(b[1]['Resultados'] === 0 || b[1]['Resultados'] === '0',
    'una búsqueda con 0 resultados se guarda con su cero', JSON.stringify(b[1]));
}

// ── 4. Nada se tira ────────────────────────────────────────────────────────
console.log('\nNada se pierde:');
{
  const ss = hojaFalsa();
  const { api } = cargar(ss);
  post(api, { tipo:'evento_que_no_existe_todavia', vertical:'medicinas', algo:'x' });
  const sc = comoObjetos(ss, 'Sin clasificar');
  check(sc.length === 1 && String(sc[0]['JSON']).includes('algo'),
    'un tipo desconocido se guarda entero en vez de tirarse');

  const ss2 = hojaFalsa();
  const { api: api2 } = cargar(ss2);
  api2.doPost({ postData: { contents: '{esto no es json' } });
  const err = comoObjetos(ss2, 'Errores');
  check(err.length === 1, 'un cuerpo malformado deja rastro en la pestaña Errores');
  check(String(err[0]['Cuerpo']).includes('esto no es json'),
    'el cuerpo original queda guardado para poder recuperarlo');
}

// ── 5. Lo que manda cada página tiene destino en el receptor ───────────────
// El front-end y el receptor viven en repos distintos —uno aquí, otro en
// Google— y es fácil que uno cambie sin el otro.
console.log('\nEl front-end y el receptor hablan el mismo idioma:');
{
  const ROOT = path.join(__dirname, '..');
  const gs = fs.readFileSync(path.join(__dirname, 'medcompara-apps-script.gs'), 'utf8');
  const paginas = ['pages/medicamentos.html', 'pages/medicinas.html', 'pages/laboratorio.html'];
  const tipos = new Set();
  const campos = new Set();
  for (const p of paginas) {
    const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
    // Las páginas llaman a su envoltorio local (`sheetLog`) o al módulo
    // compartido (`traza`/`MC.log`): los tres se revisan igual.
    for (const m of html.matchAll(/(?:sheetLog|traza|MC\.log)\(\s*'([a-z]+)'\s*,\s*\{([^}]*)\}/g)) {
      tipos.add(m[1]);
      for (const c of m[2].matchAll(/(\w+)\s*:/g)) campos.add(c[1]);
    }
  }
  const tiposSinRuta = [...tipos].filter((t) => !gs.includes(`'${t}'`));
  check(tiposSinRuta.length === 0, `los ${tipos.size} tipos de evento tienen ruta en el receptor`,
    tiposSinRuta.join(', '));
  const camposSinLeer = [...campos].filter((c) => !gs.includes(`'${c}'`));
  check(camposSinLeer.length === 0, `los ${campos.size} campos que manda el front-end se leen`,
    camposSinLeer.join(', '));
}

console.log(fallos ? `\n✗ ${fallos} casos fallaron` : '\n✓ Todos los casos pasaron');
process.exit(fallos ? 1 : 0);
