/**
 * Medcompara — Quién puede declarar `Product` + `AggregateOffer`.
 * ----------------------------------------------------------------------------
 * El marcado de producto lo emitían las 36 páginas de precio por igual, y en las
 * de medicamento decía dos cosas que no son ciertas:
 *
 *   availability: InStock · Medcompara no tiene existencias de nada. El nodo
 *                           describe una oferta, y quien la sostiene es la
 *                           farmacia, no este sitio.
 *
 *   un precio de mostrador · sobre cajas que en México no se pueden comprar sin
 *                            receta. En `precio-clonazepam-mexico` el nodo
 *                            anunciaba «$62 a $83 · InStock» de un psicotrópico
 *                            que sólo se surte con receta especial retenida, y
 *                            la página entera se posicionaba para «clonazepam
 *                            venta libre» y «comprar clonazepam».
 *
 * Es marcado de comercio sobre producto regulado en un sitio sin licencia
 * sanitaria, en el terreno donde Google es más estricto. Y no compraba nada: los
 * Product snippets del sitio llevan 1,926 impresiones y **un** clic — 0.05% de
 * CTR— según el informe de apariencia en búsqueda.
 *
 * La regla es la que ya vive en el copy de cada página, en `receta.estado`: si
 * la caja se compra de mostrador, el rango de precio es una oferta pública y se
 * declara. Si hace falta una receta, no lo es, y la página se queda con
 * `Article` + `FAQPage`, que describen lo que la página realmente es: un
 * artículo que compara precios, no una tienda.
 *
 * Los estudios de laboratorio no pasan por aquí: se contratan sin receta ni
 * intermediario, el precio es público y el catálogo es el del propio laboratorio.
 */

'use strict';

/**
 * ¿La presentación se vende sin receta?
 *
 * Los cuatro estados que usa el copy hoy:
 *   «Venta libre»                              → sí
 *   «Venta libre en dosis bajas»               → sí
 *   «Requiere receta médica»                   → no
 *   «Receta médica que la farmacia retiene»    → no
 *   «Venta controlada: receta especial retenida» → no
 *
 * El prefijo decide, y «Venta controlada» queda fuera a propósito pese a
 * empezar con la misma palabra. Un estado nuevo que no diga «venta libre» cae
 * del lado seguro solo.
 */
function seVendeSinReceta(estado) {
  const s = String(estado || '').trim().toLowerCase();
  return s.startsWith('venta libre');
}

/** El nodo `Product`, o null cuando la caja necesita receta. */
function ofertaPublica(estado, producto) {
  return seVendeSinReceta(estado) ? producto : null;
}

module.exports = { seVendeSinReceta, ofertaPublica };
