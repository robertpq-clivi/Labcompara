/**
 * Medcompara — El texto alternativo de la tarjeta social
 * ---------------------------------------------------------------------------
 * Vive aquí porque lo calculaban dos lados con fórmulas distintas, y se
 * peleaban: los cuatro generadores escribían `og:image:alt` con el <title>
 * completo —marca incluida— y `poner-imagen-blog.js` se la quitaba. Cada
 * corrida de uno deshacía la del otro sobre los mismos 56 artículos, así que
 * cualquier changeset que tocara imágenes arrastraba 56 archivos de ruido y
 * nadie podía distinguir un cambio real de la oscilación.
 *
 * Gana la versión sin marca: `og:image:alt` describe la imagen para quien no
 * puede verla, y «| Medcompara» no describe nada —la marca ya va impresa en la
 * tarjeta y repetirla sólo alarga lo que lee un lector de pantalla.
 *
 * `test-marcado-blog.js` verifica que los 182 artículos la cumplan, para que la
 * divergencia no vuelva en silencio.
 */

'use strict';

const SUFIJO_MARCA = /\s*\|\s*Medcompara\s*$/;

/** "Precio de Ozempic | Medcompara" → "Precio de Ozempic". */
const altDeTitulo = (titulo) => String(titulo).replace(SUFIJO_MARCA, '').trim();

module.exports = { altDeTitulo, SUFIJO_MARCA };
