#!/usr/bin/env node
/**
 * Medcompara — Deja un logo listo para la órbita y los comparadores.
 *
 * Los badges son círculos de 22 a 60 px. Un logo que llega como lockup
 * horizontal con eslogan ahí no se lee: hay que recortar, cuadrar y pesar poco.
 * Este script hace ese trabajo siempre igual, para que agregar una farmacia o
 * un laboratorio sea un comando y no una sesión de Photoshop.
 *
 *   node scripts/colocar-logo.js <archivo> <clave> [--isotipo]
 *
 *   <archivo>  el logo como venga (png, jpg, webp)
 *   <clave>    lapi | olab | polanco | labbe | prixz | ahorro | ...
 *   --isotipo  recorta solo la marca de color y tira el texto. Úsalo cuando el
 *              archivo trae el nombre al lado: a 40 px el texto es una mancha.
 *
 * Sale un PNG de 256 px en images/laboratorios/ o images/farmacias/ según la
 * clave, que es justo la ruta que ya esperan LAB_LOGO y FARM_LOGO.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** A qué vertical pertenece cada clave, que decide la carpeta destino. */
const LABORATORIOS = ['lapi', 'olab', 'polanco', 'labbe', 'chopo', 'salud-digna'];

const [, , archivo, clave, ...resto] = process.argv;
const ISOTIPO = resto.includes('--isotipo');

if (!archivo || !clave) {
  console.error('Uso: node scripts/colocar-logo.js <archivo> <clave> [--isotipo]');
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
from PIL import Image
import sys

src, dst, isotipo = sys.argv[1], sys.argv[2], sys.argv[3] == '1'
im = Image.open(src).convert('RGBA')
W, H = im.size
px = im.load()

def opaco(x, y):
    return px[x, y][3] > 40

def coloreado(x, y):
    r, g, b, a = px[x, y]
    return a > 40 and (max(r, g, b) - min(r, g, b)) > 45

# Con --isotipo se busca solo la mancha de color: el texto de marca suele ser
# negro o gris y se queda fuera. Sin la bandera se recorta el contenido opaco,
# que en un logo cuadrado con fondo es la imagen entera.
prueba = coloreado if isotipo else opaco
xs = [x for x in range(0, W, 2) if any(prueba(x, y) for y in range(0, H, 3))]
ys = [y for y in range(0, H, 2) if any(prueba(x, y) for x in range(0, W, 3))]
if not xs or not ys:
    xs, ys = [0, W - 1], [0, H - 1]

x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
lado = max(x1 - x0, y1 - y0)
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
m = int(lado * 0.06)  # un respiro para que no toque el borde del círculo
caja = (cx - lado // 2 - m, cy - lado // 2 - m, cx + lado // 2 + m, cy + lado // 2 + m)

im.crop(caja).resize((256, 256), Image.LANCZOS).save(dst, optimize=True)
print(f'{caja} -> 256x256')
`;

const salida = execFileSync('python3', ['-c', py, archivo, destino, ISOTIPO ? '1' : '0'], { encoding: 'utf8' });
const kb = (fs.statSync(destino).size / 1024).toFixed(1);

console.log(`  ✓ ${path.relative(ROOT, destino)}  (${kb} KB · recorte ${salida.trim()})`);
console.log(`    Ya está en la ruta que esperan la órbita y los comparadores: no hay que tocar código.`);
