#!/usr/bin/env node
/**
 * Medcompara — Conecta la tarjeta de cada artículo con su marcado.
 *
 *   node scripts/poner-imagen-blog.js            # dry-run
 *   node scripts/poner-imagen-blog.js --apply    # escribe los .html
 *
 * Hace tres cosas por artículo, todas idempotentes:
 *
 *   1. `image` en el JSON-LD de `Article`  — sin esto Google no tiene thumbnail
 *      que poner y el rich result de artículo no se arma.
 *   2. `image` en el JSON-LD de `Product`  — Google lo pide para el snippet de
 *      precio; las 36 páginas que declaran `AggregateOffer` no renderizaban por
 *      esto.
 *   3. `og:image` / `twitter:image` apuntando a la tarjeta del artículo. Antes
 *      106 páginas compartían el mismo `og-image.jpg` genérico y 72 no tenían
 *      ninguna.
 *
 * No inventa la imagen: si el PNG no existe en images/blog/, no escribe nada.
 * Corre `generar-tarjetas-blog.js --apply` primero.
 */

const fs   = require('fs');
const path = require('path');

const ROOT    = path.join(__dirname, '..');
const BLOG    = path.join(ROOT, 'blog');
const TARJETAS = path.join(ROOT, 'images', 'blog');
const BASE    = 'https://medcompara.com.mx';

const APLICAR = process.argv.includes('--apply');

const LD = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const TIPOS_ARTICULO = ['Article', 'BlogPosting', 'NewsArticle'];

/** Devuelve una copia con `clave: valor` insertado justo después de `tras`. */
function insertarTras(obj, tras, clave, valor) {
  if (clave in obj) { obj[clave] = valor; return obj; }
  const salida = {};
  let puesto = false;
  for (const [k, v] of Object.entries(obj)) {
    salida[k] = v;
    if (k === tras) { salida[clave] = valor; puesto = true; }
  }
  if (!puesto) salida[clave] = valor;
  return salida;
}

function parchearBloque(crudo, url) {
  let json;
  try { json = JSON.parse(crudo); } catch { return { crudo, cambios: [] }; }

  const nodos  = Array.isArray(json) ? json : (json['@graph'] || [json]);
  const cambios = [];
  const nuevos = nodos.map(nodo => {
    if (!nodo || typeof nodo !== 'object') return nodo;
    const tipo = nodo['@type'];
    if (TIPOS_ARTICULO.includes(tipo)) {
      if (JSON.stringify(nodo.image) === JSON.stringify([url])) return nodo;
      cambios.push(`${tipo}.image`);
      return insertarTras(nodo, 'headline', 'image', [url]);
    }
    if (tipo === 'Product') {
      if (JSON.stringify(nodo.image) === JSON.stringify([url])) return nodo;
      cambios.push('Product.image');
      return insertarTras(nodo, 'name', 'image', [url]);
    }
    return nodo;
  });

  if (!cambios.length) return { crudo, cambios };

  let salida;
  if (Array.isArray(json))      salida = nuevos;
  else if (json['@graph'])      salida = { ...json, '@graph': nuevos };
  else                          salida = nuevos[0];

  return { crudo: JSON.stringify(salida), cambios };
}

