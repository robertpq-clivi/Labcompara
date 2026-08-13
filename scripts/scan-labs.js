#!/usr/bin/env node
/**
 * Labcompara — Scanner de precios
 * --------------------------------
 * Recorre los 6 laboratorios, extrae el catálogo con precios, lo empareja
 * contra los estudios de index.html y escribe:
 *
 *   data/scan/<lab>.json    catálogo crudo por laboratorio
 *   data/precios.json       matriz comparada lista para el sitio
 *   data/reporte.md         qué cambió respecto a lo publicado
 *
 * Uso:
 *   node scripts/scan-labs.js                 # todos los labs
 *   node scripts/scan-labs.js --labs=Labbe,LAPI
 *   node scripts/scan-labs.js --limit=50      # tope de fichas por lab (pruebas)
 *   node scripts/scan-labs.js --offline       # reusa data/scan/*.json, no pide nada
 *   node scripts/scan-labs.js --apply         # además reescribe RAW_DATA en index.html
 *
 * Es el mismo pipeline que corre semanalmente en Apps Script
 * (scripts/labcompara-apps-script.gs); esta versión sirve para backfill,
 * depuración y para validar un adaptador antes de publicarlo.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { LABS } = require('./verticales/laboratorio');
const { emparejar } = require('./lib/match');
const { crearCliente } = require('./lib/http');
const { actualizarHistorial } = require('./lib/history');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'data');
const SCAN_DIR = path.join(OUT_DIR, 'scan');

const CONCURRENCIA = 5;     // requests simultáneos por laboratorio
const PAUSA_MS = 120;       // respiro entre requests de un mismo worker

// Cortacircuitos por laboratorio. Un sitio que bloquea o se cayó hace que cada
// request agote su timeout (25s × 3 intentos): con 1,500 fichas eso son horas.
// Sin estos topes, un solo lab caído se lleva la corrida semanal completa.
const MAX_MS_POR_LAB = 12 * 60 * 1000;  // presupuesto de reloj por laboratorio
                                        // (OLAB, el más grande, tarda ~8.5 min)
// Presupuesto global. El tope por laboratorio no acota la corrida completa:
// 6 labs lentos × 12 min superan el timeout del workflow, el job muere y NO se
// commitea nada. Publicar parcial (con arrastre de lo no confirmado) siempre es
// mejor que no publicar, así que la corrida se corta a tiempo para consolidar.
const MAX_MS_TOTAL = 28 * 60 * 1000;
const MUESTRA_INICIAL = 25;             // primeras fichas que deciden si sigue
const MIN_EXITOS_INICIALES = 3;         // menos que esto en la muestra → se corta

// ── CLI ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const SOLO = (arg('labs', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const LIMITE = Number(arg('limit', '0')) || 0;
const APPLY = argv.includes('--apply');
// --offline reusa data/scan/*.json en vez de volver a pedir los sitios. Es el
// modo para afinar el emparejador sin generar tráfico contra los laboratorios.
const OFFLINE = argv.includes('--offline');

// ── transporte: directo, con escalada automática a Zyte ──────────────────────
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const http = crearCliente({ log: (m) => process.stdout.write(`  ⇢ ${m}\n`) });

/** ctx que reciben los adaptadores. `proxy` fuerza Zyte desde el arranque. */
function ctxPara(lab) {
  const base = lab && lab.proxy ? { proxy: true } : {};
  return {
    get: (u, extra) => http.get(u, { ...base, ...extra }),
    getJSON: (u, extra) => http.getJSON(u, { ...base, ...extra }),
  };
}

/** Corre `tarea` sobre `items` con N workers y pausa entre requests. */
async function enParalelo(items, n, tarea, onProgreso) {
  const salida = new Array(items.length);
  let i = 0, hechos = 0;
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      try { salida[idx] = await tarea(items[idx], idx); }
      catch (e) { salida[idx] = { __error: String(e && e.message || e) }; }
      hechos++;
      if (onProgreso && hechos % 50 === 0) onProgreso(hechos, items.length);
      await dormir(PAUSA_MS);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return salida;
}

