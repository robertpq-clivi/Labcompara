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

Un Apps Script recorre cada semana los seis laboratorios, extrae su catálogo con
precios (~6,200 estudios), lo empareja contra los 124 del comparador y publica
el resultado como JSON que el sitio consume en caliente.

```bash
npm run scan            # escanea los labs y regenera data/precios.json
npm run scan:offline    # reusa data/scan/, sin pedir nada a los sitios
npm run scan:apply      # además reescribe RAW_DATA en index.html
npm test                # paridad Node↔Apps Script + cargador del feed
```

Instalación de la automatización, adaptador por laboratorio y operación:
**[docs/AUTOMATIZACION.md](docs/AUTOMATIZACION.md)**.

## Estructura

```
index.html                        el sitio completo (sin build)
data/precios.json                 matriz de precios que consume el sitio
data/reporte.md                   qué cambió en el último scan
scripts/
  labcompara-apps-script.gs       la automatización semanal (Sheets + web app)
  scan-labs.js                    el mismo pipeline, corrido en local
  lib/labs.js                     un adaptador por laboratorio
  lib/match.js                    emparejamiento de nombres de estudio
  test-paridad.js  test-feed.js   tests
  generate-sitemaps.js            sitemaps
blog/  pages/                     contenido SEO
```
