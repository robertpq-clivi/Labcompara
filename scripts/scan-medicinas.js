#!/usr/bin/env node
/**
 * Medcompara — Scanner de precios de medicamentos de farmacia
 * ------------------------------------------------------------
 * Tercera vertical. Comparte transporte, parseo e historial con las otras dos;
 * lo que cambia es la unidad de comparación.
 *
 * En laboratorio se compara "el mismo estudio" y en GLP-1 "la misma dosis".
 * Aquí se compara **la misma caja**: el mismo principio activo se vende en
 * presentaciones que no son intercambiables (omeprazol 20 mg cuesta $7.71 por
 * cápsula en caja de 7 y $1.34 en caja de 120, en la MISMA farmacia). Por eso
 * la llave incluye dosis, forma y número de piezas, y solo se publica una fila
 * cuando dos o más farmacias tienen exactamente esa caja.
 *
 *   node scripts/scan-medicinas.js
 *   node scripts/scan-medicinas.js --meds=Omeprazol,Paracetamol
 *   node scripts/scan-medicinas.js --limit=20     # primeros N del ranking
 *   node scripts/scan-medicinas.js --fuentes=Ahorro,Prixz
 *   node scripts/scan-medicinas.js --dry
 *
 * Escribe:
 *   data/medicinas/prices.json   presentaciones comparables
 *   data/medicinas/crudo.json    todo lo hallado, para afinar el parser
 *   data/medicinas/reporte.md    cobertura y qué se descartó
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { crearCliente } = require('./lib/http');
const { actualizarHistorial } = require('./lib/history');
const { leer, etiqueta } = require('./lib/presentacion');
const V = require('./verticales/medicinas');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'medicinas');

const PAUSA_MS = 1500;
/** Una fila sin al menos dos farmacias no es una comparación. */
const MIN_FARMACIAS = 2;

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const SOLO = (arg('meds', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const LIMITE = Number(arg('limit', '0')) || 0;
const DRY = argv.includes('--dry');
// Guadalajara y San Pablo solo responden por proxy, que no existe en local:
// este filtro permite validar el resto sin esperar sus timeouts.
const FUENTES = (arg('fuentes', '') || '').split(',').map((s) => s.trim()).filter(Boolean);

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
  const { columnas, catalogo, urlFarmacia } = V;
  const adaptadores = V.adaptadores.filter((a) => !FUENTES.length || FUENTES.includes(a.id));
  let meds = catalogo.medicamentos;
  if (SOLO.length) meds = meds.filter((m) => SOLO.some((s) => m.nombre.toLowerCase() === s.toLowerCase()));
  if (LIMITE) meds = meds.slice(0, LIMITE);

  console.log('Medcompara · scan de medicamentos de farmacia');
  console.log(`${meds.length} principios activos · ${adaptadores.length} farmacias`);
  if (!DRY) {
    const chk = await http.verificarProxy();
    console.log(chk.ok
      ? `proxy anti-bloqueo: ${http.proveedor} ✓ credencial válida\n`
      : `proxy anti-bloqueo: ${http.proveedor} ✗ ${chk.motivo}\n`);
  }

  const generado = new Date().toISOString();
  const crudo = {};
  const meta = {};
  for (const c of columnas) meta[c] = { hallados: 0, conLlave: 0, errores: 0 };

  /** presentaciones[clave] = { med, clave, precios:{farmacia:{precio,titulo,url}} } */
  const presentaciones = new Map();
  const descartes = { combinados: 0, sinDosis: 0, sinPiezas: 0, otraSustancia: 0 };

  for (const med of meds) {
    for (const ad of adaptadores) {
      const ctx = ctxPara(ad);
      let items = [];
      try {
        items = await ad.buscar(ctx, med.query);
        meta[ad.id].hallados += items.length;
      } catch (e) {
        meta[ad.id].errores++;
        await dormir(PAUSA_MS);
        continue;
      }
      (crudo[med.nombre] = crudo[med.nombre] || {})[ad.id] = items;

      for (const it of items) {
        // Se pasa la entrada completa, no solo el nombre: trae la raíz con la
        // que reconocer el activo, las marcas comerciales con las que media
        // farmacia titula sus productos, y —si el producto es un combinado—
        // los dos activos que el título tiene que mencionar.
        const p = leer(it.titulo, med);
        if (!p.clave) {
          if (p.combinado) descartes.combinados++;
          else if (p.motivo) descartes.otraSustancia++;
          else if (p.mg === null) descartes.sinDosis++;
          else descartes.sinPiezas++;
          continue;
        }
        meta[ad.id].conLlave++;
        const g = presentaciones.get(p.clave) || {
          medicamento: med.nombre, rank: med.rank, categoria: med.categoria,
          clave: p.clave, etiqueta: etiqueta(p.clave),
          mg: p.mg, forma: p.forma, piezas: p.piezas, ml: p.ml,
          precios: {},
        };
        // Entre variantes de la MISMA caja (distintas marcas de genérico) se
        // publica la más barata: es la que el cliente puede comprar.
        const prev = g.precios[ad.id];
        if (!prev || it.precio < prev.precio) {
          g.precios[ad.id] = { precio: it.precio, titulo: it.titulo, url: it.url };
        }
        presentaciones.set(p.clave, g);
      }
      await dormir(PAUSA_MS);
    }
    process.stdout.write(`  ${String(med.rank).padStart(3)}. ${med.nombre.padEnd(24)} ${presentaciones.size} presentaciones acumuladas\n`);
  }

  // ── solo se publica lo que de verdad se puede comparar ──────────────────
  const comparables = [...presentaciones.values()]
    .filter((g) => Object.keys(g.precios).length >= MIN_FARMACIAS)
    .sort((a, b) => a.rank - b.rank || a.mg - b.mg || (a.piezas || 0) - (b.piezas || 0));

  for (const g of comparables) {
    const vals = Object.values(g.precios).map((p) => p.precio);
    g.min = Math.min(...vals);
    g.max = Math.max(...vals);
    g.ahorro = g.max - g.min;
    g.masBarata = Object.keys(g.precios).find((f) => g.precios[f].precio === g.min);
    // Precio por pieza: informativo, para que se vea qué caja conviene.
    const u = g.piezas || g.ml;
    if (u) g.porUnidad = Math.round((g.min / u) * 100) / 100;
  }

  console.log('\n── Resumen ──');
  for (const c of columnas) {
    const m = meta[c];
    console.log(`  ${c.padEnd(13)}${String(m.hallados).padStart(5)} productos · ${String(m.conLlave).padStart(5)} con presentación legible · ${m.errores} errores`);
  }
  console.log(`  presentaciones distintas : ${presentaciones.size}`);
  console.log(`  comparables (${MIN_FARMACIAS}+ farmacias): ${comparables.length}`);
  console.log(`  descartes: ${descartes.combinados} combinados · ${descartes.sinDosis} sin dosis · ${descartes.sinPiezas} sin piezas · ${descartes.otraSustancia} otra sustancia`);
  const st = http.stats();
  console.log(`  requests: ${st.directo} directos · ${st.proxy} por ${http.proveedor}`);

  if (DRY) { console.log('\n(--dry: nada escrito)'); return; }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'prices.json'), JSON.stringify({
    generated_at: generado, currency: 'MXN', fuentes: columnas,
    nota: 'Solo se publican presentaciones idénticas (misma dosis, forma y número de piezas) presentes en 2 o más farmacias.',
    presentaciones: comparables,
  }, null, 2));
  fs.writeFileSync(path.join(OUT, 'crudo.json'), JSON.stringify({ generado, crudo }, null, 2));

  const matriz = comparables.map((g) => {
    const e = { name: g.etiqueta };
    for (const c of columnas) e[c] = g.precios[c] ? g.precios[c].precio : null;
    return e;
  });
  const hist = actualizarHistorial(path.join(OUT, 'price-history.json'), matriz, columnas, generado);

  const L = [`# Medicamentos de farmacia — ${generado.slice(0, 10)}`, '',
    `${comparables.length} presentaciones comparables de ${meds.length} principios activos.`, '',
    '| Farmacia | Productos | Con presentación legible | Presentaciones publicadas | Errores |', '|---|---:|---:|---:|---:|'];
  for (const c of columnas) {
    const m = meta[c];
    L.push(`| ${c} | ${m.hallados} | ${m.conLlave} | ${comparables.filter((g) => g.precios[c]).length} | ${m.errores} |`);
  }
  L.push('', '## Mayores diferencias de precio', '',
    '| Presentación | Más barata | Más cara | Diferencia |', '|---|---:|---:|---:|');
  for (const g of [...comparables].sort((a, b) => b.ahorro - a.ahorro).slice(0, 20)) {
    L.push(`| ${g.etiqueta} | $${g.min} (${g.masBarata}) | $${g.max} | $${g.ahorro} |`);
  }
  fs.writeFileSync(path.join(OUT, 'reporte.md'), L.join('\n') + '\n');

  console.log(`  historial: ${hist.puntos} puntos`);
  console.log('\nEscrito: data/medicinas/{prices,crudo,price-history}.json · reporte.md');
})().catch((e) => { console.error(e); process.exit(1); });
