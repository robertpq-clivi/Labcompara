/**
 * Medcompara — Adaptadores de laboratorio
 * ----------------------------------------
 * Cada adaptador expone { id, nombre, modo, scan(ctx) } y devuelve una lista de:
 *   { nombre, precio, precioLista, url, sku }
 *
 * `modo` documenta de dónde sale el precio:
 *   'api'     → una o dos llamadas a un endpoint JSON público (rápido, robusto)
 *   'catalogo'→ sitemap + fetch por estudio (lento, ~1k-1.7k requests)
 *
 * Los adaptadores NO hacen fetch directo: reciben `ctx.get(url)` y `ctx.getJSON(url)`
 * para que el runner controle concurrencia, reintentos y User-Agent. El mismo
 * contrato lo reimplementa scripts/medcompara-apps-script.gs sobre UrlFetchApp.
 */

'use strict';

const { toPrice, stripTags, decodeEntities, locsFrom, jsonLd, ldNodes } = require('../lib/precio');

// ── adaptadores ──────────────────────────────────────────────────────────────

/**
 * Salud Digna — API pública de la app de citas.
 * Un solo request devuelve el catálogo completo de LABORATORIO con precio.
 * idEstudio=2 → LABORATORIO. sucursal[id]=1 → sucursal de referencia.
 */
const saludDigna = {
  id: 'Salud Digna',
  modo: 'api',
  fuente: 'api.emarketingsd.org',
  sucursalRef: 1,
  async scan(ctx) {
    const url =
      'https://api.emarketingsd.org/Citas/Citas2/SubEstudiosPorSucursalPP' +
      `?estudio%5Bid%5D=2&sucursal%5Bid%5D=${this.sucursalRef}&filtro=1&busqueda=`;
    const rows = await ctx.getJSON(url);
    if (!Array.isArray(rows)) throw new Error('respuesta inesperada de Salud Digna');
    return rows
      .map((r) => ({
        nombre: stripTags(r.Descripcion || ''),
        precio: toPrice(r.Precio),
        precioLista: toPrice(r.PrecioOriginal) ?? toPrice(r.Precio),
        sku: String(r.Id ?? ''),
        url: 'https://www.salud-digna.org/precios-preparaciones/estudios',
      }))
      .filter((r) => r.nombre && r.precio);
  },
};

/**
 * Laboratorio Médico Polanco — tienda BigCommerce + API de precios de SYNLAB.
 * Los precios NO están en el HTML (dependen de sucursal); vienen de
 * /v2/products/get-partner-price-info?locationCode=NNN, que devuelve
 * { onlineDiscountPercent, prices: { SKU: { originalPrice, loyaltyPrice } } }.
 * Cruzamos SKU→nombre con el catálogo paginado de BigCommerce.
 */
