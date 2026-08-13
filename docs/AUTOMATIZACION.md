# Automatización de precios

Cómo Medcompara mantiene los precios al día sin que nadie los capture a mano.

---

## 1. Cómo funciona

Misma infraestructura que GLPcompara: **GitHub Actions con cron + Zyte como
proveedor anti-bloqueo**, commiteando los datos de vuelta al repo para que el
deploy los publique.

```
   cron domingo 07:00 CDMX
            │
            ▼
  ┌──────────────────────────────────────────────────────┐
  │ .github/workflows/scrape-prices.yml                  │
  │   SCRAPER_API_KEY (secret) · SCRAPER_PROVIDER = zyte │
  │                                                      │
  │   scan-labs.js       6 labs      → el mismo estudio   │
  │   scan-farmacias.js  6 fuentes   → la misma dosis     │
  │   scan-medicinas.js  5 farmacias → la misma caja      │
  └──────────────┬───────────────────────────────────────┘
                 │  directo → si el sitio bloquea, escala a Zyte
                 │  un paso por vertical: si una se cae, las otras siguen
                 ▼
  ┌──────────────────────────────────────────────────────┐
  │ data/precios.json           → pages/laboratorio.html │
  │ data/medicamentos/          → pages/medicamentos.html│
  │ data/medicinas/prices.json  → pages/medicinas.html   │
  │ data/*/price-history.json   ← serie temporal          │
  │ data/*/reporte.md           ← qué cambió              │
  └──────────────┬───────────────────────────────────────┘
                 │  git commit + push  →  Vercel redeploya
                 ▼
  ┌──────────────────────────────────────────────────────┐
  │ medcompara.com.mx                                    │
  └──────────────────────────────────────────────────────┘
```

Las tres verticales comparten transporte, parseo de precios e historial. Lo que
cambia en cada una es **la unidad de comparación**, y equivocarla es de donde
salió casi todo error de precio del proyecto: pluma contra frasco, precio de
lista contra precio de venta, caja de 7 contra caja de 120.

El Apps Script sigue existiendo pero **solo para leads**
([`scripts/medcompara-apps-script.gs`](../scripts/medcompara-apps-script.gs)),
igual que en GLPcompara. Los precios no pasan por Sheets.

### El proxy solo se usa cuando hace falta

En GLPcompara cada fuente se asigna a mano a "directo" o "por Zyte". Aquí la
escalada es **automática**: se pide directo y solo se reintenta por Zyte si el
sitio responde como si estuviera bloqueando (403, 429, 503, reto de Cloudflare,
error de red). Dos razones:

1. 5 de los 6 laboratorios responden directo hoy. Mandarlos por Zyte gastaría
   ~4,200 requests de crédito por corrida para nada.
2. Si mañana alguno empieza a bloquear, el scan se cura solo en vez de devolver
   cero y dejar la columna congelada hasta que alguien lo note.

OLAB es la excepción: va con `proxy: true` desde el arranque porque está detrás
de Cloudflare y un runner de GitHub sale con IP de datacenter, justo lo que ese
tipo de protección filtra.

Al final de cada corrida el log dice cuántos requests fueron directos, cuántos
por Zyte y cuántos escalaron por bloqueo.

---

## 2. De dónde sale el precio de cada laboratorio

Esto es lo que hace frágil o robusto a cada adaptador. Vale la pena leerlo antes
de tocar el código.

Medido en la corrida del 13 de agosto de 2026 (**6,188 estudios, 0 errores**):

| Laboratorio | Plataforma | Ruta del precio | Requests | Catálogo | Cruzados con los 124 |
|---|---|---|---:|---:|---:|
| **Salud Digna** | Next.js + API propia | `api.emarketingsd.org/Citas/Citas2/SubEstudiosPorSucursalPP` | **1** | 580 | 57 |
| **Polanco** | BigCommerce + SYNLAB | `booking.global.synlabaccess.health/…/get-partner-price-info` | **15** | 1,448 | 71 |
| **Labbe** | Sitio propio (Laravel) | HTML, `div.precio_gral` de cada ficha | 1,096 | 1,067 | 69 |
| **Chopo** | Magento 2 | HTML, `.price__value--special` / `#old-price-*` | 1,628 | 1,601 | 61 |
| **LAPI** | Odoo eCommerce | HTML, `.oe_default_pric2` | 1,492 | 1,492 | 79 |
| **OLAB** | Nuxt | genérico: sitemap → JSON-LD `offers.price` | 3,077 | 2,077 | 61 |

