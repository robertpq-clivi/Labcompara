/**
 * Medcompara — Adaptadores de farmacia (vertical GLP-1)
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
  async buscar(ctx, query, opts = {}) {
    const base = 'https://www.farmaciasguadalajara.com';
    const html = await ctx.get(`${base}/buscar/?q=${encodeURIComponent(query)}`);
    if (opts.volcar) opts.volcar(`guadalajara-${query}`, html);

    const out = [], vistos = new Set();
    // Se corta por tile y se busca dentro. El orden de atributos NO se asume:
    // la primera versión exigía class antes de content y encontraba cero.
    const tiles = html.split(/<div[^>]+(?:class="[^"]*product-tile|data-pid=)/i).slice(1);
    for (const tile of tiles) {
      // El precio: en Salesforce Commerce la ficha trae DOS valores —el de lista
      // tachado y el de venta— y el de lista aparece primero en el DOM. Hay que
      // tomar el de dentro del bloque .sales; quedarse con el primero publica el
      // precio de lista (Mounjaro 2.5 mg: $9,186 de lista contra $3,770 real).
      const precioEn = (fragmento) => {
        const reEl = /<[a-z]+\s([^>]*)>/gi;
        let m;
        while ((m = reEl.exec(fragmento))) {
          const attrs = m[1];
          if (!/class="[^"]*\bvalue\b/i.test(attrs)) continue;
          const c = attrs.match(/content="([\d.]+)"/i);
          if (c) return toPrice(c[1]);
        }
        const alt = fragmento.match(/content="([\d.]+)"[^>]*class="[^"]*\bvalue\b/i);
        return alt ? toPrice(alt[1]) : null;
      };

      let precio = null;
      const venta = tile.search(/class="[^"]*\bsales\b/i);
      if (venta > -1) precio = precioEn(tile.slice(venta));
      if (!precio) precio = precioEn(tile);   // ficha sin promoción: precio único
      if (!precio) continue;

      // El título: se prefiere el enlace del producto (.link / .pdp-link) y se
      // cae al primer enlace con texto útil.
      let titulo = '', href = '';
      const anclas = [...tile.matchAll(/<a\s([^>]*)>([\s\S]{0,300}?)<\/a>/gi)];
      const preferida = anclas.find((x) => /class="[^"]*\b(link|pdp-link)\b/i.test(x[1]));
      for (const cand of preferida ? [preferida, ...anclas] : anclas) {
        const t = stripTags(cand[2]);
        if (t.length > 3) {
          titulo = t;
          href = (cand[1].match(/href="([^"]*)"/i) || [])[1] || '';
          break;
        }
      }
      if (!titulo) continue;

      const clave = `${titulo}|${precio}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
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

/**
 * @param {object} [familia] entrada de catalogo.families, para exclusiones que
 *   aplican a toda la familia y no a cada presentación por separado.
 */
function coincide(titulo, prod, familia) {
  const t = normalizar(titulo);
  // Las exclusiones de familia van primero: si Mounjaro se compara en pluma,
  // ninguna de sus seis dosis debe considerar un frasco ámpula.
  for (const ex of (familia && familia.exclude) || []) if (t.includes(ex.toLowerCase())) return false;
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
function elegir(resultados, prod, fuente, familia) {
  let cands = resultados.filter((r) => coincide(r.titulo, prod, familia));
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
