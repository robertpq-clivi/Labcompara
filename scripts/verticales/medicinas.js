/**
 * Medcompara — Adaptadores de farmacia para medicamentos generales
 * ------------------------------------------------------------------
 * Tercera vertical: los 200 principios activos más buscados en México.
 *
 * Reusa cuatro adaptadores de la vertical GLP-1 —Ahorro, Benavides, Guadalajara
 * y San Pablo, que ya saben buscar en cada plataforma— y suma Prixz. Se dejan
 * fuera Clivi y Revert: venden tratamientos de control de peso, no farmacia
 * general, así que aquí no tendrían nada que comparar.
 *
 * YZA quedó fuera por decisión de robots.txt: su archivo dice
 * `User-agent: * / Disallow: /` en ambos dominios, una prohibición total a
 * cualquier bot. No es como OLAB, que solo bloquea crawlers de IA por nombre.
 *
 * Nota sobre Prixz: su robots.txt permite `*`, pero bloquea por nombre a una
 * lista de comparadores de precios comerciales (Shopzilla, PriceRunner,
 * Pricefalls y otros). MedcomparaBot no está en esa lista y cae bajo el `*`
 * permitido, pero la categoría que enumeran es la nuestra. Queda documentado
 * aquí para que la decisión sea explícita y reversible: basta quitarlo de
 * ADAPTADORES.
 */

'use strict';

const { toPrice, stripTags } = require('../lib/precio');
const GLP = require('./farmacias');

const CATALOGO = require('./medicinas-catalogo.json');

/** Orden de columnas del comparador. */
const FARMACIA_IDS = ['Ahorro', 'Benavides', 'Guadalajara', 'SanPablo', 'Prixz'];

const URL_FARMACIA = {
  Ahorro: 'https://www.fahorro.com/',
  Benavides: 'https://www.benavides.com.mx/',
  Guadalajara: 'https://www.farmaciasguadalajara.com/',
  SanPablo: 'https://www.farmaciasanpablo.com.mx/',
  Prixz: 'https://prixz.com/',
};

/**
 * Prixz — WordPress con WooCommerce. Su búsqueda se renderiza en el cliente,
 * pero expone la Store API pública y documentada, que además devuelve los
 * títulos ya estructurados ("Omeprazol 20 Mg Con 14 Cápsulas") — justo lo que
 * necesita el emparejamiento por presentación exacta.
 */
const prixz = {
  id: 'Prixz',
  fuente: 'prixz.com',
  async buscar(ctx, query) {
    const url = 'https://prixz.com/wp-json/wc/store/v1/products' +
      `?search=${encodeURIComponent(query)}&per_page=50&catalog_visibility=visible`;
    const items = await ctx.getJSON(url);
    if (!Array.isArray(items)) return [];
    const out = [];
    for (const p of items) {
      const pr = p.prices || {};
      // La Store API entrega enteros en unidades menores; el divisor viene en
      // currency_minor_unit y en esta tienda es 0 (pesos directos), pero no se
      // asume: si cambian a centavos, esto lo absorbe.
      const div = Math.pow(10, Number(pr.currency_minor_unit) || 0);
      const precio = toPrice(Number(pr.price) / div);
      if (!precio) continue;
      // Un producto agotado no es una opción de compra: no debe competir por
      // ser "el más barato".
      if (p.is_in_stock === false) continue;
      out.push({
        titulo: stripTags(p.name || ''),
        precio: Math.round(precio),
        url: p.permalink || URL_FARMACIA.Prixz,
      });
    }
    return out;
  },
};

/** Los cuatro que ya existen, tomados tal cual de la vertical GLP-1. */
const heredados = GLP.adaptadores.filter((a) => FARMACIA_IDS.includes(a.id));

const ADAPTADORES = [...heredados, prixz];

module.exports = {
  id: 'medicinas',
  nombre: 'Medicamentos de farmacia',
  columnas: FARMACIA_IDS,
  catalogo: CATALOGO,
  adaptadores: ADAPTADORES,
  urlFarmacia: URL_FARMACIA,
  prixz,
};