El efecto sobre el comparador: antes 46 de los 124 estudios tenían precio de un
solo laboratorio; ahora solo 6. Los que tienen los 6 labs pasaron de 7 a 16.

Detalles que cuestan tiempo redescubrir:

- **Salud Digna** — su web pública es un export estático sin datos; los precios
  viven en la API de la app de citas. `estudio[id]=2` es LABORATORIO y
  `sucursal[id]=1` la sucursal de referencia. Un solo GET devuelve el catálogo
  completo con `Precio`. El endpoint hermano `SubEstudiosPorSucursal` (sin `PP`)
  devuelve **un** resultado, no sirve.
- **Polanco** — el HTML muestra `$0.00` en todo: el precio depende de la sucursal
  y se carga después. La API de SYNLAB devuelve
  `{ onlineDiscountPercent, prices: { SKU: { originalPrice, loyaltyPrice } } }`.
  Usamos `originalPrice` menos el descuento por pago en línea (10%);
  `loyaltyPrice` es el Programa de Beneficios y **no** es comparable con el
  precio público de los demás. El SKU se cruza con el catálogo de BigCommerce,
  que pagina de 100 en 100 y responde 404 al pasarse de la última página.
- **Labbe** — el `<h1>` y el `<h3 class="titulo_covid">` de la plantilla siempre
  dicen "LABORATORIO". El nombre real del estudio está en `og:title`.
- **Chopo** — hay tres precios: `#old-price-*` (lista), `.price__value--special`
  (en línea, el que usamos) y el `lowPrice` del JSON-LD, que es el mínimo entre
  739 sucursales. Los precios varían por ciudad.
- **LAPI** — Odoo pinta tres precios en la misma ficha con clases que difieren en
  una letra: `oe_default_price2` (tachado, lista), `oe_default_pric2` (en línea,
  el que usamos) y `product.price_lapifan` (membresía).

### Nota sobre OLAB

`olab.com.mx/robots.txt` bloquea por nombre a los crawlers de IA —ClaudeBot,
GPTBot, CCBot, Google-Extended, Bytespider, meta-externalagent— mientras que
`User-agent: *` es `Allow: /` con `Content-Signal: search=yes, use=reference`.
MedcomparaBot cae bajo `*`.

El adaptador se escribió sin poder validarlo (el entorno donde se programó cae
bajo el bloqueo por nombre), y la primera corrida real desde GitHub Actions lo
confirmó: 6,043 fichas en el sitemap, 2,077 con precio, **sin necesidad de
proxy**.

Cómo se validó que lee el precio correcto y no cualquier número de la página:
contra los 43 precios de OLAB que estaban capturados a mano, 42 quedaron dentro
de ±2× con una deriva al alza consistente (×1.00–1.24) — justo lo que se espera
de precios de hace meses. El único fuera de rango era una ficha duplicada del
mismo estudio a distinto precio, no un error de extracción.

---

## 3. Puesta en marcha

**Falta un paso, y solo lo puedes hacer tú:** agregar el secret con la clave de
Zyte al repo de Medcompara. GitHub no deja leer el valor de un secret existente,
así que no se puede copiar desde GLPcompara por API.

```bash
# la misma clave que ya usa GLPcompara
gh secret set SCRAPER_API_KEY -R robertpq-clivi/Medcompara
```

O en la web: **Settings → Secrets and variables → Actions → New repository
secret**, nombre `SCRAPER_API_KEY`.

> Si la vas a usar en los dos repos, conviene subirla a nivel de organización
> (**Org settings → Secrets → Actions**) y darle acceso a ambos. Así se rota en
> un solo lugar.

Sin el secret el scan **igual corre**: 5 de los 6 laboratorios responden directo.
Lo que se pierde es OLAB y la red de seguridad si alguno empieza a bloquear.

### Disparar una corrida a mano

