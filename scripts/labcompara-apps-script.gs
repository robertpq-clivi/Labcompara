/**
 * Labcompara — Scanner semanal de precios + captura de leads
 * ===========================================================
 * Misma infraestructura que GLPcompara: Google Sheets + Apps Script publicado
 * como aplicación web. Aquí se le suma el motor de scraping.
 *
 * QUÉ HACE
 *   1. Cada 7 días recorre los 6 laboratorios y extrae su catálogo con precios.
 *   2. Empareja los nombres contra el catálogo canónico de Labcompara.
 *   3. Escribe la matriz comparada en la hoja "Precios", guarda el histórico de
 *      cambios y deja un log de cada corrida.
 *   4. Publica el resultado como JSON en   GET  <url-webapp>?feed=precios
 *      que index.html consume en caliente (con respaldo al RAW_DATA embebido).
 *   5. Sigue recibiendo leads/clicks/comparaciones/suscripciones por POST,
 *      idéntico a glpcompara-apps-script-v5.gs.
 *
 * INSTALACIÓN (una sola vez)
 *   1. Crea una hoja de cálculo nueva en Google Sheets.
 *   2. Extensiones → Apps Script. Pega este archivo completo.
 *   3. Ejecuta la función  instalar()  y autoriza los permisos.
 *      → crea las hojas y programa el trigger semanal.
 *   4. Implementar → Nueva implementación → Aplicación web
 *        Ejecutar como: Yo
 *        Quién tiene acceso: Cualquier persona
 *      Copia la URL /exec y pégala en index.html → FEED_URL.
 *   5. Opcional: ejecuta  escanearAhora()  para llenar los datos de inmediato.
 *
 * REDEPLOY
 *   Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva versión.
 *   (Se conserva la misma URL.)
 *
 * LÍMITES QUE CONDICIONAN EL DISEÑO
 *   · Una ejecución de Apps Script muere a los 6 minutos. El catálogo completo
 *     son ~4,200 fichas HTML, muy por encima de eso. Por eso el scan es
 *     RESUMIBLE: se encola en la hoja "_Cola", se procesa por lotes durante
 *     ~4.5 min y se auto-reprograma con un trigger de un solo uso hasta vaciar
 *     la cola. Una corrida completa toma ~6-8 disparos encadenados.
 *   · UrlFetchApp: 20,000 llamadas/día. Una corrida usa ~4,300.
 */

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ CONFIGURACIÓN                                                            ║
// ╚══════════════════════════════════════════════════════════════════════════╝

const CFG = {
  DIAS_ENTRE_SCANS: 7,
  LOTE: 30,                 // fichas por fetchAll
  LIMITE_MS: 4.5 * 60 * 1000, // presupuesto por ejecución antes de reprogramar
  UA: 'LabcomparaBot/1.0 (+https://labcompara.com; comparador de precios)',
  UMBRAL_MATCH: 0.82,       // similitud mínima para aceptar un emparejamiento
  MIN_CATALOGO: 0.3,        // un scan con <30% del catálogo previo se descarta
  HOJAS: {
    precios: 'Precios',
    historico: 'Historico',
    catalogo: 'Catalogo',
    log: 'Scan_Log',
    revisar: 'Sin_Match',
    cola: '_Cola',
    crudo: '_Crudo',
  },
};

const LAB_IDS = ['Labbe', 'Polanco', 'Chopo', 'Salud Digna', 'LAPI', 'OLAB'];

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ ADAPTADORES POR LABORATORIO                                              ║
// ║ Espejo de scripts/lib/labs.js — si cambias uno, cambia el otro.          ║
// ╚══════════════════════════════════════════════════════════════════════════╝

