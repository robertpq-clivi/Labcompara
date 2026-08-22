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

Lo mismo vale para **las tarjetas del landing**, que publican un conteo por
vertical. Ahí se colaron unos «200 medicamentos» con 180 en el catálogo, porque
`revisarCifras()` miraba las afirmaciones de «más de N estudios» pero no esas
tres líneas. Ya las mira.

Ese chequeo **sólo revienta cuando el sitio promete de más.** Quedarse corto no
falla a propósito: si fallara, cada ampliación del catálogo tumbaría la corrida
del domingo y con ella el refresco de precios, que importa más que redondear una
cifra de mercadotecnia.

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
| `npm run tarjetas` | las 178 tarjetas de 1200x630 + su marcado | — (título y rubro salen del HTML) |
| `node scripts/completar-marcado-blog.js` | `Article`, `BreadcrumbList`, `author` y fechas que falten | — (fechas de git) |

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

## Rich snippets

**El JSON-LD de `FAQPage` se queda, y no cuenta como rich snippet.** Lo declaran
190 de las 194 páginas del sitio — los 178 artículos del blog, los 11 de `pages/`
y la landing, 868 preguntas en total — pero Google dejó de mostrar FAQ
rich results en la búsqueda el **7 de mayo de 2026**, y desde septiembre de 2023
ya sólo se los daba a sitios de gobierno y salud reconocidos como autoridad. Un
comparador de precios nunca entró en esa lista, y Search Console lo confirma: la
primera impresión del sitio es del **30 de mayo de 2026**, veintitrés días después
del apagón. No hay «antes» — estas páginas nunca mostraron el rich result que
marcan, y no lo perdieron.

No se borra. Google dice que el structured data sin uso no causa problemas,
`FAQPage` sigue siendo un tipo válido de schema.org, y Bingbot, DuckDuckGo y los
crawlers de RAG lo siguen leyendo. Son 233 KB de los 3.6 MB de HTML: borrarlo
compra bytes y pierde superficie fuera de Google.

Lo que cambia es el tablero. Los rich results que este sitio puede ganar son
`BreadcrumbList` — el único que funciona hoy — y `Product` + `AggregateOffer`,
que está marcado en 36 páginas pero no renderiza porque le falta `image`. Ésos
son los enhancement reports que se vigilan en Search Console. Si el de FAQ
aparece vacío no es un bug: Google lo retiró junto con el soporte en el Rich
Results Test.

**Cada artículo tiene una tarjeta de 1200x630 en `images/blog/<slug>.png`.** No es
decoración: `Article` y `Product` necesitan `image` o Google no arma el rich
result, y el blog no tenía ni una etiqueta `<img>`. `npm run tarjetas:apply`
las dibuja con Pillow y conecta el marcado.

**La tarjeta no lleva cifras, a propósito.** `revisarCifras()` lee HTML; no puede
leer un PNG. Un precio horneado en la imagen sería el único número del repo que
ningún test vigila, y envejecería solo cada domingo mientras la tabla de su
propia página se actualiza. El generador rechaza cualquier texto con `$N` o `N%`
antes de dibujar.

Consecuencia buena: la tarjeta no caduca. Se genera una vez y se commitea; el
ciclo semanal no la toca y el workflow no necesita Pillow ni la fuente. Lo que
sí pasa cada domingo es que los generadores reescriben 57 de estos HTML, así que
el `image` vive en los generadores y en las dos plantillas de
`scripts/plantillas/` — no parchado a mano. `test-marcado-blog.js` falla si
alguien se lo lleva de paso.

**Las preguntas del bloque FAQ son `<h3 class="faq-q" id="...">`, no divs.** Las 868
estaban en divs. Un div no entra al esquema de encabezados, no es candidato de
featured snippet y no puede ser destino de un enlace; un h3 con ancla es las
tres cosas. El `id` sale de `scripts/lib/ancla.js`, compartido con los
generadores: si las dos fórmulas se separan, cada domingo el ciclo semanal
reescribe los `id` de las 56 páginas generadas y todo enlace a una sección
apunta a la nada, sin error visible.

La regla `.faq-q` fija `margin:0 0 8px` por eso mismo: un h3 heredaría el
`margin-top:24px` global y abriría un hueco dentro de la caja. Verificado con
un diff de píxeles — el bloque se ve idéntico al que era con divs.

**Sobre el largo de las respuestas: el conteo de palabras es la métrica
equivocada.** Parecía que la mediana de 19 palabras era el problema, pero en las
páginas que tienen tráfico —todas generadas— la respuesta corta es la correcta:
«¿Necesito ayuno para la vitamina D? → No. Puede tomarse a cualquier hora y sin
ayuno» son nueve palabras y no le falta ninguna. Alargarla sería relleno.

