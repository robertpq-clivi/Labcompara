#!/usr/bin/env node
/**
 * Medcompara — Scanner de precios de medicamentos GLP-1
 * ------------------------------------------------------
 * Equivalente de scan-labs.js para la vertical de farmacias. Comparte con él
 * el transporte (lib/http.js con escalada a Zyte), el parseo de precios y el
 * historial; cambia el emparejamiento, que aquí va por tokens declarados en
 * verticales/farmacias-catalogo.json.
 *
 *   node scripts/scan-farmacias.js
 *   node scripts/scan-farmacias.js --fuentes=Benavides,Ahorro
 *   node scripts/scan-farmacias.js --familias=Foundayz
 *   node scripts/scan-farmacias.js --dry     # no escribe nada
 *
 * --fuentes y --familias acotan la corrida. Lo que no se vuelve a mirar se
 * conserva del prices.json anterior en vez de quedar en null: acotar sirve
 * para rellenar un hueco puntual sin tirar el resto de la matriz ni gastar
 * una pasada completa por las cinco farmacias.
 *
 * Escribe:
 *   data/medicamentos/prices.json         matriz consumida por el sitio
 *   data/medicamentos/crudo.json          todo lo encontrado, para afinar tokens
 *   data/medicamentos/price-history.json  serie temporal
 *   data/medicamentos/reporte.md          cobertura y cambios
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { crearCliente } = require('./lib/http');
const { actualizarHistorial } = require('./lib/history');
const V = require('./verticales/farmacias');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'medicamentos');

const PAUSA_MS = 2000;   // mismo respiro que usaba el scraper de GLPcompara

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const SOLO = (arg('fuentes', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const SOLO_FAM = (arg('familias', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const DRY = argv.includes('--dry');
// --volcar guarda la respuesta cruda de cada fuente en data/medicamentos/debug/.
// Sirve para arreglar un parser con el HTML real en vez de a ciegas: los sitios
// que van por proxy no se pueden inspeccionar desde una máquina local.
const VOLCAR = argv.includes('--volcar');

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const http = crearCliente({ log: (m) => process.stdout.write(`  ⇢ ${m}\n`) });

const ctxPara = (ad) => {
  const base = ad.proxy ? { proxy: true } : {};
  return {
    get: (u, o) => http.get(u, { ...base, ...o }),
    getJSON: (u, o) => http.getJSON(u, { ...base, ...o }),
    postJSON: (u, b, o) => http.postJSON(u, b, { ...base, ...o }),
  };
};

(async () => {
  const { catalogo, adaptadores, columnas, curados, urlFarmacia } = V;
  const todasFamilias = Object.keys(catalogo.families);

  // Un nombre mal escrito en --familias/--fuentes raspaba cero y, sin este
  // aviso, el merge de abajo dejaba la matriz intacta: la corrida se veía
  // exitosa sin haber mirado nada.
  const desconocidas = SOLO_FAM.filter((f) => !todasFamilias.includes(f));
  if (desconocidas.length) {
    console.error(`familia desconocida: ${desconocidas.join(', ')}`);
    console.error(`familias del catálogo: ${todasFamilias.join(', ')}`);
    process.exit(1);
  }
  const idsFuentes = adaptadores.map((a) => a.id);
  const fuentesRaras = SOLO.filter((f) => !idsFuentes.includes(f));
  if (fuentesRaras.length) {
    console.error(`fuente desconocida: ${fuentesRaras.join(', ')}`);
    console.error(`fuentes raspables: ${idsFuentes.join(', ')}`);
    process.exit(1);
  }

  const familias = todasFamilias.filter((f) => !SOLO_FAM.length || SOLO_FAM.includes(f));

  console.log('Medcompara · scan de medicamentos GLP-1');
  console.log(`${catalogo.products.length} presentaciones · ${familias.length} familias · ${columnas.length} fuentes`);
  if (SOLO_FAM.length) console.log(`familias acotadas a: ${familias.join(', ')}`);
  if (SOLO.length) console.log(`fuentes acotadas a: ${SOLO.join(', ')}`);
  if (!DRY) {
    const chk = await http.verificarProxy();
    console.log(chk.ok
      ? `proxy anti-bloqueo: ${http.proveedor} ✓ credencial válida\n`
      : `proxy anti-bloqueo: ${http.proveedor} ✗ NO FUNCIONA (${chk.motivo})\n`);
  }

  // ── raspar cada fuente, una vez por familia ────────────────────────────────
  const crudo = {};
  const meta = {};
  // Un 403 puntual no debe vaciar una columna: los pares que fallaron se
  // tratan como no raspados y conservan el precio de la corrida anterior.
  const fallos = new Set();
  const objetivo = adaptadores.filter((a) => !SOLO.length || SOLO.includes(a.id));

  for (const ad of objetivo) {
    crudo[ad.id] = {};
    const ctx = ctxPara(ad);
    let total = 0, errores = 0;
    for (const fam of familias) {
      try {
        const volcar = VOLCAR ? (nombre, cuerpo) => {
          const dir = path.join(OUT, 'debug');
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, `${nombre}.txt`), cuerpo);
        } : null;
        const items = await ad.buscar(ctx, catalogo.families[fam].query, { volcar });
        crudo[ad.id][fam] = items;
        total += items.length;
        console.log(`  ${ad.id}/${fam}: ${items.length} productos`);
      } catch (e) {
        crudo[ad.id][fam] = [];
        fallos.add(`${ad.id}|${fam}`);
        errores++;
        console.log(`  ${ad.id}/${fam}: ✗ ${String(e.message || e).slice(0, 70)}`);
      }
      await dormir(PAUSA_MS);
    }
    meta[ad.id] = { total, errores, proxy: !!ad.proxy };
  }

  // ── emparejar contra el catálogo ───────────────────────────────────────────
  const generado = new Date().toISOString();
  const precios = {};
  let emparejados = 0;

  // Corrida acotada: las celdas que --fuentes/--familias dejaron fuera no se
  // volvieron a mirar, así que se arrastran del archivo anterior. Sin esto,
  // `--familias=Foundayz` publicaría las otras 16 presentaciones en null.
  const leerPrevio = (archivo, campo) => {
    try { return JSON.parse(fs.readFileSync(path.join(OUT, archivo), 'utf8'))[campo] || {}; }
    catch { return {}; }
  };
  const precioPrevio = leerPrevio('prices.json', 'prices');
  const crudoPrevio = leerPrevio('crudo.json', 'crudo');
  const raspada = (columna, familia) =>
    familias.includes(familia) &&
    objetivo.some((a) => a.id === columna) &&
    !fallos.has(`${columna}|${familia}`);
  const acotada = familias.length < todasFamilias.length ||
    objetivo.length < adaptadores.length || fallos.size > 0;
  let heredadas = 0;

  for (const prod of catalogo.products) {
    const fila = { sources: {} };
    for (const c of columnas) fila[c] = null;

    const antes = precioPrevio[prod.name];
    if (antes) {
      for (const c of columnas) {
        if (raspada(c, prod.family) || antes[c] == null) continue;
        fila[c] = antes[c];
        const fuente = (antes.sources || {})[c];
        if (fuente) fila.sources[c] = fuente;
        heredadas++;
      }
    }

    for (const ad of objetivo) {
      const hit = V.elegir(crudo[ad.id][prod.family] || [], prod, ad.id, catalogo.families[prod.family]);
      if (!hit) continue;
      fila[ad.id] = hit.precio;
      // `detalle` se guarda aparte cuando existe: San Pablo llama igual a sus
      // cuatro SKU de Foundayz y sin ese campo las cuatro filas del feed se
      // verían idénticas para quien venga a afinar tokens.
      fila.sources[ad.id] = { price: hit.precio, url: hit.url, title: hit.titulo,
        ...(hit.detalle ? { detalle: hit.detalle } : {}) };
      emparejados++;
    }

    // Clivi no tiene páginas públicas por dosis (precio de membresía): curado.
    if (curados.Clivi.prices && curados.Clivi.prices[prod.name] != null) {
      fila.Clivi = curados.Clivi.prices[prod.name];
      fila.sources.Clivi = { price: fila.Clivi, url: curados.Clivi.url, title: curados.Clivi.note };
      emparejados++;
    }

    // Overrides: precios verificados a mano, mandan sobre lo raspado.
    for (const c of columnas) {
      const ov = (curados.overrides[c] || {})[prod.name];
      if (typeof ov === 'number') {
        fila[c] = Math.round(ov);
        fila.sources[c] = { price: Math.round(ov), url: urlFarmacia[c] || '', title: 'Precio verificado manualmente' };
        emparejados++;
      }
    }
    precios[prod.name] = fila;
  }

  // ── reporte ───────────────────────────────────────────────────────────────
  const cobertura = {};
  for (const c of columnas) cobertura[c] = Object.values(precios).filter((f) => f[c] > 0).length;
  const n = catalogo.products.length;

  console.log('\n── Resumen ──');
  for (const c of columnas) console.log(`  ${c.padEnd(13)}${String(cobertura[c]).padStart(3)}/${n}`);
  console.log(`  emparejamientos: ${emparejados}`);
  if (acotada) console.log(`  celdas conservadas de la corrida anterior: ${heredadas}`);
  const st = http.stats();
  console.log(`  requests: ${st.directo} directos · ${st.proxy} por ${http.proveedor}` +
    (st.escaladas ? ` (${st.escaladas} escalados)` : ''));

  if (DRY) { console.log('\n(--dry: nada escrito)'); return; }

  fs.mkdirSync(OUT, { recursive: true });
  // Se emite EXACTAMENTE el formato que ya consume el front-end de GLPcompara
  // ({generated_at, currency, prices}). Cambiarlo obligaría a tocar 118 KB de
  // código que lleva meses funcionando, a cambio de nada.
  fs.writeFileSync(path.join(OUT, 'prices.json'),
    JSON.stringify({ generated_at: generado, currency: 'MXN', prices: precios }, null, 2));
  // El crudo también se fusiona: sirve para afinar tokens, y una corrida
  // acotada no debe borrar los resultados de las familias que no tocó.
  const crudoFinal = { ...crudoPrevio };
  for (const [fuente, fams] of Object.entries(crudo)) {
    crudoFinal[fuente] = { ...(crudoPrevio[fuente] || {}), ...fams };
  }
  fs.writeFileSync(path.join(OUT, 'crudo.json'),
    JSON.stringify({ generado, crudo: crudoFinal }, null, 2));

  // El historial comparte formato con el de laboratorio.
  const matriz = Object.entries(precios).map(([name, f]) => {
    const e = { name };
    for (const c of columnas) e[c] = f[c];
    return e;
  });
  const hist = actualizarHistorial(path.join(OUT, 'price-history.json'), matriz, columnas, generado);

  const lineas = [`# Medicamentos GLP-1 — ${generado.slice(0, 10)}`, ''];
  if (acotada) {
    lineas.push(`Corrida acotada a ${familias.join(', ')}` +
      (SOLO.length ? ` · fuentes ${SOLO.join(', ')}` : '') +
      `. El resto de la matriz viene de la corrida anterior (${heredadas} celdas).`, '');
  }
  lineas.push('| Fuente | Precios | Productos hallados | Errores |', '|---|---:|---:|---:|');
  for (const c of columnas) {
    const m = meta[c] || {};
    lineas.push(`| ${c} | ${cobertura[c]}/${n} | ${m.total ?? '—'} | ${m.errores ?? '—'} |`);
  }
  fs.writeFileSync(path.join(OUT, 'reporte.md'), lineas.join('\n') + '\n');

  console.log(`  historial: ${hist.puntos} puntos · ${hist.estudios} productos con serie`);
  console.log('\nEscrito: data/medicamentos/{prices,crudo,price-history}.json · reporte.md');
})().catch((e) => { console.error(e); process.exit(1); });
