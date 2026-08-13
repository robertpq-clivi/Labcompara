/**
 * Labcompara — Parseo de precios y HTML
 * --------------------------------------
 * Helpers que usan las dos verticales. Vivían dentro del módulo de laboratorio;
 * al portar las farmacias quedó claro que no tienen nada de específico de un
 * vertical, así que se extrajeron aquí en vez de duplicarlos.
 */

'use strict';

const ENTIDADES = [
  [/&amp;/g, '&'], [/&lt;/g, '<'], [/&gt;/g, '>'], [/&quot;/g, '"'],
  [/&#0?39;/g, "'"], [/&#x27;/gi, "'"], [/&nbsp;/g, ' '],
  [/&aacute;/gi, 'á'], [/&eacute;/gi, 'é'], [/&iacute;/gi, 'í'],
  [/&oacute;/gi, 'ó'], [/&uacute;/gi, 'ú'], [/&ntilde;/gi, 'ñ'],
];

const decodeEntities = (s) => {
  let t = String(s);
  for (const [re, rep] of ENTIDADES) t = t.replace(re, rep);
  return t
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));
};

const stripTags = (s) => decodeEntities(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/**
 * "$1,234.50" | "1234.5" | "1234,50" → 1234.5 (o null).
 * México usa punto decimal, pero algunos catálogos vienen con formato europeo,
 * así que manda el último separador que aparezca.
 */
function toPrice(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).replace(/[^\d.,]/g, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

/** Extrae <loc> de un sitemap. */
function locsFrom(xml) {
  const out = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/g;
  let m;
  while ((m = re.exec(xml))) out.push(decodeEntities(m[1]));
  return out;
}

/** Todos los bloques JSON-LD parseados de una página. */
function jsonLd(html) {
  const out = [];
  const re = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try { out.push(JSON.parse(m[1].trim())); } catch { /* bloque roto: se ignora */ }
  }
  return out;
}

/** Aplana @graph / arrays y devuelve los nodos con @type dado. */
function ldNodes(blocks, type) {
  const out = [];
  const visit = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(visit);
    if (n['@graph']) n['@graph'].forEach(visit);
    const t = n['@type'];
    if (t === type || (Array.isArray(t) && t.includes(type))) out.push(n);
  };
  blocks.forEach(visit);
  return out;
}

module.exports = { toPrice, stripTags, decodeEntities, locsFrom, jsonLd, ldNodes };
