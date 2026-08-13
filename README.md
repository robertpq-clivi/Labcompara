# Labcompara 🧬

Comparador de precios de estudios de laboratorio en México.

Compara precios entre Labbe, Polanco, Chopo, Salud Digna, LAPI y OLAB en un solo lugar.

## Características

- 124 estudios comparados entre 6 laboratorios
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
su catálogo con precios (~6,200 estudios), lo empareja contra los 124 del
comparador y commitea el resultado. Misma infraestructura que GLPcompara:
cron + **Zyte** como proveedor anti-bloqueo (`SCRAPER_API_KEY`).

```bash
npm run scan            # escanea los labs y regenera data/precios.json
npm run scan:offline    # reusa data/scan/, sin pedir nada a los sitios
npm run scan:apply      # además reescribe RAW_DATA en index.html
npm test                # emparejador + cargador del feed

gh workflow run scrape-prices.yml -f dry_run=true   # corrida manual sin commit
```

Instalación de la automatización, adaptador por laboratorio y operación:
**[docs/AUTOMATIZACION.md](docs/AUTOMATIZACION.md)**.

## Estructura

```
index.html                        el sitio completo (sin build)
data/precios.json                 matriz de precios que consume el sitio
data/price-history.json           serie temporal por estudio
data/reporte.md                   qué cambió en el último scan
.github/workflows/
  scrape-prices.yml               el cron de 7 días
scripts/
  scan-labs.js                    orquestador del scan
  lib/labs.js                     un adaptador por laboratorio
  lib/http.js                     transporte directo con escalada a Zyte
  lib/match.js                    emparejamiento de nombres de estudio
  lib/history.js                  serie temporal
  test-match.js  test-feed.js     tests
  labcompara-apps-script.gs       captura de leads (Sheets)
  generate-sitemaps.js            sitemaps
blog/  pages/                     contenido SEO
```
