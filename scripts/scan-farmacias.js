#!/usr/bin/env node
/**
 * Labcompara — Scanner de precios de medicamentos GLP-1
 * ------------------------------------------------------
 * Equivalente de scan-labs.js para la vertical de farmacias. Comparte con él
 * el transporte (lib/http.js con escalada a Zyte), el parseo de precios y el
 * historial; cambia el emparejamiento, que aquí va por tokens declarados en
 * verticales/farmacias-catalogo.json.
 *
 *   node scripts/scan-farmacias.js
 *   node scripts/scan-farmacias.js --fuentes=Benavides,Ahorro
 *   node scripts/scan-farmacias.js --dry     # no escribe nada
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
  const familias = Object.keys(catalogo.families);

  console.log('Labcompara · scan de medicamentos GLP-1');
  console.log(`${catalogo.products.length} presentaciones · ${familias.length} familias · ${columnas.length} fuentes`);
  if (!DRY) {
    const chk = await http.verificarProxy();
    console.log(chk.ok
      ? `proxy anti-bloqueo: ${http.proveedor} ✓ credencial válida\n`
      : `proxy anti-bloqueo: ${http.proveedor} ✗ NO FUNCIONA (${chk.motivo})\n`);
  }

  // ── raspar cada fuente, una vez por familia ────────────────────────────────
  const crudo = {};
  const meta = {};
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

  for (const prod of catalogo.products) {
    const fila = { sources: {} };
    for (const c of columnas) fila[c] = null;

    for (const ad of objetivo) {
      const hit = V.elegir(crudo[ad.id][prod.family] || [], prod, ad.id, catalogo.families[prod.family]);
      if (!hit) continue;
      fila[ad.id] = hit.precio;
      fila.sources[ad.id] = { price: hit.precio, url: hit.url, title: hit.titulo };
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
  fs.writeFileSync(path.join(OUT, 'crudo.json'),
    JSON.stringify({ generado, crudo }, null, 2));

  // El historial comparte formato con el de laboratorio.
  const matriz = Object.entries(precios).map(([name, f]) => {
    const e = { name };
    for (const c of columnas) e[c] = f[c];
    return e;
  });
  const hist = actualizarHistorial(path.join(OUT, 'price-history.json'), matriz, columnas, generado);

  const lineas = [`# Medicamentos GLP-1 — ${generado.slice(0, 10)}`, '',
    '| Fuente | Precios | Productos hallados | Errores |', '|---|---:|---:|---:|'];
  for (const c of columnas) {
    const m = meta[c] || {};
    lineas.push(`| ${c} | ${cobertura[c]}/${n} | ${m.total ?? '—'} | ${m.errores ?? '—'} |`);
  }
  fs.writeFileSync(path.join(OUT, 'reporte.md'), lineas.join('\n') + '\n');

  console.log(`  historial: ${hist.puntos} puntos · ${hist.estudios} productos con serie`);
  console.log('\nEscrito: data/medicamentos/{prices,crudo,price-history}.json · reporte.md');
})().catch((e) => { console.error(e); process.exit(1); });