const LABS = {

  /** Un request: la API pública de la app de citas devuelve todo LABORATORIO. */
  'Salud Digna': {
    modo: 'api',
    activo: true,
    scan: function () {
      const url = 'https://api.emarketingsd.org/Citas/Citas2/SubEstudiosPorSucursalPP' +
        '?estudio%5Bid%5D=2&sucursal%5Bid%5D=1&filtro=1&busqueda=';
      const filas = JSON.parse(traer_(url));
      return filas.map(function (r) {
        return {
          nombre: limpiarTexto_(r.Descripcion),
          precio: aPrecio_(r.Precio),
          lista: aPrecio_(r.PrecioOriginal) || aPrecio_(r.Precio),
          url: 'https://www.salud-digna.org/precios-preparaciones/estudios',
        };
      }).filter(function (r) { return r.nombre && r.precio; });
    },
  },

  /**
   * Los precios no están en el HTML (dependen de sucursal): salen de la API de
   * SYNLAB, que devuelve { onlineDiscountPercent, prices: { SKU: {originalPrice,
   * loyaltyPrice} } }. El nombre se cruza con el catálogo de BigCommerce.
   */
  Polanco: {
    modo: 'api',
    activo: true,
    locationCode: '670', // Acoxpa, CDMX
    scan: function () {
      const info = JSON.parse(traer_(
        'https://booking.global.synlabaccess.health/api/booking/v2/products/get-partner-price-info' +
        '?locationCode=' + this.locationCode));
      const dto = Number(info.onlineDiscountPercent) || 0;
      const todos = !!info.onlineDiscountForAllProducts;
      const conDto = {};
      (info.productCodesWithOnlineDiscount || []).forEach(function (c) { conDto[c] = true; });

      const nombres = {};
      for (let page = 1; page <= 25; page++) {
        // BigCommerce responde 404 al pasarse de la última página: fin del catálogo.
        let html;
        try { html = traer_('https://lmpolanco.com/todos/?limit=100&page=' + page); }
        catch (e) { break; }
        const re = /\\"sku\\":\\"([^"\\]*)\\",\\"name\\":\\"((?:[^"\\]|\\.)*?)\\"/g;
        let m, n = 0;
        while ((m = re.exec(html)) !== null) {
          n++;
          const sku = m[1].trim();
          if (sku && !nombres[sku]) nombres[sku] = limpiarTexto_(m[2].replace(/\\(.)/g, '$1'));
        }
        if (n === 0) break;
      }

      const out = [];
      Object.keys(info.prices || {}).forEach(function (sku) {
        const lista = aPrecio_(info.prices[sku] && info.prices[sku].originalPrice);
        if (!lista) return;
        const online = (todos || conDto[sku]) ? Math.round(lista * (1 - dto / 100) * 100) / 100 : lista;
        out.push({ nombre: nombres[sku] || sku, precio: online, lista: lista, url: 'https://lmpolanco.com/' });
      });
      return out;
    },
  },

  /** Sitio propio; el precio vive en el div .precio_gral de cada ficha. */
  Labbe: {
    modo: 'catalogo',
    activo: true,
    urls: function () {
      return locs_(traer_('https://www.labbe.mx/sitemap.xml')).filter(function (u) {
        return /\/estudios\/[^\/]+$/.test(u);
      });
    },
    parse: function (html, url) {
      const p = html.match(/class="[^"]*precio_gral[^"]*"[^>]*>([\s\S]{0,200}?)<\/div>/i);
      const precio = p ? aPrecio_(sinTags_(p[1])) : null;
      // El <h1> y el <h3 class="titulo_covid"> siempre dicen "LABORATORIO".
      const og = html.match(/property="og:title"[^>]*content="([^"]*)"/i);
      const sub = html.match(/class="[^"]*subtitulo_covid[^"]*"[^>]*>([\s\S]{0,160}?)<\/div>/i);
      const tit = html.match(/<title>([^<]*)</i);
      const nombre = limpiarTexto_(sinTags_((og && og[1]) || (sub && sub[1]) || (tit ? tit[1].split('|')[0] : '')));
      if (!nombre || !precio) return null;
      return { nombre: nombre, precio: precio, lista: precio, url: url };
    },
  },

  /** Magento 2: precio en línea en .price__value--special, lista en #old-price-*. */
  Chopo: {
    modo: 'catalogo',
    activo: true,
    urls: function () {
      return locs_(traer_('https://www.chopo.com.mx/sitemap.xml')).filter(function (u) {
        return /^https:\/\/www\.chopo\.com\.mx\/[a-z0-9-]+$/.test(u) && !/\/(default|estudios|catalog)$/.test(u);
      });
    },
    parse: function (html, url) {
      const ld = jsonLdProducto_(html);
      const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      const nombre = limpiarTexto_(sinTags_((ld && ld.name) || (h1 && h1[1]) || ''));
      const esp = aPrecio_(sinTags_((html.match(/price__value--special[^>]*>([\s\S]{0,120}?)<\/span>/i) || [])[1] || ''));
      const vieja = aPrecio_(sinTags_((html.match(/id="old-price-\d+"[^>]*>([\s\S]{0,80}?)<\/span>/i) || [])[1] || ''));
      const ldp = ld && ld.offers ? aPrecio_(ld.offers.lowPrice != null ? ld.offers.lowPrice : ld.offers.price) : null;
      const precio = esp || vieja || ldp;
      if (!nombre || !precio) return null;
      return { nombre: nombre, precio: precio, lista: vieja || precio, url: url };
    },
  },

  /**
   * Odoo eCommerce. En la ficha conviven tres precios:
   *   .oe_default_price2 (tachado) → lista · .oe_default_pric2 → en línea (el
   *   que usamos) · product.price_lapifan → membresía.
   */
  LAPI: {
    modo: 'catalogo',
    activo: true,
    urls: function () {
      return locs_(traer_('https://lapi.com.mx/sitemap.xml')).filter(function (u) {
        return /\/shop\/[^\/]+-\d+$/.test(u);
      });
    },
    parse: function (html, url) {
      const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      const nombre = limpiarTexto_(sinTags_(h1 ? h1[1] : ''));
      const grab = function (cls) {
        const re = new RegExp('class="[^"]*' + cls + '[^"]*"[^>]*>([\\s\\S]{0,220}?)</span>\\s*</span>', 'i');
        return aPrecio_(sinTags_((html.match(re) || [])[1] || ''));
      };
      const lista = grab('oe_default_price2');
      let precio = grab('oe_default_pric2');
      if (!precio) {
        const vals = [];
        const re = /oe_currency_value"?[^>]*>\s*([\d.,]+)\s*</gi;
        let m;
        while ((m = re.exec(html)) !== null) { const v = aPrecio_(m[1]); if (v) vals.push(v); }
        precio = vals.length > 1 ? vals[1] : (vals[0] || null);
      }
      if (!nombre || !precio) return null;
      return { nombre: nombre, precio: precio, lista: lista || precio, url: url };
    },
  },

  /**
   * OLAB — extractor genérico (sitemap → JSON-LD offers.price).
   *
   * ⚠️ SIN VERIFICAR. olab.com.mx/robots.txt bloquea por nombre a los crawlers
   * de IA (ClaudeBot, GPTBot, CCBot, Google-Extended…) mientras que
   * `User-agent: *` es `Allow: /`. Este bot se identifica como LabcomparaBot y
   * cae bajo `*`, así que puede correr — pero el selector no se pudo validar
   * desde el entorno donde se escribió el adaptador.
   *
   * La guardia de sanidad (CFG.MIN_CATALOGO) hace que, si el extractor no
   * encaja con la estructura real del sitio, la corrida se descarte y OLAB
   * conserve sus precios anteriores en vez de publicar basura.
   * Revisa la primera corrida en la hoja Scan_Log antes de confiar en la columna.
   */
  OLAB: {
    modo: 'catalogo',
    activo: true,
    verificado: false,
    urls: function () {
      let xml = traer_('https://olab.com.mx/sitemap.xml');
      let l = locs_(xml);
      if (/<sitemapindex/i.test(xml)) {
        const hijos = [];
        l.slice(0, 20).forEach(function (s) {
          try { hijos.push.apply(hijos, locs_(traer_(s))); } catch (e) {}
        });
        l = hijos;
      }
      return l.filter(function (u) { return /\/(estudios?|examenes?|pruebas?|perfil|producto)s?\//i.test(u); });
    },
    parse: function (html, url) {
      const ld = jsonLdProducto_(html);
      const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      const nombre = limpiarTexto_(sinTags_((ld && ld.name) || (h1 && h1[1]) || ''));
      let precio = ld && ld.offers ? aPrecio_(ld.offers.price != null ? ld.offers.price : ld.offers.lowPrice) : null;
      if (!precio) precio = aPrecio_((html.match(/\$\s?([\d,]+(?:\.\d{2})?)/) || [])[1]);
      if (!nombre || !precio) return null;
      return { nombre: nombre, precio: precio, lista: precio, url: url };
    },
  },
};

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ ENTRADAS PÚBLICAS                                                        ║
// ╚══════════════════════════════════════════════════════════════════════════╝

/** Crea hojas y programa el scan cada 7 días. Ejecutar una sola vez. */
function instalar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  hoja_(ss, CFG.HOJAS.precios, ['Estudio'].concat(LAB_IDS).concat(['Promedio', 'Más barato', 'Actualizado']));
  hoja_(ss, CFG.HOJAS.historico, ['Fecha', 'Estudio', 'Laboratorio', 'Precio anterior', 'Precio nuevo', 'Δ %']);
  hoja_(ss, CFG.HOJAS.catalogo, ['Estudio canónico', 'Alias (separados por |)']);
  hoja_(ss, CFG.HOJAS.log, ['Fecha', 'Laboratorio', 'Estado', 'Catálogo', 'Emparejados', 'Errores', 'Segundos', 'Detalle']);
  hoja_(ss, CFG.HOJAS.revisar, ['Fecha', 'Laboratorio', 'Nombre sin emparejar', 'Precio', 'URL']);
  hoja_(ss, CFG.HOJAS.cola, ['Lab', 'URL', 'Estado']);
  hoja_(ss, CFG.HOJAS.crudo, ['Lab', 'Nombre', 'Precio', 'Lista', 'URL']);

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'escanearTodo') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('escanearTodo').timeBased()
    .everyDays(CFG.DIAS_ENTRE_SCANS).atHour(3).create();

  Logger.log('Listo. Scan programado cada ' + CFG.DIAS_ENTRE_SCANS + ' días a las 3am.');
}

