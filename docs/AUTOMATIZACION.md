# Automatización de precios

Cómo Labcompara mantiene los precios al día sin que nadie los capture a mano.

---

## 1. Cómo funciona

Cada 7 días un Apps Script recorre los seis laboratorios, extrae su catálogo con
precios, lo empareja contra los estudios de Labcompara y publica el resultado
como JSON. El sitio lo consume al cargar.

```
                        ┌──────────────────────────────┐
   trigger 7 días  ───▶ │  labcompara-apps-script.gs   │
                        │  ────────────────────────    │
                        │  1. abrirCiclo_              │  ← labs de API + cola
                        │  2. procesarCola_  (×N)      │  ← lotes de 30 fichas
                        │  3. consolidar_              │  ← match + histórico
                        └──────────────┬───────────────┘
                                       │
                        ┌──────────────▼───────────────┐
                        │  Google Sheets               │
                        │  Precios · Historico ·       │
                        │  Catalogo · Scan_Log ·       │
                        │  Sin_Match                   │
                        └──────────────┬───────────────┘
                                       │  GET ?feed=precios
                        ┌──────────────▼───────────────┐
                        │  index.html → cargarPrecios()│
                        │  respaldo: RAW_DATA embebido │
                        └──────────────────────────────┘
```

Es la misma infraestructura de GLPcompara —Sheets + Apps Script publicado como
aplicación web— y el mismo `doPost()` sigue recibiendo leads, clicks,
comparaciones y suscripciones. El scanner se le suma encima.

**El scan es resumible.** Una ejecución de Apps Script muere a los 6 minutos y
el catálogo completo son ~4,200 fichas HTML. Por eso las URLs se encolan en la
hoja `_Cola`, se procesan por lotes durante ~4.5 minutos y el script se
reprograma solo con un trigger de un disparo hasta vaciar la cola. Una corrida
completa encadena 6–8 ejecuciones (~35 min de reloj, sin supervisión).

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

## 3. Instalación

Una sola vez, ~10 minutos.

1. **Crea una hoja de cálculo** nueva en Google Sheets.
2. **Extensiones → Apps Script.** Borra lo que haya y pega
   [`scripts/labcompara-apps-script.gs`](../scripts/labcompara-apps-script.gs)
   completo.
3. **Ejecuta `instalar()`** y autoriza los permisos.
   Crea las hojas y programa el trigger cada 7 días a las 3am.
4. **Ejecuta `sembrarCatalogo()`.**
   `consolidar_()` nunca inventa estudios: solo actualiza los que ya existen en
   la hoja `Precios`. Esta función la siembra desde `data/precios.json` del repo.
   Vuelve a correrla cada vez que agregues estudios al comparador.
5. **Implementar → Nueva implementación → Aplicación web**
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier persona**

   Copia la URL `/exec`.
6. **Pega esa URL en `index.html`** → constante `FEED_URL`.
   Hasta entonces el sitio lee el snapshot del repo (`/data/precios.json`), que
   también funciona pero solo se actualiza cuando alguien hace deploy.
7. **Ejecuta `escanearAhora()`** para llenar los datos sin esperar al trigger.

Para redeployar después de un cambio:
Implementar → Gestionar implementaciones → ✏️ → Versión: **Nueva versión**.
La URL no cambia.

---

## 4. Operación

**Qué revisar después de cada corrida** (hoja `Scan_Log`):

| Estado | Significa | Acción |
|---|---|---|
| `ok` | scan y consolidación normales | ninguna |
| `encolado` | sitemap leído, fichas en cola | ninguna (es intermedio) |
| `descartado` | el scan trajo <30% del catálogo previo | revisar el adaptador |
| `sin-datos` | cero resultados | el sitio cambió o está caído |
| `error` | excepción; el detalle trae el mensaje | revisar |

**Hoja `Sin_Match`** — estudios que el laboratorio sí tiene con precio pero que
no se pudieron emparejar con ningún estudio de Labcompara. Es la mejor fuente
para dos cosas: detectar estudios que valdría la pena agregar al comparador, y
detectar nombres que solo necesitan un alias.

**Hoja `Catalogo`** — la forma de arreglar un emparejamiento fallido sin tocar
código: una fila con el nombre canónico y sus variantes separadas por `|`.

```
Estudio canónico                  | Alias
Biometría Hemática                | biometria hematica completa|BH|biometria hematica automatizada
Química Sanguínea 27 Elementos    | quimica sanguinea de 27 elementos|QS27
```

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