```bash
gh workflow run scrape-prices.yml -R robertpq-clivi/Medcompara
gh workflow run scrape-prices.yml -R robertpq-clivi/Medcompara -f dry_run=true    # sin commitear
gh workflow run scrape-prices.yml -R robertpq-clivi/Medcompara -f labs=Labbe,LAPI # solo algunos
gh run watch -R robertpq-clivi/Medcompara
```

El resumen de cada corrida (cobertura por lab, cambios sospechosos) queda en la
pestaña **Summary** del run, y el catálogo crudo como artifact por 30 días.

### El Apps Script (leads)

Solo para el formulario, sin precios:
Hoja nueva → Extensiones → Apps Script → pegar
[`scripts/medcompara-apps-script.gs`](../scripts/medcompara-apps-script.gs) →
Implementar como aplicación web (ejecutar como **Yo**, acceso **Cualquier
persona**).

---

## 4. Operación

**Dónde mirar después de cada corrida:** la pestaña **Summary** del run en
Actions trae las primeras 40 líneas de `data/reporte.md`, que es lo que importa:

| Sección | Qué dice |
|---|---|
| Cobertura por laboratorio | catálogo escaneado, confirmados, arrastrados, errores |
| ⚠️ Cambios sospechosos | saltos de más de 3×, casi siempre un match equivocado |
| Emparejamientos por similitud | los inferidos, con su score, para validar |
| Cambios de precio | todo lo que se movió respecto a la corrida anterior |

**Si un laboratorio devuelve `✗ falló` o cae mucho su catálogo**, la guardia de
sanidad descarta la corrida de ese lab y conserva sus precios previos, así que
el sitio no se rompe. Revisa el adaptador en `scripts/lib/labs.js`.

**Emparejamientos que salen mal** se arreglan sin tocar el algoritmo: agrega el
nombre real del laboratorio a `ALIASES` en
[`scripts/lib/match.js`](../scripts/lib/match.js) bajo el estudio canónico que
le toca, y agrega el caso a `scripts/test-match.js` para que no vuelva.

**Hoja `Historico`** — append-only: cada cambio de precio con su delta. Sirve
para gráficas de evolución y para detectar movimientos raros.

**Alertas automáticas** — un salto de más de 3× en cualquier dirección casi
nunca es una promoción: suele ser un emparejamiento equivocado o un selector
que cambió. El scan los detecta solo y los pone al principio de
`data/reporte.md`, que es lo que aparece en el Summary del run.

### Cortacircuitos por laboratorio

Un sitio que bloquea o se cayó hace que cada request agote su timeout (25s × 3
intentos). Con 1,500 fichas eso son horas, y sin topes un solo laboratorio caído
se lleva la corrida semanal completa.

- **Sonda inicial**: las primeras 25 fichas van sin reintentos. Si menos de 3
  traen precio, se corta ese laboratorio y se conserva su columna anterior.
- **Presupuesto de reloj**: 12 minutos por laboratorio (OLAB, el más grande,
  tarda ~8.5). Al agotarse, el catálogo se marca incompleto en el reporte.
- **Presupuesto global**: 28 minutos para toda la corrida. El tope por
  laboratorio no acota el total —6 labs lentos superarían el timeout, el job
  moriría y **no se commitearía nada**—, así que al agotarse el global los labs
  restantes se omiten y conservan su columna. Publicar parcial siempre gana.
- **Timeout del workflow**: 45 minutos como último recurso.

Medido: la corrida completa tarda ~15 min, casi toda en OLAB (~9.3 min por sus
6,043 fichas). Los otros cinco suman ~5 min.

### Qué pasa con lo que no se pudo emparejar

No se borra. Si un laboratorio tiene el estudio pero con otro nombre, borrar el
precio dejaría un hueco en el comparador por un problema nuestro, no suyo. La
consolidación conserva el valor anterior y lo cuenta como **arrastrado** en el
log. Un número de arrastrados que crece corrida tras corrida es la señal de que
hay que agregar alias.

---

## 5. El scanner local

`scripts/scan-labs.js` corre el mismo pipeline desde tu máquina. Sirve para
depurar un adaptador sin esperar al trigger, y para regenerar el snapshot del
repo.