/** og:image y twitter:image. Reemplaza si existen, los agrega si no. */
function parchearMeta(html, url, titulo) {
  const cambios = [];
  const alt = titulo.replace(/"/g, '&quot;');

  const tieneOg = /property=["']og:image["']/.test(html);

  if (tieneOg) {
    const antes = html;
    html = html.replace(
      /(<meta\s+property=["']og:image["'][^>]*content=["'])[^"']*(["'][^>]*\/?>)/i,
      `$1${url}$2`);
    html = html.replace(
      /(<meta\s+property=["']og:image:alt["'][^>]*content=["'])[^"']*(["'][^>]*\/?>)/i,
      `$1${alt}$2`);
    if (html !== antes) cambios.push('og:image');
  } else {
    // Va justo después del og:url si existe, si no después del canonical:
    // así el bloque social queda junto en vez de disperso.
    const ancla = html.match(/<meta\s+property=["']og:url["'][^>]*\/?>\n?/i)
               || html.match(/<link\s+rel=["']canonical["'][^>]*\/?>\n?/i);
    if (!ancla) return { html, cambios };
    const bloque =
      `<meta property="og:image" content="${url}"/>\n` +
      `<meta property="og:image:width" content="1200"/>\n` +
      `<meta property="og:image:height" content="630"/>\n` +
      `<meta property="og:image:alt" content="${alt}"/>\n`;
    html = html.replace(ancla[0], ancla[0] + bloque);
    cambios.push('og:image (nuevo)');
  }

  if (/name=["']twitter:image["']/.test(html)) {
    const antes = html;
    html = html.replace(
      /(<meta\s+name=["']twitter:image["'][^>]*content=["'])[^"']*(["'][^>]*\/?>)/i,
      `$1${url}$2`);
    if (html !== antes) cambios.push('twitter:image');
  } else {
    const ancla = html.match(/<meta\s+property=["']og:image:alt["'][^>]*\/?>\n?/i)
               || html.match(/<meta\s+property=["']og:image["'][^>]*\/?>\n?/i);
    if (ancla) {
      html = html.replace(ancla[0], ancla[0] +
        `<meta name="twitter:card" content="summary_large_image"/>\n`.replace(
          /^/, /name=["']twitter:card["']/.test(html) ? '' : '') +
        `<meta name="twitter:image" content="${url}"/>\n`);
      cambios.push('twitter:image (nuevo)');
    }
  }

  return { html, cambios };
}

function main() {
  const archivos = fs.readdirSync(BLOG)
    .filter(f => f.endsWith('.html') && f !== 'index.html')
    .sort();

  const faltantes = [], resumen = [];
  let tocados = 0;
  const cuenta = {};

  for (const archivo of archivos) {
    const slug = archivo.replace(/\.html$/, '');
    if (!fs.existsSync(path.join(TARJETAS, `${slug}.png`))) {
      faltantes.push(slug); continue;
    }

    const ruta = path.join(BLOG, archivo);
    let html = fs.readFileSync(ruta, 'utf8');
    const url = `${BASE}/images/blog/${slug}.png`;
    const titulo = (html.match(/<title>([^<]*)<\/title>/i) || [, slug])[1]
      .replace(/\s*\|\s*Medcompara\s*$/, '');

    const cambios = [];

    html = html.replace(LD, (entero, crudo) => {
      const r = parchearBloque(crudo, url);
      if (!r.cambios.length) return entero;
      cambios.push(...r.cambios);
      return entero.replace(crudo, r.crudo);
    });

    const meta = parchearMeta(html, url, titulo);
    html = meta.html;
    cambios.push(...meta.cambios);

    if (!cambios.length) continue;
    tocados++;
    cambios.forEach(c => { cuenta[c] = (cuenta[c] || 0) + 1; });
    resumen.push(`  ${slug}: ${cambios.join(', ')}`);
    if (APLICAR) fs.writeFileSync(ruta, html);
  }

  if (faltantes.length) {
    console.error(`Faltan ${faltantes.length} tarjetas en images/blog/. Corre primero:`);
    console.error('  node scripts/generar-tarjetas-blog.js --apply\n');
    faltantes.slice(0, 5).forEach(s => console.error('  ✗ ' + s + '.png'));
    process.exit(1);
  }

  console.log(`${archivos.length} artículos revisados, ${tocados} con cambios.\n`);
  Object.entries(cuenta).sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${String(v).padStart(3)}  ${k}`));

  if (!APLICAR) {
    console.log('\nDry-run. Muestra:\n' + resumen.slice(0, 4).join('\n'));
    console.log('\nCorre con --apply para escribir.');
  } else {
    console.log('\nEscrito.');
  }
}

main();