/**
 * Siembra la hoja "Precios" con el catálogo canónico publicado en el repo
 * (data/precios.json, generado por scripts/scan-labs.js).
 *
 * consolidar_() nunca inventa estudios: solo actualiza los que ya existen en la
 * hoja. Por eso hay que sembrar antes del primer scan. Ejecutar una vez después
 * de instalar(), o cada vez que se agreguen estudios al comparador.
 */
function sembrarCatalogo() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const feed = JSON.parse(traer_('https://labcompara.com/data/precios.json'));
  const h = hoja_(ss, CFG.HOJAS.precios, ['Estudio'].concat(LAB_IDS).concat(['Promedio', 'Más barato', 'Actualizado']));
  const existentes = leerPrecios_(h);

  const filas = feed.estudios
    .filter(function (e) { return !existentes[e.name]; })
    .map(function (e) {
      return [e.name].concat(LAB_IDS.map(function (l) { return e[l] || ''; }))
        .concat([e.avg || '', e.cheapest || '', new Date()]);
    });

  if (filas.length) h.getRange(h.getLastRow() + 1, 1, filas.length, filas[0].length).setValues(filas);
  CacheService.getScriptCache().remove('feed');
  Logger.log('Sembrados ' + filas.length + ' estudios nuevos (' + feed.estudios.length + ' en el feed).');
}

/** Dispara un scan completo ahora mismo (ignora el calendario). */
function escanearAhora() {
  PropertiesService.getScriptProperties().deleteProperty('ciclo');
  escanearTodo();
}

/**
 * Feed público que consume index.html.
 *   GET ?feed=precios  → { generado, labs, estudios:[...] }
 *   GET ?feed=estado   → última corrida por laboratorio
 */