```bash
node scripts/scan-labs.js                    # todos los labs
node scripts/scan-labs.js --labs=Labbe,LAPI  # solo algunos
node scripts/scan-labs.js --limit=20         # 20 fichas por lab (prueba rápida)
node scripts/scan-labs.js --apply            # además reescribe RAW_DATA en index.html
```

Escribe:

- `data/scan/<lab>.json` — catálogo crudo por laboratorio
- `data/precios.json` — matriz comparada (la que consume el sitio)
- `data/reporte.md` — cobertura por lab y lista de cambios de precio

Los adaptadores viven en `scripts/lib/labs.js` y el emparejador en
`scripts/lib/match.js`. **`medcompara-apps-script.gs` es un espejo de ambos**:
si cambias un selector en uno, cámbialo en el otro.

## 5.1 Tests

```bash
npm test
```

- **`test-match.js`** — 47 casos del emparejador. Emparejar mal no rompe nada
  visiblemente: publica un precio equivocado y se ve igual de normal que uno
  correcto. Cada caso aquí es un fallo real encontrado revisando el scan de los
  6 laboratorios, congelado para que no vuelva: `POLIOMAVIRUS BK POR PCR` no es
  proteína C reactiva, `VITAMINA A` no es `VITAMINA B12`, `Perfil Tiroideo II`
  no es `Perfil Tiroideo`, la "S" de `Proteína S` no es `sanguínea`.
- **`test-feed.js`** — extrae `cargarPrecios()` del `index.html` real y lo corre
  contra un feed bueno, uno corto, uno sin precios, un 500, una red caída y un
  JSON corrupto. En todos los casos malos el sitio tiene que quedarse con
  `RAW_DATA`; nunca mostrar una comparativa a medias.
- **`test-farmacias.js`** — la vertical GLP-1. Aquí los dos errores que reportó
  el cliente están congelados: en Guadalajara el precio bueno es el de la caja
  `.sales` y no el primero que aparece (el de lista), y en Mounjaro se compara
  KwikPen contra KwikPen, nunca pluma contra frasco.
- **`test-medicinas.js`** — la vertical de farmacia general: lectura de
  presentaciones, integridad del catálogo, y un candado sobre la página, que a
  diferencia de las otras dos lee su feed en tiempo de carga (ids, logos del
  orbit, rutas en `vercel.json` y forma del JSON).

---

## 5.2 Ampliar el catálogo de estudios

El scan semanal **refresca** precios; nunca inventa filas. Descubrir estudios
nuevos es una decisión aparte, que conviene revisar a ojo antes de publicar:

```bash
npm run expandir              # reporta qué se agregaría, sin escribir
npm run expandir:apply        # lo aplica a index.html
node scripts/expandir-catalogo.js --min-labs=2   # baja el listón
```

`scripts/lib/agrupar.js` resuelve el problema inverso al del emparejador: en vez
de "¿este nombre es este estudio?", agrupa los ~8,300 nombres de los seis
laboratorios **sin lista de referencia**, y publica los grupos presentes en 3+
laboratorios. Con 2 ya se puede comparar pero apenas; con 3 la fila tiene
sustancia, y como efecto secundario casi todo lo de gabinete (RX, resonancia)
se queda fuera solo porque suele estar en pocos laboratorios.

Los estudios curados a mano no se tocan: sus nombres son las llaves de
`STUDY_INFO` y de las páginas SEO. El descarte de duplicados usa similitud, no
solo igualdad — "Tiempo de Tromboplastina Parcial" y "…(TTP)" son el mismo
estudio, y publicar los dos hacía que compitieran por la misma fila del
laboratorio, dejando a uno con un precio 8× más caro.

## 5.3 La vertical de farmacia general

Los 200 principios activos más buscados en México, en cinco farmacias:
**Ahorro, Benavides, Guadalajara, San Pablo y Prixz**.

La lista sale de un Google Sheet que **crece** —empezó en 100 y ya va en 200—,
así que el catálogo se regenera con un comando en vez de editarse a mano:

```bash
npm run catalogo:medicinas          # reporta qué cambiaría, sin escribir
npm run catalogo:medicinas:apply    # lo aplica
```

