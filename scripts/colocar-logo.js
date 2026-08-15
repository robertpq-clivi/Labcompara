#!/usr/bin/env node
/**
 * Medcompara — Deja un logo listo para la órbita y los comparadores.
 *
 * Los badges son círculos de 22 a 60 px. Un logo que llega como lockup con
 * eslogan, o como avatar con fondo de color, ahí no se lee: hay que recortar,
 * cuadrar y pesar poco. Este script hace ese trabajo siempre igual.
 *
 *   node scripts/colocar-logo.js <archivo> <clave> [modo]
 *
 * Modos, según la forma en que llegue el archivo:
 *
 *   (ninguno)   Recorta lo que no es fondo y lo cuadra. Para logos que ya
 *               vienen limpios y centrados.
 *
 *   --isotipo   Recorta solo la mancha de color y deja fuera el texto en gris
 *               o negro. Para lockups horizontales tipo "marca + nombre".
 *               Usado en: labbe.
 *
 *   --tono      Recorta solo el color dominante. Sirve cuando el logo lleva dos
 *               colores y el segundo es una línea de texto que sobra —ahí
 *               --isotipo se queda corto porque ese texto también es de color.
 *               Usado en: lapi (naranja sí, "Laboratorio Médico" en teal no).
 *
 *   --circulo   Blanquea todo lo que quede fuera del círculo antes de recortar.
 *               Para avatares: logo dentro de un círculo blanco sobre un fondo
 *               de color que no es parte de la marca. Sin esto, el recorte
 *               arrastra las esquinas del fondo al badge. Usado en: olab.
 *
 * Sale un PNG de 256 px en images/laboratorios/ o images/farmacias/ según la
 * clave, que es la ruta que ya esperan LAB_LOGO y FARM_LOGO: no hay que tocar
 * código después.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** A qué vertical pertenece cada clave, que decide la carpeta destino. */
const LABORATORIOS = ['lapi', 'olab', 'polanco', 'labbe', 'chopo', 'salud-digna'];

const [, , archivo, clave, ...resto] = process.argv;
const modo = ['--isotipo', '--tono', '--circulo'].find(m => resto.includes(m)) || '--plano';

if (!archivo || !clave) {
  console.error('Uso: node scripts/colocar-logo.js <archivo> <clave> [--isotipo|--tono|--circulo]');
  process.exit(1);
}
if (!fs.existsSync(archivo)) {
  console.error(`No existe el archivo: ${archivo}`);
  process.exit(1);
}

const carpeta = LABORATORIOS.includes(clave) ? 'laboratorios' : 'farmacias';
const destino = path.join(ROOT, 'images', carpeta, `${clave}-logo.png`);

// El trabajo de imagen va en Python porque Pillow ya está instalado y hace el
// recorte por contenido sin dependencias nuevas en el repo.
const py = `
from PIL import Image, ImageDraw
import colorsys, sys
from collections import Counter

src, dst, modo = sys.argv[1], sys.argv[2], sys.argv[3]
im = Image.open(src).convert('RGBA')
W, H = im.size

# Un avatar trae el logo dentro de un círculo y color alrededor. Ese color es
# del avatar, no de la marca: se blanquea antes de medir nada. El margen de 6 px
# hacia dentro se come el halo que deja la compresión JPEG en el borde.
if modo == '--circulo':
    mascara = Image.new('L', (W, H), 0)
    ImageDraw.Draw(mascara).ellipse((6, 6, W - 7, H - 7), fill=255)
    limpio = Image.new('RGBA', (W, H), (255, 255, 255, 255))
    limpio.paste(im, (0, 0), mascara)
    im = limpio

px = im.load()

def saturado(p):
    r, g, b, a = p
    return a > 40 and (max(r, g, b) - min(r, g, b)) > 45

def tono(p):
    r, g, b, _ = p
    return colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)[0]

# Con --tono se queda solo el color que más manda. En un logo de dos colores,
# el segundo casi siempre es la línea de texto que a 40 px no se lee.
dominante = None
if modo == '--tono':
    tonos = Counter()
    for x in range(0, W, 2):
        for y in range(0, H, 2):
            p = px[x, y]
            if saturado(p):
                tonos[round(tono(p) * 24)] += 1
    if tonos:
        dominante = tonos.most_common(1)[0][0]

def cuenta(x, y):
    p = px[x, y]
    if modo == '--isotipo':
        return saturado(p)
    if modo == '--tono':
        return saturado(p) and round(tono(p) * 24) == dominante
    r, g, b, a = p
    return a > 40 and not (r > 232 and g > 232 and b > 232)

xs = [x for x in range(0, W, 2) if any(cuenta(x, y) for y in range(0, H, 2))]
ys = [y for y in range(0, H, 2) if any(cuenta(x, y) for x in range(0, W, 2))]
if not xs or not ys:
    xs, ys = [0, W - 1], [0, H - 1]

# Margen general, salvo hacia abajo con --tono: ahí lo que sigue suele ser la
# línea de texto que acabamos de excluir, y un margen la volvería a meter.
m = 14
x0, x1 = max(0, min(xs) - m), min(W, max(xs) + m)
y0 = max(0, min(ys) - m)
y1 = min(H, max(ys) + (1 if modo == '--tono' else m))

rec = im.crop((x0, y0, x1, y1))
lado = max(rec.size)
# El fondo del cuadrado se hereda del logo: transparente si venía con alfa,
# blanco si venía sobre blanco. El badge ya es blanco, así que no se nota.
fondo = (255, 255, 255, 255) if modo == '--circulo' else (0, 0, 0, 0)
lienzo = Image.new('RGBA', (lado, lado), fondo)
lienzo.paste(rec, ((lado - rec.width) // 2, (lado - rec.height) // 2), rec)
lienzo.resize((256, 256), Image.LANCZOS).save(dst, optimize=True)
print(f'{(x0, y0, x1, y1)} -> 256x256')
`;

const salida = execFileSync('python3', ['-c', py, archivo, destino, modo], { encoding: 'utf8' });
const kb = (fs.statSync(destino).size / 1024).toFixed(1);

console.log(`  ✓ ${path.relative(ROOT, destino)}  (${kb} KB · ${modo} · recorte ${salida.trim()})`);
console.log('    Ya está en la ruta que esperan la órbita y los comparadores: no hay que tocar código.');
