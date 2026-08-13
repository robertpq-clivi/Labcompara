/**
 * Labcompara — Adaptadores de farmacia (vertical GLP-1)
 * ------------------------------------------------------
 * Portado de scraper/scrape.py de GLPcompara para que las dos verticales
 * compartan transporte (lib/http.js con Zyte), parseo de precios, historial y
 * un solo workflow semanal. La lógica de extracción es la misma, verificada
 * contra la que llevaba meses corriendo en producción.
 *
 * Diferencia de fondo con la vertical de laboratorio: ahí el problema es
 * *descubrir* qué estudio es cada nombre entre miles. Aquí el catálogo es
 * cerrado —16 presentaciones de 4 familias— y el problema es escoger la dosis
 * correcta dentro de los resultados de búsqueda de una familia. Por eso el
 * emparejamiento va por tokens declarados (match_all / match_any / exclude) y
 * no por similitud difusa: con "Ozempic 0.25/0.5 mg" vs "Ozempic 1 mg" un
 * error de un carácter es un error de miles de pesos.
 */

'use strict';

const path = require('path');
const { toPrice, stripTags, jsonLd, ldNodes } = require('../lib/precio');

const CATALOGO = require('./farmacias-catalogo.json');
const CLIVI = require('./farmacias-clivi.json');
const OVERRIDES = require('./farmacias-overrides.json');

/** Orden de columnas del comparador. */
const FARMACIA_IDS = ['Clivi', 'Ahorro', 'Benavides', 'Guadalajara', 'SanPablo', 'Revert'];

const URL_FARMACIA = {
  Clivi: 'https://www.clivi.com.mx/',
  Ahorro: 'https://www.fahorro.com/',
  Guadalajara: 'https://www.farmaciasguadalajara.com/',
  Benavides: 'https://www.benavides.com.mx/',
  SanPablo: 'https://www.farmaciasanpablo.com.mx/',
  Revert: 'https://revert.com.mx/perdida-de-peso/',
};

// ── adaptadores ──────────────────────────────────────────────────────────────

/**
 * Benavides — Magento con catalogsearch renderizado en servidor.
 * Su robots.txt permite /catalogsearch.
 */
const benavides = {
  id: 'Benavides',
  fuente: 'www.benavides.com.mx',
  async buscar(ctx, query) {
    const html = await ctx.get(`https://www.benavides.com.mx/catalogsearch/result/?q=${encodeURIComponent(query)}`);
    const out = [];
    const items = html.split(/<li[^>]+class="[^"]*product-item/i).slice(1);
    for (const item of items) {
      const a = item.match(/<a[^>]+class="[^"]*product-item-link[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]{0,200}?)<\/a>/i);
      if (!a) continue;
      const titulo = stripTags(a[2]);
      const attr = item.match(/data-price-amount="([\d.]+)"/i);
      const span = item.match(/class="[^"]*price[^"]*"[^>]*>([\s\S]{0,80}?)</i);
      const precio = attr ? toPrice(attr[1]) : toPrice(stripTags((span || [])[1] || ''));
      if (titulo && precio) out.push({ titulo, precio: Math.round(precio), url: a[1] });
    }
    return out;
  },
};

/**
 * Farmacias del Ahorro — Magento con GraphQL abierto.
 * Se usa POST (sin query string) porque su robots.txt prohíbe `?q=` a los bots
 * genéricos, y su WAF rechaza User-Agents no-navegador en /graphql.
 */
const ahorro = {
  id: 'Ahorro',
  fuente: 'www.fahorro.com',
  async buscar(ctx, query) {
    const gql = `{products(search:"${query}",pageSize:30){items{name url_key ` +
      'price_range{minimum_price{final_price{value}}}}}}';
    const data = await ctx.postJSON('https://www.fahorro.com/graphql', { query: gql }, {
      navegador: true,
      headers: {
        Accept: 'application/json',
        Store: 'default',
        Origin: 'https://www.fahorro.com',
        Referer: 'https://www.fahorro.com/control-de-peso.html',
      },
    });
    const items = ((data && data.data && data.data.products) || {}).items || [];
    const out = [];
    for (const it of items) {
      const v = ((((it.price_range || {}).minimum_price || {}).final_price) || {}).value;
      const precio = toPrice(v);
      if (!precio) continue;
      const uk = it.url_key || '';
      out.push({
        titulo: it.name || '',
        precio: Math.round(precio),
        url: uk ? `https://www.fahorro.com/${uk}.html` : URL_FARMACIA.Ahorro,
      });
    }
    return out;
  },
};

/**
 * Farmacias Guadalajara — Salesforce Commerce Cloud.
 * Bloquea IPs de datacenter, así que va por proxy desde el arranque.
 */