Lee `data/medicinas/hoja-origen.csv` (el export tal cual de la hoja) y escribe
`scripts/verticales/medicinas-catalogo.json`. El trabajo no es parsear el CSV
sino que la columna del principio activo mezcla cinco cosas bajo la misma
forma, y confundirlas hace que la farmacia devuelva otra cosa o nada:

| En la hoja | Qué es | Qué se hace |
|---|---|---|
| `Etoricoxib (Arcoxia)` | activo + marca | la marca se guarda como sinónimo |
| `Valproato de sodio / Ácido valproico` | dos nombres del mismo fármaco | uno se publica, el otro es sinónimo |
| `Finasterida / Dutasterida` | dos fármacos distintos | se separan en dos entradas |
| `Levodopa con Carbidopa` | un producto con dos activos | se exigen los dos en el título |
| `Dexametasona oftálmica` | el mismo activo por otra vía | la vía va en la búsqueda, no en el activo |

Las tres primeras tienen la misma forma de texto —`A / B` o `A (B)`— y
significan cosas distintas, así que van en una tabla explícita dentro del
script. Adivinar ahí sería adivinar en silencio.

Guardar las marcas comerciales no es cosmético: media farmacia titula sus
productos por marca y no por activo, y sin el sinónimo la caja de marca nunca
se emparejaría con su genérica — que es justo la comparación que la página
existe para mostrar.

```bash
npm run scan:medicinas
node scripts/scan-medicinas.js --meds=Omeprazol,Paracetamol
node scripts/scan-medicinas.js --limit=20          # los N primeros del ranking
node scripts/scan-medicinas.js --fuentes=Ahorro,Benavides,Prixz
node scripts/scan-medicinas.js --dry              # escanea y reporta sin escribir
```

`--fuentes` existe por una razón práctica: Guadalajara y San Pablo solo
responden por Zyte, y sin `SCRAPER_API_KEY` en local el scan se pasa el rato
esperando sus timeouts. Con las tres directas se valida todo lo demás en
minutos.

### Lo que hace difícil esta vertical

No es el scraping —cuatro de las cinco entregan JSON— sino **decidir qué se
puede comparar con qué**. El mismo principio activo se vende en cajas que no
son intercambiables:

| Producto | Precio | Por cápsula |
|---|---:|---:|
| Omeprazol 20 mg · 7 cápsulas | $54 | $7.71 |
| Omeprazol 20 mg · 120 cápsulas | $161 | $1.34 |

5.7× de diferencia **dentro de la misma farmacia**. Tomar "el más barato" de
cada una compararía una caja de 7 contra una de 120.

Por eso `scripts/lib/presentacion.js` lee de cada título la tupla
`sustancia | mg | forma | piezas`, y esa tupla es la llave: solo se publican
filas donde dos o más farmacias tienen exactamente la misma caja
(`MIN_FARMACIAS = 2` en `scan-medicinas.js`). Un hueco es mejor que un precio
que no corresponde.

### Lo que se descarta, y por qué

Las farmacias mezclan en sus resultados de búsqueda productos que **no son** el
medicamento buscado, y el más caro suele ser el que se cuela:

- **Combinaciones con otro activo.** "Vildagliptina/Metformina 50/850 mg" no es
  metformina: es un antidiabético de marca que cuesta el doble. La primera
  versión del lector leía su primera dosis como si fuera la del principio
  activo y publicaba una "Metformina 50 mg" que no existe, comparada contra
  metformina pura. Se detectan por tres vías —conjunción (`+`, `/`, `y`,
  `con`), doble dosis (`50/850 mg`) y un segundo activo del propio catálogo
  nombrado en el título— porque ninguna de las tres las cubre todas.
- **Títulos sin número de piezas.** Sin caja no hay comparación. Benavides es
  la más afectada: sus títulos suelen omitir el contenido, así que aporta menos
  filas que las otras cuatro.
- **Sustancias que solo comparten raíz.** "Esomeprazol" no es "Omeprazol".

Entre variantes de la *misma* caja —distintas marcas de genérico— se publica la
más barata: es la que el cliente puede ir a comprar. Genérico y marca original
sí se comparan entre sí; esa diferencia es justo la que la página existe para
mostrar.

### Dos comparaciones, no una