const polanco = {
  id: 'Polanco',
  modo: 'api',
  fuente: 'booking.global.synlabaccess.health',
  locationCode: '670', // Acoxpa, CDMX — sucursal de referencia
  async scan(ctx) {
    const info = await ctx.getJSON(
      'https://booking.global.synlabaccess.health/api/booking/v2/products/get-partner-price-info' +
        `?locationCode=${this.locationCode}`
    );
    const prices = (info && info.prices) || {};
    const dto = Number(info && info.onlineDiscountPercent) || 0;
    const aplicaATodos = !!(info && info.onlineDiscountForAllProducts);
    const conDescuento = new Set((info && info.productCodesWithOnlineDiscount) || []);

    // SKU → nombre desde el catálogo público (100 por página).
    const nombres = new Map();
    for (let page = 1; page <= 25; page++) {
      // BigCommerce responde 404 al pasarse de la última página: es la señal de fin.
      let html;
      try { html = await ctx.get(`https://lmpolanco.com/todos/?limit=100&page=${page}`); }
      catch { break; }
      const re = /\\"sku\\":\\"([^"\\]*)\\",\\"name\\":\\"((?:[^"\\]|\\.)*?)\\"/g;
      let m, n = 0;
      while ((m = re.exec(html))) {
        n++;
        const sku = m[1].trim();
        if (sku && !nombres.has(sku)) nombres.set(sku, stripTags(m[2].replace(/\\(.)/g, '$1')));
      }
      if (n === 0) break;
    }

    const out = [];
    for (const [sku, p] of Object.entries(prices)) {
      const lista = toPrice(p && p.originalPrice);
      if (!lista) continue;
      const online = aplicaATodos || conDescuento.has(sku)
        ? Math.round(lista * (1 - dto / 100) * 100) / 100
        : lista;
      out.push({
        nombre: nombres.get(sku) || sku,
        precio: online,
        precioLista: lista,
        sku,
        url: 'https://lmpolanco.com/',
      });
    }
    return out;
  },
};

/**
 * Labbe — sitio propio, precio en el HTML de cada estudio (div .precio_gral).
 */
const labbe = {
  id: 'Labbe',
  modo: 'catalogo',
  fuente: 'www.labbe.mx',
  async urls(ctx) {
    const xml = await ctx.get('https://www.labbe.mx/sitemap.xml');
    return locsFrom(xml).filter((u) => /\/estudios\/[^/]+$/.test(u));
  },
  parse(html, url) {
    const m = html.match(/class="[^"]*precio_gral[^"]*"[^>]*>([\s\S]{0,200}?)<\/div>/i);
    const precio = m ? toPrice(stripTags(m[1])) : null;
    // El <h1> y el <h3 class="titulo_covid"> del template siempre dicen
    // "LABORATORIO". El nombre real del estudio está en og:title y, como
    // respaldo, en .subtitulo_covid / <title>.
    const og = html.match(/property="og:title"[^>]*content="([^"]*)"/i);
    const sub = html.match(/class="[^"]*subtitulo_covid[^"]*"[^>]*>([\s\S]{0,160}?)<\/div>/i);
    const title = html.match(/<title>([^<]*)</i);
    const nombre = stripTags((og && og[1]) || (sub && sub[1]) || (title ? title[1].split('|')[0] : ''));
    if (!nombre || !precio) return null;
    return { nombre, precio, precioLista: precio, sku: '', url };
  },
};

/**
 * Chopo — Magento 2. Precio de lista en #old-price-*, precio en línea en
 * .price__value--special. Nombre desde el JSON-LD (@type Product).
 */