const guadalajara = {
  id: 'Guadalajara',
  fuente: 'www.farmaciasguadalajara.com',
  proxy: true,
  async buscar(ctx, query) {
    const base = 'https://www.farmaciasguadalajara.com';
    const html = await ctx.get(`${base}/buscar/?q=${encodeURIComponent(query)}`);
    const out = [], vistos = new Set();
    const tiles = html.split(/<div[^>]+class="[^"]*product-tile/i).slice(1);
    for (const tile of tiles) {
      const a = tile.match(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]{0,220}?)<\/a>/i);
      const val = tile.match(/class="[^"]*value[^"]*"[^>]*content="([\d.]+)"/i);
      if (!a || !val) continue;
      const titulo = stripTags(a[2]);
      const precio = toPrice(val[1]);
      const clave = `${titulo}|${precio}`;
      if (!titulo || !precio || vistos.has(clave)) continue;
      vistos.add(clave);
      const href = a[1];
      out.push({ titulo, precio: Math.round(precio), url: href.startsWith('/') ? base + href : href || base });
    }
    return out;
  },
};

/**
 * Farmacia San Pablo — SAP Commerce (OCC). Protegida por Akamai: por proxy.
 * El baseSite y el host OCC se descubrieron en su bundle principal.
 */
const sanpablo = {
  id: 'SanPablo',
  fuente: 'farmaciasanpablo.com.mx',
  proxy: true,
  occ: process.env.SP_OCC || 'https://api.coxdka37yz-unifarsad1-p2-public.model-t.cc.commerce.ondemand.com',
  site: process.env.SP_SITE || 'fsp',
  async buscar(ctx, query) {
    if (!this.site) return [];
    const url = `${this.occ}/rest/v2/${this.site}/products/search` +
      `?query=${encodeURIComponent(query)}&fields=FULL&pageSize=24&lang=es_MX&curr=MXN`;
    const data = await ctx.getJSON(url, { headers: { Accept: 'application/json' } });
    const out = [];
    for (const p of (data && data.products) || []) {
      const precio = toPrice((p.price || {}).value);
      if (!precio) continue;
      const u = p.url || '';
      out.push({
        titulo: p.name || '',
        precio: Math.round(precio),
        url: u.startsWith('/') ? 'https://www.farmaciasanpablo.com.mx' + u : (u || URL_FARMACIA.SanPablo),
      });
    }
    return out;
  },
};

/** Catálogo público de VTEX, común en farmacias mexicanas. Queda listo por si se suma otra. */
async function vtexBuscar(ctx, base, query) {
  const data = await ctx.getJSON(`${base}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(query)}&_from=0&_to=23`);
  const out = [];
  for (const p of Array.isArray(data) ? data : []) {
    let precio = null;
    for (const it of p.items || []) {
      for (const s of it.sellers || []) {
        const co = s.commertialOffer || {};
        if (co.Price) { precio = co.Price; break; }
      }
      if (precio) break;
    }
    if (!p.productName || !precio) continue;
    out.push({
      titulo: p.productName,
      precio: Math.round(precio),
      url: p.link || `${base}/${p.linkText || ''}/p`,
    });
  }
  return out;
}

/** Adaptadores que se raspan. Clivi y Revert vienen de archivos curados. */
const ADAPTADORES = [benavides, ahorro, guadalajara, sanpablo];

// ── emparejamiento por tokens declarados ─────────────────────────────────────

/** "5mg" / "12.5Mg" → "5 mg" / "12.5 mg", para que los tokens comparen igual. */
function normalizar(s) {
  return String(s || '').toLowerCase().replace(/(\d)\s*mg/g, '$1 mg').replace(/\s+/g, ' ');
}

function coincide(titulo, prod) {
  const t = normalizar(titulo);
  for (const ex of prod.exclude || []) if (t.includes(ex.toLowerCase())) return false;
  if (prod.match_all && !prod.match_all.every((tok) => t.includes(tok.toLowerCase()))) return false;
  if (prod.match_any && !prod.match_any.some((tok) => t.includes(tok.toLowerCase()))) return false;
  return true;
}

/**
 * Escoge la presentación correcta entre los resultados de una farmacia.
 *
 * Exige que la marca aparezca en el título, para que una búsqueda difusa no
 * cruce medicamentos distintos. Benavides es la excepción: lista "1 mg
 * Semaglutida" sin marca, pero su búsqueda ya viene acotada por familia.
 */
function elegir(resultados, prod, fuente) {
  let cands = resultados.filter((r) => coincide(r.titulo, prod));
  if (prod.min_price) cands = cands.filter((r) => r.precio >= prod.min_price);

  const fam = normalizar(prod.family || '');
  const conMarca = cands.filter((r) => fam && normalizar(r.titulo).includes(fam));
  if (conMarca.length) cands = conMarca;
  else if (fuente !== 'Benavides') return null;

  if (!cands.length) return null;
  return cands.reduce((a, b) => (b.precio < a.precio ? b : a));
}

module.exports = {
  id: 'medicamentos',
  nombre: 'Medicamentos GLP-1',
  columnas: FARMACIA_IDS,
  catalogo: CATALOGO,
  adaptadores: ADAPTADORES,
  curados: { Clivi: CLIVI, overrides: OVERRIDES },
  urlFarmacia: URL_FARMACIA,
  coincide,
  elegir,
  normalizar,
  vtexBuscar,
};
