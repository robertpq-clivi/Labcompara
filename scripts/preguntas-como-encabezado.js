#!/usr/bin/env node
/**
 * Medcompara — Las preguntas del bloque FAQ pasan de <div> a <h3> con ancla.
 *
 *   node scripts/preguntas-como-encabezado.js            # dry-run
 *   node scripts/preguntas-como-encabezado.js --apply     # escribe
 *
 * Las 868 preguntas vivían en `<div class="faq-q">`. Un div no es nada para un
 * extractor: no entra en el esquema de encabezados de la página, no es candidato
 * de featured snippet, y no puede ser destino de un enlace. Un `<h3>` con `id`
 * es las tres cosas.
 *
 * Esto importa más ahora que Google ya no renderiza FAQ rich results (ver
 * «Rich snippets» en CLAUDE.md): las dos superficies que el contenido Q&A
 * todavía alcanza —featured snippets y las citas de los motores de IA— leen el
 * HTML visible, no el JSON-LD. El marcado no las gana; la estructura sí ayuda.
 *
 * El `id` también deja el terreno listo para los jump links: son las anclas
 * descriptivas que Google pide, y sólo falta la tabla de contenidos.
 *
 * Sobre el CSS: `.faq-q` fijaba `margin-bottom` y nada más. Como div daba
 * igual, pero un `h3` hereda `margin:24px 0 8px` de la regla global y abriría
 * un hueco dentro de la caja. La regla pasa a `margin:0 0 8px` — la clase gana
 * al selector de tipo, así que el bloque se ve idéntico.
 *
 * Idempotente: si la pregunta ya es h3, no la toca.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT    = path.join(__dirname, '..');
const APLICAR = process.argv.includes('--apply');

const PREGUNTA = /<div class="faq-q">([\s\S]*?)<\/div>/g;

function objetivos() {
  const lista = [];
  for (const dir of ['blog', 'pages']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      if (f.endsWith('.html') && !(dir === 'blog' && f === 'index.html')) {
        lista.push(path.join(dir, f));
      }
    }
  }
  lista.push('index.html');
  return lista.sort();
}

// La fórmula del ancla vive en lib/ancla.js: la comparten los generadores.
const { ancla, legible } = require('./lib/ancla');

function procesar(html) {
  const cambios = { preguntas: 0, css: false };

  // El h3 heredaría margen superior de la regla global; la clase lo anula.
  const antesCss = html;
  html = html.replace(
    /(\.faq-q\{[^}]*?)margin-bottom:8px;\}/g,
    '$1margin:0 0 8px;}');
  if (html !== antesCss) cambios.css = true;

  // Todos los id que ya existen en la página, para no chocar con ninguno.
  const usados = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));

  html = html.replace(PREGUNTA, (entero, dentro) => {
    const texto = legible(dentro);
    if (!texto) return entero;

    let id = ancla(texto), n = 2;
    while (usados.has(id)) id = `${ancla(texto)}-${n++}`;
    usados.add(id);

    cambios.preguntas++;
    return `<h3 class="faq-q" id="${id}">${dentro}</h3>`;
  });

  return { html, cambios };
}

function main() {
  let totalPreguntas = 0, archivosTocados = 0, cssTocado = 0;
  const muestra = [];

  for (const rel of objetivos()) {
    const ruta = path.join(ROOT, rel);
    const original = fs.readFileSync(ruta, 'utf8');
    const { html, cambios } = procesar(original);

    if (html === original) continue;

    archivosTocados++;
    totalPreguntas += cambios.preguntas;
    if (cambios.css) cssTocado++;
    if (muestra.length < 3 && cambios.preguntas) {
      const primera = html.match(/<h3 class="faq-q" id="([^"]+)">([\s\S]*?)<\/h3>/);
      muestra.push(`  ${rel}: ${cambios.preguntas} preguntas\n` +
        `    #${primera[1]}\n    ${legible(primera[2]).slice(0, 76)}`);
    }
    if (APLICAR) fs.writeFileSync(ruta, html);
  }

  console.log(`${archivosTocados} archivos, ${totalPreguntas} preguntas a <h3> con ancla, ` +
    `${cssTocado} reglas .faq-q ajustadas.\n`);
  console.log(muestra.join('\n'));
  console.log(APLICAR ? '\nEscrito.' : '\nDry-run. Corre con --apply para escribir.');
}

main();