function doGet(e) {
  const q = (e && e.parameter) || {};
  if (q.feed === 'estado') return json_(estadoUltimoScan_());
  return json_(feedPrecios_());
}

/**
 * Captura de formularios — idéntico a glpcompara-apps-script-v5.gs.
 * Se mantiene aquí para que Labcompara viva en un solo Apps Script.
 */
function doPost(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const d = JSON.parse(e.postData.contents);
    const tipo = d.tipo || 'lead';
    if (tipo === 'comparacion') {
      hoja_(ss, 'Comparaciones', ['Fecha', 'Nombre', 'Correo', 'Estudio', 'Origen'])
        .appendRow([new Date(), d.nombre || '', d.correo || '', d.estudio || d.medicamento || '', d.origen || '']);
    } else if (tipo === 'click') {
      hoja_(ss, 'Clicks', ['Fecha', 'Nombre', 'Correo', 'Laboratorio', 'Estudio', 'Precio', 'Origen'])
        .appendRow([new Date(), d.nombre || '', d.correo || '', d.laboratorio || d.farmacia || '', d.estudio || '', d.precio || '', d.origen || '']);
    } else if (tipo === 'suscripcion') {
      hoja_(ss, 'Suscripciones', ['Fecha', 'Nombre', 'Correo', 'Estudios', 'Origen'])
        .appendRow([new Date(), d.nombre || '', d.correo || '', d.estudios || '', d.origen || '']);
    } else {
      hoja_(ss, 'Leads', ['Fecha', 'Nombre', 'Correo', 'Codigo Postal', 'Origen'])
        .appendRow([new Date(), d.nombre || '', d.correo || '', d.cp || '', d.origen || '']);
    }
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ MOTOR DE SCAN (resumible)                                                ║
// ╚══════════════════════════════════════════════════════════════════════════╝

/**
 * Punto de entrada del trigger. Es idempotente y resumible:
 *   · si no hay ciclo abierto → lo abre (labs de API + encola los de catálogo)
 *   · procesa la cola por lotes hasta agotar el presupuesto de tiempo
 *   · si queda cola → se reprograma en 1 minuto
 *   · si la cola se vació → consolida, publica y cierra el ciclo
 */
function escanearTodo() {
  const t0 = Date.now();
  const props = PropertiesService.getScriptProperties();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) { Logger.log('Otro scan en curso; salgo.'); return; }

  try {
    limpiarTriggersDeContinuacion_();
    if (!props.getProperty('ciclo')) abrirCiclo_(props);

    const vacia = procesarCola_(t0);

    if (vacia) {
      consolidar_();
      props.deleteProperty('ciclo');
      Logger.log('Ciclo completo.');
    } else {
      programarContinuacion_();
      Logger.log('Presupuesto agotado; continúo en 1 minuto.');
    }
  } finally {
    lock.releaseLock();
  }
}

/** Corre los labs de API y encola las fichas de los labs de catálogo. */
function abrirCiclo_(props) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cola = hoja_(ss, CFG.HOJAS.cola, ['Lab', 'URL', 'Estado']);
  const crudo = hoja_(ss, CFG.HOJAS.crudo, ['Lab', 'Nombre', 'Precio', 'Lista', 'URL']);
  if (cola.getLastRow() > 1) cola.getRange(2, 1, cola.getLastRow() - 1, 3).clearContent();
  if (crudo.getLastRow() > 1) crudo.getRange(2, 1, crudo.getLastRow() - 1, 5).clearContent();

  const pendientes = [];
  LAB_IDS.forEach(function (id) {
    const lab = LABS[id];
    if (!lab || !lab.activo) return;
    const t = Date.now();
    try {
      if (lab.modo === 'api') {
        const filas = lab.scan();
        guardarCrudo_(crudo, id, filas);
        log_(id, 'ok', filas.length, '', 0, (Date.now() - t) / 1000, 'API');
      } else {
        const urls = lab.urls();
        urls.forEach(function (u) { pendientes.push([id, u, 'pendiente']); });
        log_(id, 'encolado', urls.length, '', 0, (Date.now() - t) / 1000, 'sitemap');
      }
    } catch (err) {
      log_(id, 'error', '', '', '', (Date.now() - t) / 1000, String(err));
    }
  });

  if (pendientes.length) cola.getRange(2, 1, pendientes.length, 3).setValues(pendientes);
  props.setProperty('ciclo', String(Date.now()));
  Logger.log('Ciclo abierto: ' + pendientes.length + ' fichas encoladas.');
}

