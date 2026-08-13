# Automatización de precios

Cómo Labcompara mantiene los precios al día sin que nadie los capture a mano.

---

## 1. Cómo funciona

Misma infraestructura que GLPcompara: **GitHub Actions con cron + Zyte como
proveedor anti-bloqueo**, commiteando los datos de vuelta al repo para que el
deploy los publique.

```
   cron domingo 07:00 CDMX
            │
            ▼
  ┌────────────────────────────────────┐
  │ .github/workflows/scrape-prices.yml│
  │  └─ node scripts/scan-labs.js      │
  │       SCRAPER_API_KEY  (secret)    │
  │       SCRAPER_PROVIDER = zyte      │
  └──────────────┬─────────────────────┘
                 │  directo → si el sitio bloquea, escala a Zyte
                 ▼
  ┌────────────────────────────────────┐
  │ 6 laboratorios · ~6,200 estudios   │
  └──────────────┬─────────────────────┘
                 │  emparejar contra los 124 del comparador
                 ▼
  ┌────────────────────────────────────┐
  │ data/precios.json                  │  ← lo consume el sitio
  │ data/price-history.json            │  ← serie temporal
  │ data/reporte.md                    │  ← qué cambió
  │ index.html (RAW_DATA embebido)     │  ← respaldo actualizado
  └──────────────┬─────────────────────┘
                 │  git commit + push  → GitHub Pages redeploya
                 ▼
  ┌────────────────────────────────────┐
  │ labcompara.com                     │
  └────────────────────────────────────┘
```

El Apps Script sigue existiendo pero **solo para leads**
([`scripts/labcompara-apps-script.gs`](../scripts/labcompara-apps-script.gs)),
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
| **OLAB** | Nuxt | genérico: sitemap → JSON-LD `offers.price` | — | sin verificar | 0 |

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

LabcomparaBot cae bajo `*`, así que el scan semanal puede correr. Pero el
adaptador se escribió **sin poder validarlo contra el sitio real**, así que usa
una estrategia genérica (sitemap → JSON-LD → patrón de precio) y está marcado
`verificado: false`.

Qué esperar: la guardia de sanidad (`CFG.MIN_CATALOGO`) descarta cualquier scan
que devuelva menos del 30% del catálogo previo, así que si el extractor genérico
no encaja, **OLAB conserva sus precios actuales en vez de publicar basura**.
Revisa `Scan_Log` después de la primera corrida: si la fila de OLAB dice
`descartado` o `sin-datos`, hay que ajustar `LABS.OLAB.parse` con los selectores
reales del sitio.

---

## 3. Puesta en marcha

**Falta un paso, y solo lo puedes hacer tú:** agregar el secret con la clave de
Zyte al repo de Labcompara. GitHub no deja leer el valor de un secret existente,
así que no se puede copiar desde GLPcompara por API.

```bash
# la misma clave que ya usa GLPcompara
gh secret set SCRAPER_API_KEY -R robertpq-clivi/Labcompara
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
gh workflow run scrape-prices.yml -R robertpq-clivi/Labcompara
gh workflow run scrape-prices.yml -R robertpq-clivi/Labcompara -f dry_run=true    # sin commitear
gh workflow run scrape-prices.yml -R robertpq-clivi/Labcompara -f labs=Labbe,LAPI # solo algunos
gh run watch -R robertpq-clivi/Labcompara
```

El resumen de cada corrida (cobertura por lab, cambios sospechosos) queda en la
pestaña **Summary** del run, y el catálogo crudo como artifact por 30 días.

### El Apps Script (leads)

Solo para el formulario, sin precios:
Hoja nueva → Extensiones → Apps Script → pegar
[`scripts/labcompara-apps-script.gs`](../scripts/labcompara-apps-script.gs) →
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
que cambió. `consolidar_()` los detecta solos y los escribe como una fila
`alerta` en `Scan_Log`; el scanner local los pone en `data/reporte.md`.

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
`scripts/lib/match.js`. **`labcompara-apps-script.gs` es un espejo de ambos**:
si cambias un selector en uno, cámbialo en el otro.

## 5.1 Tests

```bash
npm test
```

- **`test-paridad.js`** — el emparejador está escrito dos veces (Node y Apps
  Script). Si se desincronizan, el sitio publica una matriz distinta de la que
  ve quien depura en su máquina, y el síntoma aparece semanas después como "un
  precio que no cuadra". Este test extrae las funciones del `.gs`, las evalúa en
  un sandbox y compara los dos resultados par por par. Usa `data/scan/` si
  existe; si no, un fixture con los casos que en su momento sí destaparon un
  bug (`PERFIL LIPOIDEO`, `POLIOMAVIRUS BK POR PCR`, `VITAMINA A` vs `B12`…).
- **`test-feed.js`** — extrae `cargarPrecios()` del `index.html` real y lo corre
  contra un feed bueno, uno corto, uno sin precios, un 500, una red caída y un
  JSON corrupto. En todos los casos malos el sitio tiene que quedarse con
  `RAW_DATA`; nunca mostrar una comparativa a medias.

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
4. Replica el adaptador en `labcompara-apps-script.gs` → `LABS`.
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