Comparar por principio activo responde *"¿dónde está más barato el omeprazol de
20 mg?"*. No responde *"¿dónde está más barata mi Tempra?"* — y para un
medicamento conocido esa es la pregunta que la gente hace: la marca es como lo
conocen. Así que se publican filas de los dos tipos, marcadas con `tipo`:

| `tipo` | Qué compara | Ejemplo |
|---|---|---|
| `sustancia` | lo más barato de cada farmacia con esa caja | Metformina 850mg · 30 tabletas → Ahorro $153 (genérico) · Prixz $393 (Dimefor) |
| `marca` | la misma marca entre farmacias | Dimefor 850mg · 30 tabletas → Ahorro $397 · Prixz $393 |

La fila de sustancia por sí sola engaña: $153 contra $393 parece un abuso
cuando en realidad son dos productos distintos. Por eso cada precio lleva
ahora su marca, y por eso existe la fila de marca al lado.

Una fila de marca que repite exactamente la de su sustancia no se publica:
pasa cuando esa caja solo existe de esa marca, y las dos dirían lo mismo.

### Por qué hacen falta dos pasadas

Buscar "paracetamol" hace que cada farmacia devuelva sobre todo **su propia
línea**: Ahorro contesta con Marca del Ahorro, Prixz con genéricos. Midiéndolo
sobre los 100 primeros: de todas las marcas encontradas, exactamente **una**
aparecía en dos farmacias. Sin una segunda pasada la comparación por marca no
existe.

La pasada 2 toma las marcas que sí aparecieron y las pregunta en las farmacias
donde no salieron. Un detalle que la hace funcionar: Prixz titula "Tempra 160
Mg 30 Tabletas" **sin decir paracetamol**, así que el lector normal lo
rechazaría. Cuando se pregunta explícitamente por una marca, esa marca vale
como evidencia del activo — y no es un supuesto, porque una marca solo llega a
la pasada 2 si en la pasada 1 apareció en un título que sí nombraba el activo.

La marca se exige como palabra completa, no como prefijo: "Temprafen" es
ibuprofeno y con prefijo se habría colado como Tempra.

```bash
node scripts/scan-medicinas.js --sin-marcas        # solo la pasada 1
node scripts/scan-medicinas.js --max-marcas=100    # acota la pasada 2
```

### La página

`pages/medicinas.html` es la única de las tres que **no** lleva los datos
incrustados: pide `data/medicinas/prices.json` al cargar. El scan semanal no
tiene que reescribir el HTML, pero a cambio un cambio de nombre de campo en el
scanner rompería la página sin que nada fallara en el scan — de ahí las pruebas
de forma del feed en `test-medicinas.js`.

---

## 6. Agregar un laboratorio

1. Averigua de dónde sale el precio. En orden de preferencia:
   API JSON pública → JSON-LD en la ficha → HTML con un selector estable.
   Revisa siempre `robots.txt` primero.
2. Agrega el adaptador en `scripts/lib/labs.js`:
   - `modo: 'api'` → implementa `scan(ctx)`, devuelve `[{nombre, precio, …}]`
   - `modo: 'catalogo'` → implementa `urls(ctx)` y `parse(html, url)`
3. Prueba con `node scripts/scan-labs.js --labs=NuevoLab --limit=20` y revisa
   `data/scan/nuevolab.json` a ojo: nombres legibles y precios plausibles.
4. Replica el adaptador en `medcompara-apps-script.gs` → `LABS`.
5. Agrega el id a `LAB_IDS` en ambos archivos y a `LABS` / `LAB_META` en
   `index.html`.

---

## 7. Límites y costos

- **Cero costo.** Apps Script y Sheets en cuenta normal de Google.
- **UrlFetchApp**: 20,000 llamadas/día. Una corrida completa usa ~4,300 → 21%
  de la cuota diaria, una vez por semana.
- **Ejecución**: 6 min por disparo (90 min/día en cuenta gratuita). El scan
  encadena 6–8 disparos de ~4.5 min.
- **Triggers**: máximo 20 por proyecto. El de continuación se borra por id en la
  ejecución siguiente para que no se acumulen.
- **Carga sobre los labs**: lotes de 30 con `fetchAll`, una vez por semana. Es
  menos tráfico del que genera un crawler de buscador en un día.