/** Procesa lotes de la cola hasta agotar tiempo. Devuelve true si quedó vacía. */
function procesarCola_(t0) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cola = hoja_(ss, CFG.HOJAS.cola, ['Lab', 'URL', 'Estado']);
  const crudo = hoja_(ss, CFG.HOJAS.crudo, ['Lab', 'Nombre', 'Precio', 'Lista', 'URL']);
  const n = cola.getLastRow() - 1;
  if (n <= 0) return true;

  const datos = cola.getRange(2, 1, n, 3).getValues();
  let cursor = 0;

  while (cursor < n) {
    if (Date.now() - t0 > CFG.LIMITE_MS) return false;

    const lote = [];
    while (lote.length < CFG.LOTE && cursor < n) {
      if (datos[cursor][2] === 'pendiente') lote.push({ fila: cursor + 2, lab: datos[cursor][0], url: datos[cursor][1] });
      cursor++;
    }
    if (!lote.length) continue;

    const reqs = lote.map(function (x) {
      return { url: x.url, muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': CFG.UA } };
    });
    let resps;
    try { resps = UrlFetchApp.fetchAll(reqs); }
    catch (err) { resps = []; }

    const filas = [];
    lote.forEach(function (x, i) {
      const r = resps[i];
      let estado = 'error';
      if (r && r.getResponseCode() === 200) {
        try {
          const parsed = LABS[x.lab].parse(r.getContentText(), x.url);
          if (parsed) { filas.push([x.lab, parsed.nombre, parsed.precio, parsed.lista, parsed.url]); estado = 'ok'; }
          else estado = 'sin-precio';
        } catch (e) { estado = 'error'; }
      }
      cola.getRange(x.fila, 3).setValue(estado);
    });
    if (filas.length) crudo.getRange(crudo.getLastRow() + 1, 1, filas.length, 5).setValues(filas);
    SpreadsheetApp.flush();
  }
  return true;
}

/** Empareja lo crudo contra el catálogo, publica Precios y registra el histórico. */
function consolidar_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const crudo = hoja_(ss, CFG.HOJAS.crudo, ['Lab', 'Nombre', 'Precio', 'Lista', 'URL']);
  const precios = hoja_(ss, CFG.HOJAS.precios, ['Estudio'].concat(LAB_IDS).concat(['Promedio', 'Más barato', 'Actualizado']));

  const anterior = leerPrecios_(precios);            // estudio → { lab: precio }
  const canonicos = Object.keys(anterior);
  if (!canonicos.length) { Logger.log('Hoja Precios vacía: siembra el catálogo primero.'); return; }

  // agrupar crudo por laboratorio
  const porLab = {};
  const n = crudo.getLastRow() - 1;
  if (n > 0) {
    crudo.getRange(2, 1, n, 5).getValues().forEach(function (r) {
      if (!r[0]) return;
      (porLab[r[0]] = porLab[r[0]] || []).push({ nombre: r[1], precio: Number(r[2]) || null, url: r[4] });
    });
  }

  const alias = leerAlias_(ss);
  const nuevo = {};
  const cambios = [];
  const sinMatch = [];
  const hoy = new Date();

  canonicos.forEach(function (c) { nuevo[c] = {}; });

  LAB_IDS.forEach(function (id) {
    const filas = porLab[id] || [];
    const previos = contarLab_(anterior, id);

    // Guardia de sanidad: un scan raquítico no debe borrar la columna.
    if (!filas.length || (previos > 0 && filas.length < previos * CFG.MIN_CATALOGO)) {
      canonicos.forEach(function (c) { nuevo[c][id] = anterior[c][id]; });
      log_(id, filas.length ? 'descartado' : 'sin-datos', filas.length, '', '', '',
        'Se conservan los precios previos (guardia de sanidad).');
      return;
    }

    const res = emparejar_(canonicos, filas, alias);
    let arrastrados = 0;
    canonicos.forEach(function (c) {
      const hit = res.mapeo[c];
      const antes = anterior[c][id];
      // Sin match no se concluye que el estudio dejó de existir: lo más probable
      // es que el laboratorio lo nombre distinto. Se conserva el precio anterior
      // en vez de dejar el hueco en el comparador.
      if (!hit) {
        nuevo[c][id] = antes;
        if (antes) arrastrados++;
        return;
      }
      const ahora = hit.precio;
      nuevo[c][id] = ahora;
      if (antes !== ahora && (antes || ahora)) {
        cambios.push([hoy, c, id, antes || '', ahora || '',
          (antes && ahora) ? Math.round(((ahora - antes) / antes) * 1000) / 10 : '']);
      }
    });
    res.sinMatch.slice(0, 200).forEach(function (f) { sinMatch.push([hoy, id, f.nombre, f.precio, f.url]); });
    log_(id, 'ok', filas.length, Object.keys(res.mapeo).length, '', '',
      'consolidado · ' + arrastrados + ' precios arrastrados sin confirmar');
  });

  // escribir matriz
  const salida = canonicos.map(function (c) {
    const vals = LAB_IDS.map(function (l) { return nuevo[c][l] || null; });
    const con = vals.filter(function (v) { return v > 0; });
    const avg = con.length ? Math.round(con.reduce(function (a, b) { return a + b; }, 0) / con.length) : '';
    let barato = '', min = Infinity;
    LAB_IDS.forEach(function (l, i) { if (vals[i] && vals[i] < min) { min = vals[i]; barato = l; } });
    return [c].concat(vals.map(function (v) { return v || ''; })).concat([avg, barato, hoy]);
  });
  if (precios.getLastRow() > 1) precios.getRange(2, 1, precios.getLastRow() - 1, precios.getLastColumn()).clearContent();
  if (salida.length) precios.getRange(2, 1, salida.length, salida[0].length).setValues(salida);

  if (cambios.length) {
    const h = hoja_(ss, CFG.HOJAS.historico, ['Fecha', 'Estudio', 'Laboratorio', 'Precio anterior', 'Precio nuevo', 'Δ %']);
    h.getRange(h.getLastRow() + 1, 1, cambios.length, 6).setValues(cambios);
  }

  // Un salto de más de 3x casi nunca es una promoción: suele ser un
  // emparejamiento equivocado o un selector que cambió. Se registra aparte para
  // que salte a la vista en el log en vez de perderse entre cientos de cambios.
  const sospechosos = cambios.filter(function (c) {
    const a = Number(c[3]), b = Number(c[4]);
    return a && b && (b / a > 3 || b / a < 1 / 3);
  });
  if (sospechosos.length) {
    log_('—', 'alerta', '', '', '', '',
      sospechosos.length + ' cambios >3x: ' +
      sospechosos.slice(0, 8).map(function (c) { return c[1] + ' (' + c[2] + ') ' + c[3] + '→' + c[4]; }).join(' · '));
  }
  if (sinMatch.length) {
    const h = hoja_(ss, CFG.HOJAS.revisar, ['Fecha', 'Laboratorio', 'Nombre sin emparejar', 'Precio', 'URL']);
    h.getRange(h.getLastRow() + 1, 1, sinMatch.length, 5).setValues(sinMatch);
  }
  CacheService.getScriptCache().remove('feed');
  Logger.log('Consolidado: ' + cambios.length + ' cambios de precio.');
}

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ EMPAREJAMIENTO DE NOMBRES                                                ║
// ║ Espejo de scripts/lib/match.js                                           ║
// ╚══════════════════════════════════════════════════════════════════════════╝

