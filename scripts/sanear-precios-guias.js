#!/usr/bin/env node
/**
 * Medcompara — Saca los precios de las guías.
 *
 * Las páginas de precio ya salen del scan, pero las guías informativas seguían
 * citando cifras escritas a mano: la guía de dosis de Mounjaro anunciaba
 * $4,890 para la dosis de 15 mg cuando la farmacia más barata la tiene en
 * $7,750. Una guía no necesita el número — necesita mandar a la página que lo
 * tiene actualizado.
 *
 * Qué hace:
 *   1. Quita la columna "Precio desde" de las tablas y deja bajo la tabla un
 *      enlace a la página de precio correspondiente.
 *   2. Cambia "Precio desde: $X MXN (Lab)" por un enlace a esa misma página.
 *   3. Limpia las cifras de las FAQ, en el HTML y en el JSON-LD.
 *
 * No es un generador: se corre una vez y deja las guías sin cifras que puedan
 * envejecer. Si alguien vuelve a escribir un precio a mano, este script lo
 * vuelve a encontrar.
 *
 *   node scripts/sanear-precios-guias.js            (reporta, no escribe)
 *   node scripts/sanear-precios-guias.js --apply
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT   = path.join(__dirname, '..');
const BLOG   = path.join(ROOT, 'blog');
const APPLY  = process.argv.includes('--apply');

/** A qué página de precio manda cada guía. */
const DESTINO = {
  'guia-dosis-mounjaro':                       ['/blog/mounjaro-precio-mexico', 'el precio de Mounjaro dosis por dosis'],
  'que-es-mounjaro-como-funciona':             ['/blog/mounjaro-precio-mexico', 'el precio de Mounjaro dosis por dosis'],
  'que-es-ozempic-para-que-sirve':             ['/blog/ozempic-precio-mexico', 'el precio de Ozempic en cada farmacia'],
  'que-son-los-medicamentos-glp1':             ['/blog/cuanto-cuesta-bajar-de-peso-con-glp1-mexico', 'cuánto cuesta al mes cada tratamiento'],
  'mejor-medicamento-para-bajar-de-peso-2026': ['/blog/cuanto-cuesta-bajar-de-peso-con-glp1-mexico', 'cuánto cuesta al mes cada tratamiento'],
  'donde-hacerme-estudios-laboratorio-baratos':['/blog/estudios-laboratorio-precios-mexico', 'los precios actualizados de cada estudio'],
  'guia-examenes-de-sangre':                   ['/blog/estudios-laboratorio-precios-mexico', 'los precios actualizados de cada estudio'],
  'guia-completa-examenes-de-sangre':          ['/blog/estudios-laboratorio-precios-mexico', 'los precios actualizados de cada estudio'],
  'tipos-analisis-clinicos-comunes':           ['/blog/estudios-laboratorio-precios-mexico', 'los precios actualizados de cada estudio'],
  'cada-cuanto-hacerte-examenes-de-sangre':    ['/blog/precio-check-up-completo-mexico', 'cuánto cuesta hoy el check up'],
  'como-elegir-laboratorio-clinico-mexico':    ['/blog/laboratorio-mas-barato-cdmx', 'qué laboratorio gana en más estudios'],
  'mounjaro-para-bajar-de-peso':               ['/blog/mounjaro-precio-mexico', 'el precio de Mounjaro dosis por dosis'],
  'que-revisar-antes-de-hacerte-estudios-clinicos': ['/blog/estudios-laboratorio-precios-mexico', 'los precios actualizados de cada estudio'],
  'tipos-de-analisis-clinicos-mas-comunes':    ['/blog/estudios-laboratorio-precios-mexico', 'los precios actualizados de cada estudio'],
};

/**
 * Cuando la guía nombra un estudio concreto, el enlace va a su página y no a
 * la guía general: es más útil para quien lee y mejor enlace interno.
 */
const POR_ESTUDIO = [
  [/biometr[íi]a hem[áa]tica/i,            '/blog/precio-biometria-hematica-mexico'],
  [/qu[íi]mica sangu[íi]nea/i,             '/blog/precio-quimica-sanguinea-mexico'],
  [/hemoglobina glucosilada|hba1c/i,       '/blog/precio-hemoglobina-glucosilada-mexico'],
  [/perfil (?:de )?l[íi]pidos|perfil lip[íi]dico/i, '/blog/precio-perfil-lipidico-mexico'],
  [/perfil tiroideo|tsh, t3, t4/i,         '/blog/precio-perfil-tiroideo-mexico'],
  [/insulina/i,                            '/blog/precio-insulina-mexico'],
  [/vitamina d/i,                          '/blog/precio-vitamina-d-mexico'],
  [/vih/i,                                 '/blog/precio-prueba-vih-mexico'],
  [/orina/i,                               '/blog/precio-examen-general-orina-mexico'],
  [/hep[áa]tic/i,                          '/blog/precio-pruebas-funcion-hepatica-mexico'],
  [/glucosa/i,                             '/blog/precio-glucosa-mexico'],
  [/colesterol/i,                          '/blog/precio-colesterol-total-mexico'],
];