const ARRANQUE = Date.now();
const restanteGlobal = () => ARRANQUE + MAX_MS_TOTAL - Date.now();

const archivoScan = (id) => path.join(SCAN_DIR, `${id.replace(/\s+/g, '-').toLowerCase()}.json`);

// ── escaneo de un laboratorio ────────────────────────────────────────────────
async function escanear(lab) {
  const t0 = Date.now();
  const log = (m) => process.stdout.write(`  [${lab.id}] ${m}\n`);
  // Lo que quede del presupuesto global manda sobre el del laboratorio.
  const tope = Math.min(MAX_MS_POR_LAB, Math.max(0, ARRANQUE + MAX_MS_TOTAL - Date.now()));

  if (OFFLINE) {
    const f = archivoScan(lab.id);
    if (!fs.existsSync(f)) throw new Error('sin scan previo en ' + path.relative(ROOT, f));
    const filas = JSON.parse(fs.readFileSync(f, 'utf8'));
    log(`${filas.length} estudios desde disco (offline)`);
    return { filas, errores: 0, urls: 0, ms: 0 };
  }

  const ctx = ctxPara(lab);

  if (lab.modo === 'api') {
    const filas = await lab.scan(ctx);
    log(`${filas.length} estudios vía API (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    return { filas, errores: 0, urls: 1, ms: Date.now() - t0 };
  }

  let urls = await lab.urls(ctx);
  log(`${urls.length} fichas en sitemap`);
  if (LIMITE) urls = urls.slice(0, LIMITE);

  // Sonda: si las primeras fichas fallan casi todas, el sitio está bloqueando o
  // el adaptador ya no encaja. Cortar aquí evita quemar el resto del catálogo.
  // Sin reintentos en la sonda: si el sitio está caído, reintentar 3 veces cada
  // una de las 25 fichas convierte un diagnóstico de 2 minutos en uno de 6.
  const sonda = await enParalelo(urls.slice(0, MUESTRA_INICIAL), CONCURRENCIA, async (u) => {
    const html = await ctx.get(u, { reintentos: 0 });
    return lab.parse(html, u);
  });
  const exitos = sonda.filter((r) => r && !r.__error && r.nombre && r.precio).length;
  if (exitos < MIN_EXITOS_INICIALES) {
    const causa = (sonda.find((r) => r && r.__error) || {}).__error || 'sin precio en la ficha';
    log(`✗ cortado tras ${sonda.length} fichas: solo ${exitos} con precio (${causa})`);
    return { filas: [], errores: sonda.length - exitos, urls: urls.length, ms: Date.now() - t0, cortado: causa };
  }

  const resto = await enParalelo(urls.slice(MUESTRA_INICIAL), CONCURRENCIA, async (u) => {
    if (Date.now() - t0 > tope) return { __error: 'presupuesto de tiempo agotado' };
    const html = await ctx.get(u);
    return lab.parse(html, u);
  }, (h, t) => log(`${h + MUESTRA_INICIAL}/${urls.length}…`));

  const crudos = sonda.concat(resto);
  const errores = crudos.filter((r) => r && r.__error).length;
  const filas = crudos.filter((r) => r && !r.__error && r.nombre && r.precio);
  const agotado = Date.now() - t0 > tope;
  log(`${filas.length} con precio · ${errores} errores · ${((Date.now() - t0) / 1000).toFixed(1)}s` +
    (agotado ? ' · ⚠️ presupuesto de tiempo agotado, catálogo incompleto' : ''));
  return { filas, errores, urls: urls.length, ms: Date.now() - t0, agotado };
}

// ── lectura de los estudios publicados en index.html ─────────────────────────
function leerRawData() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/const RAW_DATA\s*=\s*(\[[\s\S]*?\n\];)/);
  if (!m) throw new Error('No se encontró RAW_DATA en index.html');
  // eslint-disable-next-line no-new-func
  return new Function(`return ${m[1].replace(/;$/, '')}`)();
}

const LAB_IDS = ['Labbe', 'Polanco', 'Chopo', 'Salud Digna', 'LAPI', 'OLAB'];

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  fs.mkdirSync(SCAN_DIR, { recursive: true });
  const publicados = leerRawData();
  const canonicos = publicados.map((e) => e.name);
  console.log(`Labcompara · scan de precios`);
  console.log(`${canonicos.length} estudios publicados · ${LABS.length} laboratorios`);
  if (OFFLINE) {
    console.log('modo offline: se reusa data/scan/\n');
  } else if (!http.tieneProxy()) {
    console.log('proxy anti-bloqueo: no configurado — solo acceso directo\n');
  } else {
    const chk = await http.verificarProxy();
    console.log(chk.ok
      ? `proxy anti-bloqueo: ${http.proveedor} ✓ credencial válida\n`
      : `proxy anti-bloqueo: ${http.proveedor} ✗ NO FUNCIONA (${chk.motivo})\n` +
        '  El scan directo continúa, pero no hay red de seguridad si un lab bloquea.\n');
    if (!chk.ok) process.exitCode = 0; // informativo: no tumba la corrida
  }

  const objetivo = LABS.filter((l) => !SOLO.length || SOLO.includes(l.id));
  // Un --labs con un nombre mal escrito no debe escanear nada en silencio y
  // salir verde: en un disparo manual eso se lee como "corrió bien".
  if (SOLO.length && !objetivo.length) {
    console.error(`--labs=${SOLO.join(',')} no coincide con ningún laboratorio.`);
    console.error(`Disponibles: ${LABS.map((l) => l.id).join(' · ')}`);
    process.exit(1);
  }
  if (SOLO.length) {
    const desconocidos = SOLO.filter((id) => !LABS.some((l) => l.id === id));
    if (desconocidos.length) console.log(`⚠️  ignorados (no existen): ${desconocidos.join(', ')}\n`);
  }
  const resultados = {};
  const meta = {};

  for (const lab of objetivo) {
    // Sin tiempo para escanear, se salta: su columna se arrastra intacta y la
    // corrida llega al paso de commit en vez de morir por timeout.
    if (!OFFLINE && restanteGlobal() < 60 * 1000) {
      console.log(`▸ ${lab.id} — omitido, presupuesto global agotado\n`);
      meta[lab.id] = { ok: false, error: 'presupuesto global agotado' };
      resultados[lab.id] = [];
      continue;
    }
    console.log(`▸ ${lab.id} (${lab.modo} · ${lab.fuente})`);
    try {
      const r = await escanear(lab);
      resultados[lab.id] = r.filas;
      meta[lab.id] = {
        ok: !r.cortado, estudios: r.filas.length, errores: r.errores, urls: r.urls, ms: r.ms,
        verificado: lab.verificado !== false,
        ...(r.cortado ? { cortado: r.cortado } : {}),
        ...(r.agotado ? { agotado: true } : {}),
      };
      if (!OFFLINE) fs.writeFileSync(archivoScan(lab.id), JSON.stringify(r.filas, null, 2));
    } catch (e) {
      console.log(`  [${lab.id}] ✗ ${e.message}`);
      meta[lab.id] = { ok: false, error: String(e.message || e) };
      resultados[lab.id] = [];
    }
    console.log('');
  }

  // ── emparejar contra los estudios publicados ───────────────────────────────
  const matriz = publicados.map((e) => ({ name: e.name }));
  const cobertura = {};
  const sinMatchGlobal = {};
  const porSimilitud = [];

  for (const id of LAB_IDS) {
    const filas = resultados[id];
    if (!filas || !filas.length) {           // lab no escaneado: conservar lo publicado
      publicados.forEach((e, i) => { matriz[i][id] = e[id] ?? null; });
      cobertura[id] = { emparejados: 0, fuente: 'publicado' };
      continue;
    }
    const { mapeo, sinMatch } = emparejar(canonicos, filas);
    let arrastrados = 0;
    publicados.forEach((e, i) => {
      const hit = mapeo.get(e.name);
      // Sin match no se concluye que el estudio dejó de existir: lo más probable
      // es que el laboratorio lo nombre distinto. Se conserva el precio anterior
      // y se cuenta como arrastre; borrarlo dejaría huecos en el comparador.
      if (hit) matriz[i][id] = hit.precio;
      else { matriz[i][id] = e[id] ?? null; if (e[id]) arrastrados++; }
    });
    cobertura[id] = { emparejados: mapeo.size, arrastrados, catalogo: filas.length, fuente: 'scan' };
    sinMatchGlobal[id] = sinMatch.length;
    // Los emparejamientos exactos y por alias son seguros; los de similitud son
    // una apuesta y van al reporte para que alguien los valide.
    for (const [canon, hit] of mapeo) {
      if (hit.via === 'similitud') porSimilitud.push({ lab: id, canon, encontrado: hit.nombre, score: hit.score, precio: hit.precio });
    }
  }

  // avg + cheapest recalculados
  for (const fila of matriz) {
    const vals = LAB_IDS.map((l) => fila[l]).filter((v) => typeof v === 'number' && v > 0);
    fila.avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    fila.cheapest = vals.length
      ? LAB_IDS.reduce((best, l) => (fila[l] && (!best || fila[l] < fila[best]) ? l : best), null)
      : null;
  }

  // ── diff contra lo publicado ───────────────────────────────────────────────
  const cambios = [];
  publicados.forEach((antes, i) => {
    const ahora = matriz[i];
    for (const l of LAB_IDS) {
      const a = antes[l] ?? null, b = ahora[l] ?? null;
      if (a === b) continue;
      cambios.push({
        estudio: antes.name, lab: l, antes: a, ahora: b,
        delta: a && b ? +(((b - a) / a) * 100).toFixed(1) : null,
      });
    }
  });

  // Un salto de más de 3x en cualquier dirección casi nunca es una promoción:
  // suele ser un emparejamiento equivocado o un selector que cambió.
  const alertas = cambios.filter((c) => c.antes && c.ahora && (c.ahora / c.antes > 3 || c.ahora / c.antes < 1 / 3));

  const generado = new Date().toISOString();
  const feed = {
    generado,
    fuente: 'scan-labs.js',
    labs: LAB_IDS,
    meta,
    cobertura,
    estudios: matriz,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'precios.json'), JSON.stringify(feed, null, 2));

  const hist = actualizarHistorial(path.join(OUT_DIR, 'price-history.json'), matriz, LAB_IDS, generado);

  // ── reporte ───────────────────────────────────────────────────────────────
  const catalogoTotal = Object.values(resultados).reduce((n, r) => n + r.length, 0);
  const lineas = [];
  lineas.push(`# Reporte de scan — ${new Date().toISOString().slice(0, 10)}`, '');
  lineas.push(`Catálogo total escaneado: **${catalogoTotal.toLocaleString('es-MX')} estudios** en ${objetivo.length} laboratorios.`, '');
  lineas.push('## Cobertura por laboratorio', '');
  lineas.push('| Lab | Modo | Catálogo | Confirmados | Arrastrados | Errores |', '|---|---|---:|---:|---:|---:|');
  for (const id of LAB_IDS) {
    const m = meta[id] || {};
    const c = cobertura[id] || {};
    lineas.push(`| ${id} | ${m.ok === false ? '✗ falló' : (LABS.find((l) => l.id === id) || {}).modo || '—'} | ${c.catalogo ?? '—'} | ${c.emparejados ?? 0} | ${c.arrastrados ?? '—'} | ${m.errores ?? '—'} |`);
  }
  lineas.push('', '_"Confirmados" son precios leídos del laboratorio esta corrida. "Arrastrados"',
    'son los que no se pudieron emparejar y conservan el valor anterior._');
  lineas.push('', `## ⚠️ Cambios sospechosos: ${alertas.length}`, '');
  lineas.push('_Saltos de más de 3× en cualquier dirección. Casi nunca son promociones:',
    'revisa el emparejamiento antes de publicar._', '');
  if (alertas.length) {
    lineas.push('| Estudio | Lab | Antes | Ahora | Δ |', '|---|---|---:|---:|---:|');
    for (const a of alertas) lineas.push(`| ${a.estudio} | ${a.lab} | ${a.antes} | ${a.ahora} | ${a.delta}% |`);
  }
  lineas.push('', `## Emparejamientos por similitud: ${porSimilitud.length}`, '');
  lineas.push('_Los exactos y por alias son seguros. Estos son inferidos y conviene validarlos:',
    'lo que esté mal se corrige agregando un alias en la hoja `Catalogo`._', '');
  if (porSimilitud.length) {
    lineas.push('| Lab | Estudio de Labcompara | Encontrado en el lab | Score | Precio |', '|---|---|---|---:|---:|');
    for (const s of porSimilitud.sort((a, b) => a.score - b.score)) {
      lineas.push(`| ${s.lab} | ${s.canon} | ${s.encontrado} | ${s.score} | ${s.precio} |`);
    }
  }
  lineas.push('', `## Cambios de precio detectados: ${cambios.length}`, '');
  if (cambios.length) {
    lineas.push('| Estudio | Lab | Publicado | Escaneado | Δ |', '|---|---|---:|---:|---:|');
    for (const c of cambios.slice(0, 200)) {
      lineas.push(`| ${c.estudio} | ${c.lab} | ${c.antes ?? '—'} | ${c.ahora ?? '—'} | ${c.delta !== null ? c.delta + '%' : '—'} |`);
    }
    if (cambios.length > 200) lineas.push('', `_… y ${cambios.length - 200} más (ver data/precios.json)._`);
  }
  fs.writeFileSync(path.join(OUT_DIR, 'reporte.md'), lineas.join('\n'));

  console.log(`── Resumen ──`);
  console.log(`Catálogo escaneado : ${catalogoTotal.toLocaleString('es-MX')} estudios`);
  for (const id of LAB_IDS) {
    const c = cobertura[id] || {};
    console.log(`  ${id.padEnd(13)} catálogo ${String(c.catalogo ?? '—').padStart(5)} · confirmados ${String(c.emparejados ?? 0).padStart(3)}/${canonicos.length} · arrastrados ${String(c.arrastrados ?? 0).padStart(3)}`);
  }
  console.log(`Por similitud      : ${porSimilitud.length} (revisar en data/reporte.md)`);
  console.log(`Cambios sospechosos: ${alertas.length}${alertas.length ? '  ⚠️  revisar antes de publicar' : ''}`);
  console.log(`Cambios de precio  : ${cambios.length}`);
  if (!OFFLINE) {
    const st = http.stats();
    console.log(`Requests           : ${st.directo} directos · ${st.proxy} por ${http.proveedor}` +
      (st.escaladas ? ` (${st.escaladas} escalados por bloqueo)` : ''));
  }
  console.log(`Historial          : ${hist.puntos} puntos nuevos · ${hist.estudios} estudios con serie`);
  console.log(`\nEscrito: data/precios.json · data/price-history.json · data/reporte.md · data/scan/*.json`);

  if (APPLY) {
    const { escribirRawData } = require('./lib/apply');
    escribirRawData(matriz);
    console.log('index.html actualizado con los precios escaneados.');
  }
})().catch((e) => { console.error(e); process.exit(1); });