/**
 * Palabras sin valor identitario. "en suero" / "en sangre" / "sérico" es la
 * matriz por defecto del nombrado mexicano: Chopo la escribe siempre y los
 * demás casi nunca, así que como señal es ruido puro.
 */
const STOPWORDS = ('de del la el los las en y o con sin para por a al un una estudio examen ' +
  'prueba determinacion cuantificacion analisis test ' +
  'suero sangre plasma serico serica sericos sericas sanguineo').split(' ');

/**
 * Calificadores: si aparecen en UN solo lado, son estudios distintos aunque el
 * resto del nombre coincida. "TSH" ≠ "TSH Neonatal"; "Calcio" ≠ "Calcio en
 * orina"; "Proteína C Reactiva" ≠ "…de alta sensibilidad".
 */
const CALIFICADORES = ('neonatal pediatrico infantil materno gestacional prenupcial deportivo sexual ' +
  'femenino masculino ultra ultrasensible sensible sensibilidad hs cualitativo cuantitativo ' +
  'dilucion extra inmunologico inmunologica automatizado confirmatorio reflejo ' +
  'libre total fraccionado directo indirecto ionizado hdl ldl vldl sulfato depuracion isoenzimas ' +
  'perfil vespertino matutino anaerobio aerobio ' +
  'basico completo especial ampliado express plus premium avanzado ' +
  'postprandial ayuno curva horas hrs pre post ' +
  'orina urinario urinaria urinarias heces saliva capilar lcr liquido').split(' ');

const MARCAS_PANEL = ['perfil', 'checkup', 'check', 'paquete', 'panel'];
const ROMANOS = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 };

const SINONIMOS = [
  [/\bbh\b/g, 'biometria hematica'],
  [/\bego\b/g, 'examen general de orina'],
  [/\bqs\b/g, 'quimica sanguinea'],
  [/\bquimica\b(?!\s+sanguinea)/g, 'quimica sanguinea'],
  [/\bhba1c\b|\bhb a1c\b|\ba1c\b/g, 'hemoglobina glucosilada'],
  [/\bglicosilada\b/g, 'glucosilada'],
  [/\belementos?\b/g, 'elementos'],
  [/\bel\.?\b(?=\s*\d)/g, 'elementos'],
  [/\blipidos?\b|\blipidico\b|\blipoideo\b/g, 'lipidos'],
  [/\btiroide[os]?\b/g, 'tiroideo'],
  [/\bvsg\b/g, 'velocidad de sedimentacion'],
  // OJO: NO se expande "pcr" → "proteína C reactiva". En el nombrado mexicano
  // PCR es casi siempre la técnica ("Poliomavirus BK POR PCR", "Citomegalovirus
  // por PCR-RT"), no la proteína. Expandirlo emparejaba estudios moleculares
  // caros con un reactante de fase aguda. El caso legítimo se cubre por alias.
  [/\bac\.?\b/g, 'anticuerpos'],
  [/\banti\s+/g, 'anti'],
];

