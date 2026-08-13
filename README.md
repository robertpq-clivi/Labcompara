# Medcompara 🧬

Comparador de precios de salud en México. Tres verticales en un dominio:

| Ruta | Qué compara | Fuentes |
|---|---|---|
| `/laboratorio` | **620 estudios** de laboratorio | Labbe, Polanco, Chopo, Salud Digna, LAPI, OLAB |
| `/glp1` | **16 presentaciones** GLP-1 | Clivi, Ahorro, Benavides, Guadalajara, San Pablo, Revert |
| `/medicinas` | **200 medicamentos** de farmacia | Ahorro, Benavides, Guadalajara, San Pablo, Prixz |

`/` es el landing de Medcompara y dirige a las tres. GLPcompara se consolidó
aquí en agosto de 2026; glpcompara.com.mx redirige con 301 en todas sus rutas.

Cada vertical compara una unidad distinta, y equivocarla es de donde salieron
casi todos los errores de precio del proyecto: en laboratorio es **el mismo
estudio**, en GLP-1 **la misma dosis**, y en farmacia **la misma caja** —misma
dosis, misma presentación y mismo número de piezas—. Omeprazol 20 mg cuesta
$7.71 por cápsula en caja de 7 y $1.34 en caja de 120 dentro de la *misma*
farmacia: comparar "el más barato" de cada una no compararía nada.

## Características

- 620 estudios de laboratorio + 16 medicamentos GLP-1 + 200 medicinas de farmacia
- **Precios actualizados solos cada 7 días** ([cómo funciona](docs/AUTOMATIZACION.md))
- Formulario de captura de leads
- Badges de "Más barato" y "Mejor calificado"
- Modal de detalle con preparación del estudio
- Animación de beams en el hero
- Responsive / Mobile first

## Uso

Abrir `index.html` en cualquier navegador. No requiere servidor ni dependencias
locales: los precios vienen embebidos y el feed fresco se carga encima si está
disponible.

## Actualización de precios

Cada 7 días un workflow de GitHub Actions recorre los seis laboratorios, extrae
su catálogo con precios (~8,300 nombres), lo empareja contra los 620 del
comparador y commitea el resultado. Misma infraestructura que GLPcompara:
cron + **Zyte** como proveedor anti-bloqueo (`SCRAPER_API_KEY`).

```bash
npm run scan:labs       # laboratorios → data/precios.json
npm run scan:farmacias  # GLP-1        → data/medicamentos/prices.json
npm run scan:medicinas  # farmacia     → data/medicinas/prices.json
npm run scan:offline    # reusa data/scan/, sin pedir nada a los sitios
npm run scan:apply      # además reescribe RAW_DATA en index.html
npm test                # emparejador + cargador del feed
npm run expandir        # busca estudios nuevos que estén en 3+ labs

gh workflow run scrape-prices.yml -f dry_run=true   # corrida manual sin commit
```

Instalación de la automatización, adaptador por laboratorio y operación:
**[docs/AUTOMATIZACION.md](docs/AUTOMATIZACION.md)**.

## Estructura

```
index.html                        landing de Medcompara (dirige a las tres)
pages/laboratorio.html            comparador de estudios (datos embebidos)
pages/medicamentos.html           comparador GLP-1 (datos embebidos)
pages/medicinas.html              comparador de farmacia (lee el feed al cargar)
data/precios.json                 matriz de precios que consume el sitio
data/price-history.json           serie temporal por estudio
data/reporte.md                   qué cambió en el último scan
data/medicinas/prices.json        presentaciones comparables de farmacia
.github/workflows/
  scrape-prices.yml               el cron de 7 días, un paso por vertical
scripts/
  scan-labs.js                    orquestador de la vertical de laboratorio
  scan-farmacias.js               orquestador de la vertical GLP-1
  scan-medicinas.js               orquestador de la vertical de farmacia
  lib/http.js         compartido  transporte con escalada a Zyte
  lib/precio.js       compartido  parseo de precios, HTML, JSON-LD
  lib/history.js      compartido  serie temporal
  lib/rutas.js        compartido  dónde vive cada página
  lib/match.js                    emparejamiento difuso (laboratorio)
  lib/agrupar.js                  descubre estudios agrupando entre labs
  lib/presentacion.js             lee dosis/forma/piezas de un título (farmacia)
  verticales/laboratorio.js       6 adaptadores de laboratorio
  verticales/farmacias.js         4 adaptadores de farmacia + 2 curados
  verticales/medicinas.js         5 adaptadores de farmacia general
  verticales/medicinas-catalogo.json  los 200 principios activos más buscados
  construir-catalogo-medicinas.js  regenera ese catálogo desde la hoja
  expandir-catalogo.js            amplía RAW_DATA con lo descubierto
  test-match.js  test-farmacias.js  test-medicinas.js  test-feed.js
  medcompara-apps-script.gs       captura de leads (Sheets)
  generate-sitemaps.js            sitemaps
blog/  pages/                     contenido SEO
```
