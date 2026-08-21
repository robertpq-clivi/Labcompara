#!/usr/bin/env node
/**
 * Medcompara — El logo de marca, en los tamaños que piden los estándares.
 *
 *   node scripts/generar-logo.js            # dry-run
 *   node scripts/generar-logo.js --apply    # escribe
 *
 * El repo no tenía logo. `favicon.svg` era un emoji 🧬 dentro de un `<text>` y
 * `favicon.png` medía 32x32 — nada que sirviera para `publisher.logo` ni para
 * un icono de app. No se inventa una identidad nueva: se renderiza el lockup
 * que ya vive en el nav del sitio y en las 178 tarjetas del blog («Med» en
 * blanco, «compara» en teal claro, sobre el navy de marca, con la órbita).
 *
 * Salen dos piezas, porque cumplen cosas distintas:
 *
 *   images/logo-medcompara-512.png   512x512, con el nombre. Para
 *                                    `publisher.logo`, `apple-touch-icon` y
 *                                    el icono de PWA — contextos grandes.
 *
 *   favicon.png                      El monograma a 32x32, respaldo para lo
 *                                    que no dibuja SVG.
 *
 *   favicon.svg                      El monograma. Una pestaña de navegador
 *                                    dibuja el icono a 16-32 px y ahí un
 *                                    wordmark de diez letras es una manchita
 *                                    ilegible. La «M» sí se lee.
 *
 * El monograma va en SVG con `path`, no con texto: un `font-family` en un SVG
 * se resuelve contra las fuentes de quien mira, y Montserrat no está en la
 * mayoría de las máquinas.
 *
 * El trabajo de imagen va en Python porque Pillow ya está instalado — el mismo
 * arreglo que usan `colocar-logo.js` y `generar-tarjetas-blog.js`.
 */

const { execFileSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT   = path.join(__dirname, '..');
const FUENTE = process.env.MEDCOMPARA_FUENTE ||
  path.join(process.env.HOME || '', 'Library', 'Fonts', 'Montserrat[wght].ttf');
const APLICAR = process.argv.includes('--apply');

const NAVY = '#06142A', NAVY_MID = '#183f5e', TEAL = '#00547c', TEAL_LIGHT = '#79C5E2';

const PY = `
import sys
from PIL import Image, ImageDraw, ImageFont

destino, ttf, navy, navy_mid, teal, teal_light = sys.argv[1:7]
S = 512
ESCALA = 4  # se dibuja en grande y se reduce: bordes sin escalera

def rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

NAVY, NAVY_MID, TEAL, TEAL_LIGHT = rgb(navy), rgb(navy_mid), rgb(teal), rgb(teal_light)
W = S * ESCALA

def peso(px, nombre):
    f = ImageFont.truetype(ttf, px)
    f.set_variation_by_name(nombre)
    return f

im = Image.new('RGB', (W, W), NAVY)
d = ImageDraw.Draw(im)

# Degradado diagonal, la misma dirección que las tarjetas del blog.
for y in range(W):
    t = y / (W - 1)
    d.line([(0, y), (W, y)],
           fill=tuple(round(NAVY[i] + (NAVY_MID[i] - NAVY[i]) * t) for i in range(3)))

# La órbita, insinuada desde la esquina inferior derecha.
capa = Image.new('RGBA', (W, W), (0, 0, 0, 0))
dc = ImageDraw.Draw(capa)
cx = cy = int(W * 0.92)
for r, a in ((0.62, 30), (0.46, 40), (0.30, 52)):
    rr = int(W * r)
    dc.ellipse([cx - rr, cy - rr, cx + rr, cy + rr],
               outline=TEAL_LIGHT + (a,), width=3 * ESCALA)
im = Image.alpha_composite(im.convert('RGBA'), capa).convert('RGB')
d = ImageDraw.Draw(im)

# La «M» grande, que es lo que se lee cuando el icono va chico.
f_m = peso(int(W * 0.46), 'ExtraBold')
m_w = d.textlength('M', font=f_m)
caja = d.textbbox((0, 0), 'M', font=f_m)
d.text(((W - m_w) / 2, W * 0.30 - (caja[3] - caja[1]) / 2 - caja[1]),
       'M', font=f_m, fill=(255, 255, 255))

# El nombre debajo: «Med» blanco + «compara» en teal claro, como el nav.
f_n = peso(int(W * 0.088), 'Bold')
a, b = 'Med', 'compara'
total = d.textlength(a, font=f_n) + d.textlength(b, font=f_n)
x = (W - total) / 2
y = W * 0.63
d.text((x, y), a, font=f_n, fill=(255, 255, 255))
d.text((x + d.textlength(a, font=f_n), y), b, font=f_n, fill=TEAL_LIGHT)

# Regla de acento, centrada, como el pie de las tarjetas.
ancho = int(W * 0.15)
d.rectangle([(W - ancho) / 2, W * 0.755, (W + ancho) / 2, W * 0.755 + 5 * ESCALA],
            fill=TEAL_LIGHT)

im.resize((S, S), Image.LANCZOS).save(destino, 'PNG', optimize=True)
print(destino)
`;


const MONOGRAMA_PY = `
import sys
from PIL import Image, ImageDraw
destino, navy = sys.argv[1], sys.argv[2]
S, E = 32, 16                       # se dibuja a 512 y se reduce
def rgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i+2],16) for i in (0,2,4))
W = S * E
im = Image.new('RGBA', (W, W), (0,0,0,0))
d = ImageDraw.Draw(im)
d.rounded_rectangle([0,0,W-1,W-1], radius=int(W*0.22), fill=rgb(navy))
# La misma «M» del SVG, a escala: 22,76 → 50,56 → 78,26 → 78,76
p = [(0.22,0.76),(0.22,0.26),(0.50,0.56),(0.78,0.26),(0.78,0.76)]
d.line([(x*W, y*W) for x, y in p], fill=(255,255,255), width=int(W*0.13), joint='curve')
r = int(W*0.065)
for x, y in (p[0], p[-1]):
    d.ellipse([x*W-r, y*W-r, x*W+r, y*W+r], fill=(255,255,255))
im.resize((S,S), Image.LANCZOS).save(destino, 'PNG', optimize=True)
print(destino)
`;

/** El monograma de la pestaña: navy y una «M» dibujada con path. */
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="${NAVY}"/>
  <path d="M22 76V26l28 30 28-30v50" fill="none" stroke="#fff"
        stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;

function main() {
  const destino = path.join(ROOT, 'images', 'logo-medcompara-512.png');

  if (!APLICAR) {
    console.log('Dry-run. Se escribirían:');
    console.log(`  images/logo-medcompara-512.png   512x512, con el nombre`);
    console.log(`  favicon.svg                      el monograma (${SVG.length} bytes)`);
    console.log(`  favicon.png                      el monograma a 32x32`);
    console.log('\nCorre con --apply para escribir.');
    return;
  }

  if (!fs.existsSync(FUENTE)) {
    console.error(`No encuentro Montserrat en ${FUENTE}.`);
    console.error('Instálala o apunta MEDCOMPARA_FUENTE al .ttf.');
    process.exit(1);
  }

  execFileSync('python3', ['-c', PY, destino, FUENTE, NAVY, NAVY_MID, TEAL, TEAL_LIGHT],
    { stdio: 'inherit' });
  fs.writeFileSync(path.join(ROOT, 'favicon.svg'), SVG);
  console.log('favicon.svg (monograma)');
  execFileSync('python3', ['-c', MONOGRAMA_PY, path.join(ROOT, 'favicon.png'), NAVY],
    { stdio: 'inherit' });
}

main();