function limpiar_(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function clave_(s) {
  let t = limpiar_(s);
  SINONIMOS.forEach(function (p) { t = t.replace(p[0], p[1]); });
  return t.split(' ').filter(function (w) { return w && STOPWORDS.indexOf(w) === -1; }).sort().join(' ');
}

/** Se conservan los tokens de un carácter: distinguen "Vitamina D" de "Vitamina A". */
function tokens_(s) {
  let t = limpiar_(s);
  SINONIMOS.forEach(function (p) { t = t.replace(p[0], p[1]); });
  const out = [];
  t.split(' ').forEach(function (w) {
    if (w && STOPWORDS.indexOf(w) === -1 && out.indexOf(w) === -1) out.push(w);
  });
  return out;
}

/**
 * Marcadores duros: números, romanos, letras sueltas y letra+número deben
 * coincidir exactamente. "Química (6)" ≠ "Química (27)"; "Perfil Tiroideo" ≠
 * "Perfil Tiroideo II"; "Vitamina B12" ≠ "Vitamina A".
 */
function marcadores_(toks) {
  return toks.filter(function (t) {
    return /^\d+$/.test(t) || ROMANOS[t] !== undefined || /^[a-z]$/.test(t) || /^[a-z]\d+$/.test(t);
  }).map(function (t) {
    return ROMANOS[t] !== undefined ? 'r' + ROMANOS[t] : t;
  }).sort().join(',');
}

function calificadores_(toks) {
  return toks.filter(function (t) { return CALIFICADORES.indexOf(t) > -1; }).sort().join(',');
}

function marcaPanel_(toks) {
  return MARCAS_PANEL.some(function (m) { return toks.indexOf(m) > -1; });
}

/**
 * Similitud 0..1. Pesa más la contención que el solapamiento —"CA-125" dentro
 * de "ANTIGENO CA 125 --OVARIO--" es un match legítimo— pero con guardas duras
 * que devuelven 0 para evitar falsos positivos caros.
 */
function similitudCruda_(A, B) {
  if (!A.length || !B.length) return 0;
  if (marcadores_(A) !== marcadores_(B)) return 0;
  if (calificadores_(A) !== calificadores_(B)) return 0;

  let inter = 0;
  A.forEach(function (t) { if (B.indexOf(t) > -1) inter++; });
  if (!inter) return 0;

  const menor = Math.min(A.length, B.length);
  // Un nombre de un token no alcanza para inferir: "TGO" está contenido en
  // "TGO y TGP" y no son el mismo estudio.
  if (menor === 1 && A.length !== B.length) return 0;

  // Un estudio suelto nunca es su paquete, y viceversa.
  const panelA = marcaPanel_(A), panelB = marcaPanel_(B);
  if (panelA !== panelB) return 0;

  const jaccard = inter / (A.length + B.length - inter);
  // Entre paneles se exige parecido simétrico: "Perfil Básico" está contenido
  // en "Perfil básico vías urinarias" y no son el mismo paquete.
  if (panelA) return jaccard;

  return 0.35 * jaccard + 0.65 * (inter / menor);
}

/** Los paréntesis del nombre canónico aclaran, no identifican: se prueba con y sin. */
function similitud_(a, b) {
  const B = tokens_(b);
  let mejor = similitudCruda_(tokens_(a), B);
  const sinParentesis = String(a).replace(/\([^)]*\)/g, ' ').trim();
  if (sinParentesis && sinParentesis !== String(a).trim()) {
    mejor = Math.max(mejor, similitudCruda_(tokens_(sinParentesis), B));
  }
  return mejor;
}

function emparejar_(canonicos, filas, alias) {
  const porClave = {};
  canonicos.forEach(function (c) { porClave[clave_(c)] = c; });

  const mapeo = {}, sinMatch = [];
  const registrar = function (canon, fila) {
    if (!mapeo[canon] || fila.precio < mapeo[canon].precio) mapeo[canon] = fila;
  };

  filas.forEach(function (fila) {
    if (!fila.nombre || !fila.precio) return;
    const k = clave_(fila.nombre);
    if (porClave[k]) return registrar(porClave[k], fila);
    if (alias[k]) return registrar(alias[k], fila);

    let mejor = null, score = 0;
    canonicos.forEach(function (c) {
      const s = similitud_(c, fila.nombre);
      if (s > score) { score = s; mejor = c; }
    });
    if (mejor && score >= CFG.UMBRAL_MATCH) registrar(mejor, fila);
    else sinMatch.push(fila);
  });
  return { mapeo: mapeo, sinMatch: sinMatch };
}

/** Lee la hoja Catalogo: "Estudio canónico" + "alias|alias|alias". */
function leerAlias_(ss) {
  const h = hoja_(ss, CFG.HOJAS.catalogo, ['Estudio canónico', 'Alias (separados por |)']);
  const idx = {};
  const n = h.getLastRow() - 1;
  if (n <= 0) return idx;
  h.getRange(2, 1, n, 2).getValues().forEach(function (r) {
    if (!r[0]) return;
    idx[clave_(r[0])] = r[0];
    String(r[1] || '').split('|').forEach(function (a) { if (a.trim()) idx[clave_(a)] = r[0]; });
  });
  return idx;
}

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ FEED JSON                                                                ║
// ╚══════════════════════════════════════════════════════════════════════════╝

function feedPrecios_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('feed');
  if (hit) return JSON.parse(hit);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const h = hoja_(ss, CFG.HOJAS.precios, ['Estudio'].concat(LAB_IDS).concat(['Promedio', 'Más barato', 'Actualizado']));
  const n = h.getLastRow() - 1;
  const estudios = [];
  let actualizado = null;

  if (n > 0) {
    h.getRange(2, 1, n, LAB_IDS.length + 4).getValues().forEach(function (r) {
      if (!r[0]) return;
      const e = { name: r[0] };
      LAB_IDS.forEach(function (l, i) { e[l] = Number(r[i + 1]) || null; });
      e.avg = Number(r[LAB_IDS.length + 1]) || null;
      e.cheapest = r[LAB_IDS.length + 2] || null;
      estudios.push(e);
      const f = r[LAB_IDS.length + 3];
      if (f instanceof Date && (!actualizado || f > actualizado)) actualizado = f;
    });
  }
  const feed = {
    generado: (actualizado || new Date()).toISOString(),
    labs: LAB_IDS,
    total: estudios.length,
    estudios: estudios,
  };
  cache.put('feed', JSON.stringify(feed), 3600);
  return feed;
}

