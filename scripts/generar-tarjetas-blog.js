#!/usr/bin/env node
/**
 * Medcompara — Una tarjeta de 1200x630 por artículo del blog.
 *
 * Existe por una razón concreta: `Article` y `Product` necesitan `image` para
 * que Google pueda renderizar el rich result, y el blog no tenía ni una sola
 * etiqueta `<img>`. Sin imagen no hay thumbnail, y sin thumbnail el resultado
 * compite desnudo contra los que sí lo tienen.
 *
 *   node scripts/generar-tarjetas-blog.js            # dry-run, no escribe
 *   node scripts/generar-tarjetas-blog.js --apply    # escribe images/blog/
 *
 * **La tarjeta no lleva precios, y eso es a propósito.** `revisarCifras()` lee
 * HTML; no puede leer un PNG. Una cifra horneada en la imagen sería el único
 * número del repo que ningún test puede vigilar, y envejecería sola cada
 * domingo mientras la tabla de su propia página se actualiza. Por eso el
 * validador de abajo rechaza cualquier texto con `$N` o `N%` antes de dibujar.
 *
 * Consecuencia buena de no llevar cifras: la tarjeta no caduca. Se genera una
 * vez y se commitea; el scan semanal no la toca y el workflow no necesita
 * Pillow ni la fuente. Si algún día se quiere el precio encima, hay que
 * mover esto al ciclo semanal y darle un test que lea el PNG.
 *
 * El trabajo de imagen va en Python porque Pillow ya está instalado — el mismo
 * arreglo que usa `colocar-logo.js`.
 */

const { execFileSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT    = path.join(__dirname, '..');
const BLOG    = path.join(ROOT, 'blog');
const DESTINO = path.join(ROOT, 'images', 'blog');
const FUENTE  = process.env.MEDCOMPARA_FUENTE ||
  path.join(process.env.HOME || '', 'Library', 'Fonts', 'Montserrat[wght].ttf');

const APLICAR = process.argv.includes('--apply');

// Las mismas de la hoja de estilo del blog. Si cambia la paleta del sitio,
// cambia aquí o las tarjetas quedan de otro color que las páginas.
const PALETA = {
  navy:      '#06142A',
  navyMid:   '#183f5e',
  teal:      '#00547c',
  tealLight: '#79C5E2',
};

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodificar(s) {
  return s
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g,           (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g,      (_, n) => (n in ENTIDADES ? ENTIDADES[n] : `&${n};`));
}

function texto(html, re) {
  const m = html.match(re);
  return m ? decodificar(m[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() : '';
}

// El guardián de la regla del repo: ninguna cifra entra a un PNG.
const CIFRA = /(\$\s?\d|\d+\s?%)/;

function recolectar() {
  const archivos = fs.readdirSync(BLOG)
    .filter(f => f.endsWith('.html') && f !== 'index.html')
    .sort();

  const trabajos = [], problemas = [];

  for (const archivo of archivos) {
    const html  = fs.readFileSync(path.join(BLOG, archivo), 'utf8');
    const slug  = archivo.replace(/\.html$/, '');
    const h1    = texto(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const rubro = texto(html, /class="article-eyebrow"[^>]*>([\s\S]*?)<\/div>/i);

    if (!h1) { problemas.push(`${archivo}: sin <h1>, no hay qué dibujar`); continue; }
    if (CIFRA.test(h1) || CIFRA.test(rubro)) {
      problemas.push(`${archivo}: el texto trae una cifra ("${CIFRA.exec(h1 + ' ' + rubro)[0]}") y las tarjetas no llevan cifras`);
      continue;
    }

    trabajos.push({
      slug,
      titulo: h1,
      // 6 artículos no traen rubro; la marca de agua de abajo ya dice el sitio,
      // así que el rubro genérico sólo repite la sección.
      rubro: rubro || 'Blog · Medcompara',
      destino: path.join(DESTINO, `${slug}.png`),
    });
  }

  return { trabajos, problemas };
}

const PY = `
import json, sys
from PIL import Image, ImageDraw, ImageFont

trabajos = json.load(open(sys.argv[1]))
fuente_ttf, navy, navy_mid, teal, teal_light = sys.argv[2:7]

W, H, PAD = 1200, 630, 72

def rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

NAVY, NAVY_MID, TEAL, TEAL_LIGHT = rgb(navy), rgb(navy_mid), rgb(teal), rgb(teal_light)

def peso(px, nombre):
    f = ImageFont.truetype(fuente_ttf, px)
    f.set_variation_by_name(nombre)
    return f

def ancho(f, s):
    return f.getlength(s)

def espaciado(d, xy, s, f, fill, extra):
    """Pillow no tiene letter-spacing; el rubro lo necesita para leerse en
    mayúsculas a tamaño chico."""
    x, y = xy
    for ch in s:
        d.text((x, y), ch, font=f, fill=fill)
        x += ancho(f, ch) + extra
    return x

def ancho_espaciado(f, s, extra):
    return sum(ancho(f, c) + extra for c in s) - extra if s else 0

def envolver(f, s, limite):
    lineas, actual = [], ''
    for palabra in s.split():
        prueba = (actual + ' ' + palabra).strip()
        if ancho(f, prueba) <= limite or not actual:
            actual = prueba
        else:
            lineas.append(actual); actual = palabra
    if actual: lineas.append(actual)
    return lineas

def fondo():
    """Degradado del navy de la marca, con la órbita del sitio insinuada abajo
    a la derecha. Se dibuja en 4x y se reduce: los arcos quedan sin escalera."""
    im = Image.new('RGB', (W, H), NAVY)
    d = ImageDraw.Draw(im)
    for y in range(H):
        t = y / (H - 1)
        d.line([(0, y), (W, y)],
               fill=tuple(round(NAVY[i] + (NAVY_MID[i] - NAVY[i]) * t) for i in range(3)))

    S = 4
    capa = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))
    dc = ImageDraw.Draw(capa)
    cx, cy = int(W * 0.92) * S, int(H * 0.78) * S
    for r, a in ((330, 26), (250, 34), (170, 44)):
        dc.ellipse([cx - r * S, cy - r * S, cx + r * S, cy + r * S],
                   outline=TEAL_LIGHT + (a,), width=3 * S)
    dc.ellipse([cx - 52 * S, cy - 52 * S, cx + 52 * S, cy + 52 * S], fill=TEAL + (70,))
    im = Image.alpha_composite(im.convert('RGBA'),
                               capa.resize((W, H), Image.LANCZOS)).convert('RGB')
    return im

for t in trabajos:
    im = fondo()
    d  = ImageDraw.Draw(im)
    limite = W - PAD * 2

    # Marca, arriba: "Med" blanco + "compara" en teal claro, como el logo del nav.
    marca = peso(38, 'Bold')
    x = PAD
    d.text((x, PAD), 'Med', font=marca, fill=(255, 255, 255))
    x += ancho(marca, 'Med')
    d.text((x, PAD), 'compara', font=marca, fill=TEAL_LIGHT)

    # Rubro, en mayúsculas y espaciado.
    f_rubro = peso(21, 'SemiBold')
    rubro = t['rubro'].upper()
    while ancho_espaciado(f_rubro, rubro, 2.4) > limite and f_rubro.size > 13:
        f_rubro = peso(f_rubro.size - 1, 'SemiBold')
    y_rubro = PAD + 132
    espaciado(d, (PAD, y_rubro), rubro, f_rubro, TEAL_LIGHT, 2.4)

    # Título: arranca grande y baja hasta caber en 4 líneas sin tocar el pie.
    tope = H - PAD - 78
    for px in range(70, 33, -2):
        f_t = peso(px, 'ExtraBold')
        lineas = envolver(f_t, t['titulo'], limite)
        alto = len(lineas) * round(px * 1.18)
        if len(lineas) <= 4 and y_rubro + 54 + alto <= tope:
            break

    y = y_rubro + 54
    for linea in lineas:
        d.text((PAD, y), linea, font=f_t, fill=(255, 255, 255))
        y += round(f_t.size * 1.18)

    # Pie: regla de acento y el dominio.
    d.rectangle([PAD, H - PAD - 34, PAD + 104, H - PAD - 29], fill=TEAL_LIGHT)
    d.text((PAD, H - PAD - 20), 'medcompara.com.mx',
           font=peso(22, 'Medium'), fill=(255, 255, 255, 255))

    im.save(t['destino'], 'PNG', optimize=True)

print(len(trabajos))
`;

function main() {
  const { trabajos, problemas } = recolectar();

  if (problemas.length) {
    console.error('Nada se escribió. Arregla esto primero:\n');
    problemas.forEach(p => console.error('  ✗ ' + p));
    process.exit(1);
  }

  console.log(`${trabajos.length} artículos con título y rubro listos.`);

  if (!APLICAR) {
    console.log('\nDry-run. Muestra de lo que se dibujaría:\n');
    trabajos.slice(0, 3).forEach(t =>
      console.log(`  ${t.slug}.png\n    rubro:  ${t.rubro}\n    título: ${t.titulo}`));
    console.log(`\n  ... y ${trabajos.length - 3} más.`);
    console.log('\nCorre con --apply para escribir en images/blog/.');
    return;
  }

  if (!fs.existsSync(FUENTE)) {
    console.error(`No encuentro la fuente en ${FUENTE}.`);
    console.error('Montserrat es la fuente de la marca. Instálala o apunta MEDCOMPARA_FUENTE al .ttf.');
    process.exit(1);
  }

  fs.mkdirSync(DESTINO, { recursive: true });
  const lista = path.join(require('os').tmpdir(), `tarjetas-${process.pid}.json`);
  fs.writeFileSync(lista, JSON.stringify(trabajos));

  try {
    const salida = execFileSync('python3', ['-c', PY, lista, FUENTE,
      PALETA.navy, PALETA.navyMid, PALETA.teal, PALETA.tealLight], { encoding: 'utf8' });
    console.log(`\n${salida.trim()} tarjetas escritas en images/blog/.`);
  } finally {
    fs.unlinkSync(lista);
  }
}

main();