const enlaceEstudio = texto => {
  const m = POR_ESTUDIO.find(([re]) => re.test(texto));
  return m ? m[1] : null;
};

const PRECIO = /\$\s?[0-9][0-9,]*(?:\s*(?:MXN|pesos))?/g;

/**
 * 1. Tablas: fuera la columna de precio —esté donde esté, no siempre es la
 *    última— y un enlace debajo a la página que sí tiene la cifra viva.
 */
function limpiarTablas(html, [destino, ancla], cambios) {
  return html.replace(/<table[^>]*>[\s\S]*?<\/table>/g, (tabla) => {
    const encabezados = [...tabla.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(m => m[1]);
    // Fuera el precio y también la columna que dice qué laboratorio lo tiene
    // más barato: es la misma afirmación, y envejece igual. Al quitar solo el
    // precio, esa columna quedaba sosteniendo sola un dato falso — decía que
    // el colesterol total era más barato en Labbe cuando hoy lo es en LAPI.
    const fuera = encabezados
      .map((h, i) => (/precio|laboratorio|farmacia/i.test(h) ? i : -1))
      .filter(i => i > -1)
      .sort((a, b) => b - a); // de derecha a izquierda: quitar no corre índices
    if (!fuera.length) return tabla;

    const quitarCelda = (fila, etiqueta, i) => {
      const celdas = [...fila.matchAll(new RegExp(`<${etiqueta}[^>]*>(?:(?!<\\/${etiqueta}>)[\\s\\S])*?<\\/${etiqueta}>`, 'g'))].map(m => m[0]);
      if (celdas.length <= i) return fila;
      return fila.replace(celdas[i], '');
    };

    const sinColumna = tabla.replace(/<tr[^>]*>[\s\S]*?<\/tr>/g, (fila) =>
      fuera.reduce((f, i) => quitarCelda(quitarCelda(f, 'th', i), 'td', i), fila));

    cambios.push(`tabla: ${fuera.map(i => `"${encabezados[i].trim()}"`).join(' y ')} fuera`);

    const nota = `  <p class="fuente-nota">Los precios cambian cada semana. Consulta <a href="${destino}">${ancla}</a>, con cifras del scan más reciente.</p>`;

    // Una tabla de una sola columna ya no es una tabla, es una lista. Y si lo
    // que enumera son estudios, la lista útil es la que lleva a la página con
    // el precio de cada uno.
    if (encabezados.length - fuera.length === 1) {
      const celdas = [...sinColumna.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
        .map(m => m[1].replace(/<[^>]+>/g, '').trim())
        .filter(Boolean);
      const items = celdas.map(nombre => {
        const url = enlaceEstudio(nombre) || destino;
        return `    <li><a href="${url}">${nombre}</a></li>`;
      }).join('\n');
      cambios.push(`tabla de una columna → lista de ${celdas.length} enlaces`);
      return `<ul>\n${items}\n  </ul>\n${nota}`;
    }

    return `${sinColumna}\n${nota}`;
  });
}

/** 2. "Precio desde: $95 MXN (Salud Digna)" → enlace a la página de precio. */
function limpiarProsa(html, [destino], cambios) {
  return html.replace(
    /<strong>Precios? desde:<\/strong>\s*\$[0-9][0-9,]*[^<]*/g,
    (frag, offset) => {
      const contexto = html.slice(Math.max(0, offset - 400), offset);
      const url = enlaceEstudio(contexto) || destino;
      cambios.push(`prosa: "${frag.replace(/<[^>]+>/g, '').trim().slice(0, 45)}…" → enlace`);
      return `<strong>Precio:</strong> <a href="${url}">ver precio actualizado</a>`;
    });
}

/** 3. Listas "Estudio: $95 MXN" → el estudio enlazado, sin la cifra. */
function limpiarListas(html, [destino], cambios) {
  return html.replace(/<li>([^:<]{3,60}):\s*<strong>\$[0-9][0-9,]*[^<]*<\/strong><\/li>/g,
    (frag, nombre) => {
      const url = enlaceEstudio(nombre) || destino;
      cambios.push(`lista: "${nombre.trim()}" enlazado sin cifra`);
      return `<li><a href="${url}">${nombre.trim()}</a></li>`;
    });
}

/** 4. Frases y FAQ que llevan la cifra dentro. Se reescriben, no se parchan. */
function limpiarFrases(html, [destino, ancla], cambios) {
  const reescrituras = [
    // "Un estudio que cuesta $95 MXN en Salud Digna puede costar $556 MXN en otro laboratorio."
    [/Un estudio que cuesta \$[0-9][0-9,]*[^.]*?\. /g,
     `El mismo estudio puede costar varias veces más en un laboratorio que en otro. `],
    // "… Desde $95 MXN." al cierre de una frase.
    [/\.?\s*Desde \$[0-9][0-9,]*(?:\s*MXN)?[^.<]*\./g, '.'],
    // FAQ que abre con una cifra orientativa.
    [/(?:Como referencia orientativa, )?[Dd]esde alrededor de \$[0-9][0-9,]*(?:\s*MXN)?[^.;]*[.;]/g,
     'El precio cambia entre farmacias y entre dosis, así que conviene compararlo antes de comprar.'],
  ];

  // Frases que ningún patrón general puede reescribir sin romperlas: cada una
  // lleva la cifra incrustada en su propia sintaxis. Se listan completas, tal
  // como están en el HTML, para que la reescritura sea legible y verificable.
  const literales = [
    ['Con Salud Digna, un perfil básico anual puede costar desde $300-500 MXN. Un check up más completo, desde $450 MXN.',
     'Lo que cuesta depende del laboratorio y de cuántos estudios lleve el paquete.'],
    ['Una biometría hemática cuesta $95 MXN en Salud Digna y $556 MXN en Laboratorio M&#xe9;dico Polanco.',
     'La misma biometría hemática puede costar varias veces más en un laboratorio que en otro.'],
    ['Desde alrededor de $3,490 MXN por pluma; compara en Medcompara.',
     'El precio cambia entre farmacias y entre dosis; compáralo en Medcompara.'],
    ['Mounjaro cuesta desde alrededor de $3,490 MXN por pluma.',
     'El precio de Mounjaro cambia entre farmacias y sube con cada escalón de dosis.'],
    ['puede ahorrarte desde $200 hasta $2,000 MXN.',
     'puede ahorrarte una diferencia que en varios estudios supera el doble.'],
    ['tiene uno de los precios más bajos, desde $55 MXN en Salud Digna.',
     'es de los estudios más accesibles del catálogo.'],
  ];

  for (const [antes, despues] of literales) {
    if (html.includes(antes)) {
      cambios.push(`frase reescrita: "${antes.slice(0, 40)}…"`);
      html = html.split(antes).join(despues);
    }
  }


  for (const [re, por] of reescrituras) {
    html = html.replace(re, () => { cambios.push('frase con cifra reescrita'); return por; });
  }
  return html;
}

// ── Main ──────────────────────────────────────────────────────────────────────

let tocados = 0;

for (const [slug, destino] of Object.entries(DESTINO)) {
  const archivo = path.join(BLOG, slug + '.html');
  if (!fs.existsSync(archivo)) { console.log(`  ! ${slug} no existe`); continue; }

  const antes = fs.readFileSync(archivo, 'utf8');
  const cambios = [];

  let html = limpiarTablas(antes, destino, cambios);
  html = limpiarProsa(html, destino, cambios);
  html = limpiarListas(html, destino, cambios);
  html = limpiarFrases(html, destino, cambios);

  if (html === antes) { console.log(`  · ${slug}: sin cifras`); continue; }

  // Nada de sustituciones a ciegas: si queda una cifra que ningún patrón
  // supo reescribir, se reporta y se deja intacta. Una frase rota es peor que
  // un precio viejo.
  const quedan = (html.match(/\$\s?[0-9][0-9,]*/g) || []);
  if (APPLY) fs.writeFileSync(archivo, html);
  tocados++;
  console.log(`  ${APPLY ? '✓' : '·'} ${slug}: ${cambios.length} cambios${quedan.length ? ` · ⚠️ sin reescribir: ${quedan.join(' ')}` : ''}`);
  cambios.slice(0, 3).forEach(c => console.log(`      ${c}`));
}

console.log(`\n${APPLY ? 'Saneadas' : 'Se sanearían'} ${tocados} guías`);
if (!APPLY) console.log('(dry-run — usa --apply)');