function estadoUltimoScan_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const h = hoja_(ss, CFG.HOJAS.log, ['Fecha', 'Laboratorio', 'Estado', 'Catálogo', 'Emparejados', 'Errores', 'Segundos', 'Detalle']);
  const n = Math.min(h.getLastRow() - 1, 40);
  if (n <= 0) return { corridas: [] };
  const filas = h.getRange(h.getLastRow() - n + 1, 1, n, 8).getValues();
  return {
    corridas: filas.map(function (r) {
      return { fecha: r[0], lab: r[1], estado: r[2], catalogo: r[3], emparejados: r[4], detalle: r[7] };
    }),
  };
}

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ UTILIDADES                                                               ║
// ╚══════════════════════════════════════════════════════════════════════════╝

function hoja_(ss, nombre, headers) {
  let s = ss.getSheetByName(nombre);
  if (!s) s = ss.insertSheet(nombre);
  if (s.getLastRow() === 0 && headers) {
    s.appendRow(headers);
    s.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    s.setFrozenRows(1);
  }
  return s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function traer_(url) {
  const r = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': CFG.UA },
  });
  if (r.getResponseCode() !== 200) throw new Error('HTTP ' + r.getResponseCode() + ' en ' + url);
  return r.getContentText();
}

function guardarCrudo_(hojaCrudo, lab, filas) {
  if (!filas.length) return;
  const vals = filas.map(function (f) { return [lab, f.nombre, f.precio, f.lista, f.url]; });
  hojaCrudo.getRange(hojaCrudo.getLastRow() + 1, 1, vals.length, 5).setValues(vals);
}

function leerPrecios_(h) {
  const out = {};
  const n = h.getLastRow() - 1;
  if (n <= 0) return out;
  h.getRange(2, 1, n, LAB_IDS.length + 1).getValues().forEach(function (r) {
    if (!r[0]) return;
    const e = {};
    LAB_IDS.forEach(function (l, i) { e[l] = Number(r[i + 1]) || null; });
    out[r[0]] = e;
  });
  return out;
}

function contarLab_(anterior, id) {
  let n = 0;
  Object.keys(anterior).forEach(function (c) { if (anterior[c][id]) n++; });
  return n;
}

function log_(lab, estado, catalogo, emparejados, errores, seg, detalle) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  hoja_(ss, CFG.HOJAS.log, ['Fecha', 'Laboratorio', 'Estado', 'Catálogo', 'Emparejados', 'Errores', 'Segundos', 'Detalle'])
    .appendRow([new Date(), lab, estado, catalogo, emparejados, errores, seg, detalle]);
}

/**
 * Los triggers `after(N)` son de un solo uso pero NO se autoeliminan: se quedan
 * ocupando lugar hasta el tope de 20 por proyecto. La API no distingue un
 * `after` de un `everyDays`, así que guardamos el id del que creamos en
 * Script Properties y lo borramos por id al arrancar la siguiente ejecución.
 */
function limpiarTriggersDeContinuacion_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('triggerContinuacion');
  if (!id) return;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getUniqueId() === id) ScriptApp.deleteTrigger(t);
  });
  props.deleteProperty('triggerContinuacion');
}

/** Reprograma la continuación en 1 minuto y recuerda su id para poder borrarlo. */
function programarContinuacion_() {
  const t = ScriptApp.newTrigger('escanearTodo').timeBased().after(60 * 1000).create();
  PropertiesService.getScriptProperties().setProperty('triggerContinuacion', t.getUniqueId());
}

function sinTags_(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function limpiarTexto_(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/gi, "'").replace(/&nbsp;/g, ' ')
    .replace(/&aacute;/gi, 'á').replace(/&eacute;/gi, 'é').replace(/&iacute;/gi, 'í')
    .replace(/&oacute;/gi, 'ó').replace(/&uacute;/gi, 'ú').replace(/&ntilde;/gi, 'ñ')
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCodePoint(Number(d)); })
    .replace(/\s+/g, ' ').trim();
}

/** "$1,234.50" → 1234.5 · null si no hay número usable. */
function aPrecio_(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).replace(/[^\d.,]/g, '');
  if (!s) return null;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lc > -1) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  const n = parseFloat(s);
  if (!isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function locs_(xml) {
  const out = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/g;
  let m;
  while ((m = re.exec(xml)) !== null) out.push(limpiarTexto_(m[1]));
  return out;
}

function jsonLdProducto_(html) {
  const re = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let d;
    try { d = JSON.parse(m[1]); } catch (e) { continue; }
    const nodos = [];
    const visitar = function (nodo) {
      if (!nodo || typeof nodo !== 'object') return;
      if (Object.prototype.toString.call(nodo) === '[object Array]') return nodo.forEach(visitar);
      if (nodo['@graph']) nodo['@graph'].forEach(visitar);
      const t = nodo['@type'];
      if (t === 'Product' || (t && t.indexOf && t.indexOf('Product') > -1)) nodos.push(nodo);
    };
    visitar(d);
    if (nodos.length) return nodos[0];
  }
  return null;
}
