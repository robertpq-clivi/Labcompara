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
// La segunda pasada —preguntar por las marcas halladas en las farmacias donde
// no salieron— es lo que hace que exista la comparación por marca, y también
// lo que más requests cuesta. Se puede apagar y se puede acotar.
const SIN_MARCAS = argv.includes('--sin-marcas');
const MAX_MARCAS = Number(arg('max-marcas', '400')) || 400;
// Guadalajara solo responde por proxy, que no existe en local: este filtro
// permite validar el resto sin esperar sus timeouts.
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
  /**
   * Lo mismo, pero con la marca dentro de la llave.
   *
   * Comparar por principio activo responde "¿dónde está más barato el
   * omeprazol de 20 mg?". No responde "¿dónde está más barata mi Tempra?", y
   * para los medicamentos muy conocidos esa es la pregunta que la gente hace:
   * la marca es como conocen el medicamento. Son dos comparaciones distintas y
   * las dos son útiles, así que se publican las dos.
   */
  const porMarca = new Map();
  const descartes = { combinados: 0, sinDosis: 0, sinPiezas: 0, otraSustancia: 0 };

  /** Marcas vistas: marcasDe[medicamento] = Map(marca → Set(farmacias)) */
  const marcasDe = {};

  /**
   * Una consulta a una farmacia, y lo que se hace con lo que devuelve.
   *
   * Está aparte porque se llama dos veces con intenciones distintas: primero
   * buscando el principio activo, después buscando marcas concretas.
   */
  async function consultar(med, ad, consulta, marcaBuscada) {
    // Cuando se pregunta por una marca, esa marca vale como evidencia del
    // principio activo para esta consulta. No es un supuesto: la marca solo
    // llega aquí si en la pasada 1 apareció en un título que SÍ nombraba el
    // activo. Sin esto, "Tempra 160 Mg 30 Tabletas" —que no dice paracetamol
    // por ningún lado— quedaría fuera, y con él media comparación por marca.
    const conMarca = marcaBuscada ? { ...med, sinonimos: [marcaBuscada] } : med;
    const ctx = ctxPara(ad);
    let items = [];
    try {
      items = await ad.buscar(ctx, consulta);
      meta[ad.id].hallados += items.length;
    } catch (e) {
      meta[ad.id].errores++;
      await dormir(PAUSA_MS);
      return;
    }
    const bolsa = (crudo[med.nombre] = crudo[med.nombre] || {});
    bolsa[ad.id] = (bolsa[ad.id] || []).concat(items);

      for (const it of items) {
        // Se pasa la entrada completa, no solo el nombre: trae la raíz con la
        // que reconocer el activo, las marcas comerciales con las que media
        // farmacia titula sus productos, y —si el producto es un combinado—
        // los dos activos que el título tiene que mencionar.
        // El texto que se lee es el título MÁS lo que la farmacia sepa decir
        // aparte: el slug de Benavides y la descripción de San Pablo traen las
        // piezas y la forma que sus títulos omiten. Sin esto, esas dos
        // aportaban 8 y 11 filas de miles de productos.
        const texto = [it.titulo, it.detalle].filter(Boolean).join(' ');
        const p = leer(texto, conMarca);
        if (!p.clave) {
          if (p.combinado) descartes.combinados++;
          else if (p.motivo) descartes.otraSustancia++;
          else if (p.mg === null) descartes.sinDosis++;
          else descartes.sinPiezas++;
          continue;
        }
        meta[ad.id].conLlave++;
        const base = () => ({
          medicamento: med.nombre, rank: med.rank, categoria: med.categoria,
          mg: p.mg, forma: p.forma, piezas: p.piezas, ml: p.ml,
          precios: {},
        });
        // La marca que declara la farmacia gana sobre la que deducimos del
        // texto: `undefined` es "no dijo", pero `null` es "dijo que es
        // genérico", y eso último es un dato, no una ausencia.
        const marcaFinal = it.marca !== undefined ? it.marca : p.marca;
        const oferta = { precio: it.precio, titulo: it.titulo, url: it.url, marca: marcaFinal };

        // Fila por principio activo: entre variantes de la MISMA caja se
        // publica la más barata, sea de marca o genérica. Es la que el cliente
        // puede ir a comprar.
        const g = presentaciones.get(p.clave)
          || Object.assign(base(), { tipo: 'sustancia', clave: p.clave, etiqueta: etiqueta(p.clave) });
        if (!g.precios[ad.id] || it.precio < g.precios[ad.id].precio) g.precios[ad.id] = oferta;
        presentaciones.set(p.clave, g);

        // Fila por marca: la misma caja de la misma marca en cada farmacia.
        if (marcaFinal) {
          const cm = `${p.clave}|marca:${marcaFinal.toLowerCase()}`;
          const gm = porMarca.get(cm) || Object.assign(base(), {
            tipo: 'marca', clave: cm, marca: marcaFinal,
            // "Tempra 500mg · 20 tabletas" en vez de "Paracetamol 500mg · …":
            // así se lee como lo que el cliente fue a buscar.
            etiqueta: etiqueta(p.clave).replace(/^[^\s]+/, marcaFinal),
          });
          if (!gm.precios[ad.id] || it.precio < gm.precios[ad.id].precio) gm.precios[ad.id] = oferta;
          porMarca.set(cm, gm);

          const vistas = (marcasDe[med.nombre] = marcasDe[med.nombre] || new Map());
          if (!vistas.has(marcaFinal)) vistas.set(marcaFinal, new Set());
          vistas.get(marcaFinal).add(ad.id);
        }
      }
    await dormir(PAUSA_MS);
  }

  // ── pasada 1: por principio activo, y por las marcas que la hoja ya trae ──
  for (const med of meds) {
    // "Buscapina", "Aspirina", "Dramamine": la hoja las anota entre paréntesis
    // y son justamente los medicamentos que nadie pide por su principio activo.
    const consultas = [med.query, ...(med.tambien || '').split(/\s*[/,]\s*/).filter(Boolean)];
    for (const ad of adaptadores) {
      for (const q of consultas) await consultar(med, ad, q);
    }
    process.stdout.write(`  ${String(med.rank).padStart(3)}. ${med.nombre.padEnd(24)} ${presentaciones.size} presentaciones acumuladas\n`);
  }

  // ── pasada 2: las marcas que aparecieron, buscadas donde faltan ───────────
  //
  // Buscar "paracetamol" hace que cada farmacia devuelva sobre todo su propia
  // línea: Ahorro contesta con Marca del Ahorro y Prixz con genéricos, así que
  // las marcas casi nunca coinciden y no hay nada que comparar. Preguntando por
  // "Tempra" en las cinco, sí. Solo se pregunta donde esa marca aún no salió.
  const pendientes = [];
  for (const med of meds) {
    for (const [m, donde] of marcasDe[med.nombre] || []) {
      const faltan = adaptadores.filter((ad) => !donde.has(ad.id));
      if (faltan.length) pendientes.push({ med, marca: m, faltan, vista: donde.size });
    }
  }
  // Las vistas en más farmacias primero: son las que tienen más probabilidad de
  // completar una comparación, que es lo único que se publica.
  pendientes.sort((a, b) => b.vista - a.vista);
  const aBuscar = SIN_MARCAS ? [] : pendientes.slice(0, MAX_MARCAS);
  if (aBuscar.length) {
    const omitidas = pendientes.length - aBuscar.length;
    console.log(`\n  ${aBuscar.length} marcas por confirmar en las farmacias donde no salieron${omitidas ? ` (${omitidas} omitidas por el tope de ${MAX_MARCAS})` : ''}`);
    let i = 0;
    for (const p of aBuscar) {
      for (const ad of p.faltan) await consultar(p.med, ad, p.marca, p.marca);
      if (++i % 20 === 0) process.stdout.write(`  ${i}/${aBuscar.length} marcas · ${porMarca.size} presentaciones de marca\n`);
    }
  }

  // ── solo se publica lo que de verdad se puede comparar ──────────────────
  const conDos = (g) => Object.keys(g.precios).length >= MIN_FARMACIAS;
  const porSustancia = [...presentaciones.values()].filter(conDos);

  // Una fila de marca sobra cuando repite exactamente la de su sustancia: pasa
  // cuando esa caja solo existe de esa marca, y entonces las dos dirían lo
  // mismo con distinto nombre. La de sustancia ya trae la marca en cada precio.
  const huella = (g) => Object.entries(g.precios).sort()
    .map(([f, v]) => `${f}:${v.precio}`).join('|');
  const huellas = new Set(porSustancia.map(huella));
  const marcas = [...porMarca.values()].filter((g) => conDos(g) && !huellas.has(huella(g)));

  const comparables = [...porSustancia, ...marcas]
    .sort((a, b) => a.rank - b.rank || a.mg - b.mg || (a.piezas || 0) - (b.piezas || 0)
      || (a.tipo === b.tipo ? 0 : a.tipo === 'sustancia' ? -1 : 1));

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
  console.log(`  presentaciones distintas : ${presentaciones.size} por sustancia · ${porMarca.size} por marca`);
  console.log(`  comparables (${MIN_FARMACIAS}+ farmacias): ${porSustancia.length} por sustancia · ${marcas.length} por marca`);
  console.log(`  descartes: ${descartes.combinados} combinados · ${descartes.sinDosis} sin dosis · ${descartes.sinPiezas} sin piezas · ${descartes.otraSustancia} otra sustancia`);
  const st = http.stats();
  console.log(`  requests: ${st.directo} directos · ${st.proxy} por ${http.proveedor}`);

  if (marcas.length) {
    console.log('\n  Comparaciones por marca:');
    for (const g of marcas.slice(0, 10)) {
      const detalle = Object.entries(g.precios).map(([f, v]) => `${f} $${v.precio}`).join(' · ');
      console.log(`    ${g.etiqueta.padEnd(38)} ${detalle}`);
    }
  }

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
    `${comparables.length} presentaciones comparables de ${meds.length} principios activos:`,
    `${porSustancia.length} por principio activo y ${marcas.length} por marca.`, '',
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
  if (marcas.length) {
    // Mismo producto, misma marca, misma caja: la comparación más limpia que
    // hay, y la que revisa mejor si el scan está sano —dos precios muy
    // distintos para la misma marca casi siempre son un error de lectura—.
    L.push('', '## Misma marca en dos o más farmacias', '',
      '| Marca y caja | Precios | Diferencia |', '|---|---|---:|');
    for (const g of [...marcas].sort((a, b) => b.ahorro - a.ahorro).slice(0, 25)) {
      const det = Object.entries(g.precios).sort((a, b) => a[1].precio - b[1].precio)
        .map(([f, v]) => `${f} $${v.precio}`).join(' · ');
      L.push(`| ${g.etiqueta} | ${det} | $${g.ahorro} |`);
    }
  }
  fs.writeFileSync(path.join(OUT, 'reporte.md'), L.join('\n') + '\n');

  console.log(`  historial: ${hist.puntos} puntos`);
  console.log('\nEscrito: data/medicinas/{prices,crudo,price-history}.json · reporte.md');
})().catch((e) => { console.error(e); process.exit(1); });
