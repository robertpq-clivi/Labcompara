/**
 * Medcompara — El `id` de una pregunta del bloque FAQ
 * ------------------------------------------------------------------
 * Vive aquí porque lo calculan dos lados que no se pueden desincronizar: los
 * cuatro generadores, que escriben las 57 páginas del ciclo semanal, y
 * `preguntas-como-encabezado.js`, que hizo la conversión de una sola pasada
 * sobre las escritas a mano.
 *
 * Si las dos fórmulas se separan, cada domingo el generador reescribe los `id`
 * de las páginas generadas y cualquier enlace a una sección —el nuestro, el de
 * un tercero, el que Google haya aprendido— apunta a la nada. No hay error
 * visible: la página carga y el navegador se queda arriba.
 *
 * Google pide anclas descriptivas, no «section-2.1»: minúsculas, guiones entre
 * palabras, y el texto de la pregunta como fuente.
 */

'use strict';

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Deja el texto plano de un fragmento de HTML: sin etiquetas ni entidades. */
function legible(html) {
  return String(html)
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g,           (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g,      (_, n) => (n in ENTIDADES ? ENTIDADES[n] : ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Ancla a partir del texto de la pregunta. Se corta en el límite de palabra
 * para no dejar sílabas partidas en la URL.
 */
function ancla(texto) {
  let s = legible(texto)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (s.length > 58) {
    s = s.slice(0, 58);
    const corte = s.lastIndexOf('-');
    if (corte > 24) s = s.slice(0, corte);
  }
  return s.replace(/-+$/, '') || 'pregunta';
}

/**
 * Las anclas de una lista de preguntas, ya sin repetidos. Dos preguntas
 * distintas pueden reducirse al mismo slug —«¿Cuál es más barato?» aparece en
 * varias comparativas— y un `id` duplicado hace que el navegador salte siempre
 * a la primera.
 */
function anclas(preguntas, tomados = []) {
  const usados = new Set(tomados);
  return preguntas.map((q) => {
    const base = ancla(q);
    let id = base, n = 2;
    while (usados.has(id)) id = `${base}-${n++}`;
    usados.add(id);
    return id;
  });
}

module.exports = { ancla, anclas, legible };