const chopo = {
  id: 'Chopo',
  modo: 'catalogo',
  fuente: 'www.chopo.com.mx',
  async urls(ctx) {
    const xml = await ctx.get('https://www.chopo.com.mx/sitemap.xml');
    return locsFrom(xml).filter(
      (u) => /^https:\/\/www\.chopo\.com\.mx\/[a-z0-9-]+$/.test(u) && !/\/(default|estudios|catalog)$/.test(u)
    );
  },
  parse(html, url) {
    const prod = ldNodes(jsonLd(html), 'Product')[0];
    const nombre = stripTags((prod && prod.name) || (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '');
    const especial = toPrice((html.match(/price__value--special[^>]*>([\s\S]{0,120}?)<\/span>/i) || [])[1]);
    const vieja = toPrice((html.match(/id="old-price-\d+"[^>]*>([\s\S]{0,80}?)<\/span>/i) || [])[1]);
    const ld = prod && prod.offers ? toPrice(prod.offers.lowPrice ?? prod.offers.price) : null;
    const precio = especial ?? vieja ?? ld;
    if (!nombre || !precio) return null;
    return { nombre, precio, precioLista: vieja ?? precio, sku: '', url };
  },
};

/**
 * LAPI — Odoo eCommerce. En la ficha conviven 3 precios:
 *   .oe_default_price2 (tachado)  → precio de lista
 *   .oe_default_pric2             → precio en línea  ← el que usamos
 *   product.price_lapifan         → precio LapiFan (membresía)
 */
const lapi = {
  id: 'LAPI',
  modo: 'catalogo',
  fuente: 'lapi.com.mx',
  async urls(ctx) {
    const xml = await ctx.get('https://lapi.com.mx/sitemap.xml');
    return locsFrom(xml).filter((u) => /\/shop\/[^/]+-\d+$/.test(u));
  },
  parse(html, url) {
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const nombre = stripTags(h1 ? h1[1] : '');
    const grab = (cls) => {
      const re = new RegExp(`class="[^"]*${cls}[^"]*"[^>]*>([\\s\\S]{0,220}?)</span>\\s*</span>`, 'i');
      return toPrice(stripTags((html.match(re) || [])[1] || ''));
    };
    const lista = grab('oe_default_price2');
    let precio = grab('oe_default_pric2');
    if (!precio) {
      // Fallback: primer oe_currency_value que no sea el tachado.
      const vals = [...html.matchAll(/oe_currency_value"?[^>]*>\s*([\d.,]+)\s*</gi)].map((m) => toPrice(m[1]));
      const limpios = vals.filter(Boolean);
      precio = limpios.length > 1 ? limpios[1] : limpios[0] ?? null;
    }
    if (!nombre || !precio) return null;
    return { nombre, precio, precioLista: lista ?? precio, sku: '', url };
  },
};

/**
 * OLAB — Nuxt. El home no expone el catálogo con precios, así que el adaptador
 * usa una estrategia genérica: sitemap → fichas → JSON-LD offers.price, con
 * respaldo a patrones de precio comunes.
 *
 * olab.com.mx/robots.txt bloquea por nombre a los crawlers de IA (ClaudeBot,
 * GPTBot, CCBot, …) pero deja `User-agent: * → Allow: /`. MedcomparaBot cae
 * bajo `*`, y la corrida del 13/08/2026 desde GitHub Actions lo confirmó:
 * 6,043 fichas en el sitemap, 2,077 con precio, sin necesidad de proxy.
 *
 * Contrastados contra los 43 precios de OLAB que estaban capturados a mano,
 * 42 quedaron dentro de ±2x con deriva al alza consistente (×1.0–1.24), que es
 * justo lo que se espera de precios de hace meses. El extractor lee el campo
 * correcto.
 *
 * Sin `proxy: true` a propósito: responde directo, y forzar Zyte gastaría
 * ~9,000 requests de crédito por corrida. Si algún día empieza a bloquear, la
 * escalada automática de lib/http.js lo cubre sola.
 */
const olab = {
  id: 'OLAB',
  modo: 'catalogo',
  fuente: 'olab.com.mx',
  async urls(ctx) {
    const xml = await ctx.get('https://olab.com.mx/sitemap.xml');
    let locs = locsFrom(xml);
    // sitemapindex → resolver hijos
    if (/<sitemapindex/i.test(xml)) {
      const hijos = [];
      for (const s of locs.slice(0, 20)) hijos.push(...locsFrom(await ctx.get(s)));
      locs = hijos;
    }
    return locs.filter((u) => /\/(estudios?|examenes?|pruebas?|perfil|producto)s?\//i.test(u));
  },
  parse(html, url) {
    const prod = ldNodes(jsonLd(html), 'Product')[0];
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const nombre = stripTags((prod && prod.name) || (h1 ? h1[1] : ''));
    let precio = prod && prod.offers ? toPrice(prod.offers.price ?? prod.offers.lowPrice) : null;
    if (!precio) precio = toPrice((html.match(/\$\s?([\d,]+(?:\.\d{2})?)/) || [])[1]);
    if (!nombre || !precio) return null;
    return { nombre, precio, precioLista: precio, sku: '', url };
  },
};

const LABS = [saludDigna, polanco, labbe, chopo, lapi, olab];

module.exports = {
  id: 'laboratorio',
  nombre: 'Estudios de laboratorio',
  columnas: ['Labbe', 'Polanco', 'Chopo', 'Salud Digna', 'LAPI', 'OLAB'],
  LABS, saludDigna, polanco, labbe, chopo, lapi, olab,
};