Lo que sí mide algo es si la pregunta **nombra su sujeto**. «¿Cuántas veces por
semana?» o «¿La fruta sacia?» dependen del artículo que las rodea: como
encabezado no ganan nada y como ancla (`#la-fruta-sacia`) no significan nada.
Ya se arreglaron las dos tandas. En las **generadas**, en los cuatro
`*-copy.json` con `{{LAB_A}}`/`{{LAB_B}}` en las comparativas, para que los
nombres sigan saliendo del scan. En las **escritas a mano**, 217 preguntas en 102
páginas, directo en el HTML — y ahí hay que tocar los **dos** lugares donde vive
la pregunta: el `<h3>` visible y el `Question.name` del JSON-LD. Si se separan,
el marcado le promete a Google una pregunta que la página no tiene;
`test-marcado-blog.js` lo vigila.

Ninguna respuesta se tocó en esa pasada: sólo la pregunta. Es contenido de salud
y reformular una respuesta es otra decisión, con otro revisor.

Las FAQ visibles sí siguen sirviendo — para el usuario, para featured snippets y
para que los motores de IA citen la respuesta — pero eso se gana con el HTML, no
con el marcado.

---

## Tablas en móvil

**Toda tabla va envuelta en `.tabla-scroll`, y la regla vive en
`scripts/lib/tabla-movil.js`.** Estaba copiada en tres generadores, faltaba en
`generar-comparativas.js` y no existía en ninguna de las 42 páginas escritas a
mano: 81 tablas en 65 archivos sin envoltorio ni regla.

El envoltorio sin la regla no hace nada, y la regla sin el envoltorio tampoco:
la función pone las dos o ninguna. Cubre las tres clases de tabla del sitio
—`price-table`, `table` y `cmp-table`—, porque una tabla sin clase desborda
igual.

La llaman los cuatro generadores sobre el HTML ya armado, como `conIndice`.

---

## Tipografía

**Montserrat en todo el sitio.** `comparativa-head.html` era el último resto de
GLPcompara: cargaba Sora + DM Sans y le daba otra tipografía a 15 páginas.

Cuidado con el orden si se vuelve a tocar: cambiar el CSS de los HTML sin
cambiar la plantilla no sirve de nada — el domingo el generador lo revierte. Pasó.

---

---

## Índice y jump links

Los «jump links» —los enlaces a secciones debajo del resultado de Google— piden
dos cosas: secciones con ancla descriptiva y una tabla de contenidos que las
enlace. Y una tercera que no es marcado: **la página tiene que ser larga y
multi-tema.** Un artículo de 400 palabras no los va a recibir por mucha ancla
que le pongamos, y un índice de dos renglones sólo empuja el contenido hacia
abajo.

De ahí los umbrales de `scripts/lib/indice-articulo.js`: **900 palabras y 4
secciones**. Los cumplen 38 de los 178. Los otros 140 no llevan índice a
propósito.

`conIndice()` corre sobre el HTML ya armado y la llaman los dos lados: los
cuatro generadores, justo antes de escribir, y la pasada de una sola vez sobre
los artículos a mano. Reconstruye el índice en vez de acumularlo, así que si
cambian las secciones el índice las sigue.

**`.toc` declara `display:block` y `position:static` a propósito.** La hoja del
sitio trae `nav{display:flex;position:sticky}` para la barra superior, y un
`<nav>` hereda de ahí: sin esos dos overrides el título del índice se va al
costado de la lista. Se vio en un render, no en el código.

---

## Fechas del marcado

`datePublished` y `dateModified` de los artículos a mano salen de **git** —el
commit que dio de alta el archivo y el último anterior a la pasada de marcado—,
nunca de `new Date()`.

Y las que ya existían no se tocaron. Un `dateModified` de hoy sobre un texto que
nadie reescribió es una promesa de frescura falsa, y así trata Google los
cambios de fecha sin cambio de contenido.

---

## Logos

### El logo de la marca

No había. `favicon.svg` era un emoji 🧬 dentro de un `<text>` y `favicon.png`
medía 32x32 — nada que sirviera para `publisher.logo` ni para un icono de app.
`npm run logo:apply` genera tres piezas del lockup que ya vive en el nav y en
las 178 tarjetas del blog:

| Archivo | Para qué |
|---|---|
| `images/logo-medcompara-512.png` | `publisher.logo`, `Organization.logo`, `apple-touch-icon` |
| `favicon.svg` | el monograma, lo que ve la pestaña |
| `favicon.png` | el monograma a 32x32, respaldo sin SVG |

**Son dos piezas distintas a propósito.** Una pestaña dibuja el icono a 16-32 px
y ahí un wordmark de diez letras es una manchita ilegible; la «M» sola sí se lee.
El de 512 con el nombre es para los contextos grandes.

**El monograma del SVG va en `path`, no en `<text>`.** Un `font-family` dentro de
un SVG se resuelve contra las fuentes de quien mira, y Montserrat no está en la
mayoría de las máquinas: el icono saldría en Times.

Los `<link rel="icon">` son **rutas absolutas** (`/favicon.svg`). Antes eran
`../favicon.svg`, que funcionaba de casualidad —desde `/blog/slug` y desde
`/foo` el `..` topa con la raíz— y se rompería el día que exista un nivel más.

### Logos de laboratorios y farmacias


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
