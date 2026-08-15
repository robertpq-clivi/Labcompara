# Medcompara

Comparador de precios de salud en México, en **medcompara.com.mx**. Tres verticales:

| Ruta | Qué compara | Fuente de datos |
|---|---|---|
| `/laboratorio` | ~620 estudios entre 6 laboratorios | `data/precios.json` |
| `/glp1` | 16 presentaciones de 4 tratamientos GLP-1 | `data/medicamentos/prices.json` |
| `/medicinas` | ~200 medicamentos de farmacia | `data/medicinas/prices.json` |

Sitio estático: HTML plano, sin framework ni build. Vercel sirve el repo tal cual.

---

## La regla que ordena todo el repo

**Ninguna cifra de precio se escribe a mano.** Ni en el HTML, ni en el copy, ni en
una FAQ, ni en un JSON-LD.

No es purismo. El scan corre cada semana y los precios se mueven: una cifra escrita
a mano envejece sola y termina contradiciendo a la tabla de su propia página. Ya
pasó — la página de biometría hemática anunció «desde $95» durante meses mientras
el scan decía $115, y la guía de dosis de Mounjaro prometía $4,890 cuando la
farmacia más barata cobraba $7,750.

Cómo se sostiene:

1. El copy vive en JSON con `{{TOKENS}}`; el generador los resuelve contra el scan.
2. Cada generador **valida antes de escribir** y rechaza `$N` o `N%` en el copy.
   Si algo falla, no escribe nada: mejor no publicar que publicar la mitad.
3. `scripts/test-feed.js → revisarCifras()` revisa las páginas a mano y revienta
   si una afirmación se quedó atrás del catálogo.
4. `scripts/sanear-precios-guias.js` encuentra cifras a mano en las guías.

Si necesitas publicar un número que no viene del scan, protégelo con un test —
como el «hasta 35% menos» del hero de GLP-1, que falla si el ahorro real baja de
esa cifra.

---

## Estructura

```
index.html          landing
pages/              los tres comparadores + páginas SEO
blog/               179 artículos (55 generados, el resto a mano)
data/               salida del scan — nunca se edita a mano
scripts/            scan, generadores, tests
scripts/lib/        hechos de precio por vertical
images/farmacias/   logos de farmacia
images/laboratorios/ logos de laboratorio
```

Las rutas limpias salen de `vercel.json` (`cleanUrls`, 14 rewrites, 6 redirects).
`pages/foo.html` se sirve como `/foo`.

---

## El ciclo semanal

Domingo 13:00 UTC (~07:00 CDMX), `.github/workflows/scrape-prices.yml`:

```
tests → scan de las 3 verticales → verifica el feed
      → regenera comparativas, medicinas, estudios y GLP-1
      → commitea con [skip ci]
```

**Si agregas un generador, agrégalo también al workflow y a las rutas del
`git add` del bot.** Sin eso, las páginas se congelan en los precios del día que
las generaste — que es exactamente cómo las de laboratorio llegaron a decir 2024.

---

## Generadores

Los cuatro siguen la misma forma: copy en JSON + hechos del scan + validación
estricta + `--apply` para escribir (sin la bandera es dry-run).

| Comando | Escribe | Copy |
|---|---|---|
| `npm run comparativas` | 15 comparativas entre laboratorios | `scripts/comparativas-copy.json` |
| `npm run blog:estudios` | 25 páginas de laboratorio | `scripts/estudios-blog-copy.json` |
| `npm run blog:medicinas` | 10 de medicamento de farmacia | `scripts/medicinas-blog-copy.json` |
| `npm run blog:glp1` | 5 de GLP-1 | `scripts/glp1-blog-copy.json` |

`npm run predeploy` corre los cuatro con `--apply` y regenera los sitemaps.

Tipos de página en `generar-blog-estudios.js`: `estudio`, `canasta`, `ranking`,
`guia` y `labs`. Todos comparten esqueleto: la respuesta arriba, tablas, por qué
varía, CTA, y sólo después el contenido de fondo — quien busca «paracetamol
precio» quiere el número, no un ensayo.

### El mes en el título

Sale de la **fecha del scan**, nunca de `new Date()`. Un título que dice «agosto
2026» sobre precios de junio promete una frescura que la página no tiene.

---

## Cosas que no son obvias

- **Farmacias y planes no se comparan de frente.** Clivi y Revert incluyen consulta
  y seguimiento; ponerlos en la misma columna de «más caro» que una caja de
  farmacia sería mentir por omisión. `lib/glp1-blog.js` los separa.
- **Las capas del hero van dentro de `#hero-top`.** Si cuelgan de la sección, el
  degradado `.fade` se estira sobre toda la página y la pinta de negro al bajar.
- **`AggregateOffer` sólo donde hay un precio real.** El ranking y las guías no lo
  declaran: inventarles un rango sería describir una oferta que nadie vende.
- **Las tablas van en `.tabla-scroll`.** El 77% del tráfico es móvil y una tabla de
  seis columnas empuja el ancho de la página entera.
- **Concordancia de género en los encabezados generados**: el copy trae `articulo`
  («la biometría hemática», «un check up», «el paracetamol»).

---

## Logos

`node scripts/colocar-logo.js <archivo> <clave> [modo]` recorta, cuadra, escala a
256 px y lo deja en la carpeta correcta. Modos: `--isotipo` (lockup con nombre al
lado), `--tono` (dos colores, el segundo es texto que sobra), `--circulo` (avatar
con fondo de color), o ninguno.

Las rutas de los logos que aún no existen están declaradas en `LAB_LOGO` y
`FARM_LOGO`: el `<img>` cae al emoji por `onerror` y **el logo entra solo el día
que el archivo exista**, sin tocar código. Faltan: `polanco-logo.png` y
`prixz-logo.png`.

---

## Flujo de trabajo

- `npm test` antes de cualquier cambio (5 suites).
- Rama + PR, nunca commit directo a `main`.
- Mergear a `main` dispara el despliegue a producción en Vercel.
- Verificar en producción con `curl`, no dar por hecho que salió bien.
- Commits y PRs en español.
