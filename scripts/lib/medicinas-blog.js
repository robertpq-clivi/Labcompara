/**
 * Medcompara — Hechos de precio por medicamento.
 *
 * Toda cifra que aparezca en un artículo de medicamento sale de aquí, y aquí
 * sale de data/medicinas/prices.json. Nada de precios escritos a mano en el
 * HTML ni en el copy: el scan cambia los números cada semana y las páginas se
 * regeneran con ellos. Un artículo que dice "$15" mientras su propia tabla
 * dice "$8" no vende nada; desmiente al sitio entero.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ARCHIVO = path.join(__dirname, '..', '..', 'data', 'medicinas', 'prices.json');

/** Farmacias en orden de prominencia, para desempatar listados. */
const FARMACIAS = ['Ahorro', 'Guadalajara', 'Benavides', 'SanPablo', 'Prixz'];

/** Como se escriben en prosa (el JSON las guarda en clave corta). */
const NOMBRE_FARMACIA = {
  Ahorro:      'Farmacias del Ahorro',
  Guadalajara: 'Farmacias Guadalajara',
  Benavides:   'Farmacias Benavides',
  SanPablo:    'Farmacia San Pablo',
  Prixz:       'Prixz',
};

/** Singular de la forma farmacéutica, para "precio por tableta". */
const UNIDAD = {
  tabletas:   'tableta',
  cápsulas:   'cápsula',
  ampolletas: 'ampolleta',
  sobres:     'sobre',
  supositorios: 'supositorio',
  parches:    'parche',
  plumas:     'pluma',
  jarabe:     'ml',
  suspensión: 'ml',
  líquido:    'ml',
  solución:   'ml',
  gotas:      'ml',
};

const FILAS_TABLA = 10;

const slugMed = s => String(s).toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const mediana = xs => {
  if (!xs.length) return 0;
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.floor(o.length / 2)];
};

const pct = (bajo, alto) => (alto > 0 ? Math.round(((alto - bajo) / alto) * 100) : 0);

function cargar() {
  return JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
}

/**
 * Los N medicamentos más buscados según el rank del catálogo, y solo los que
 * de verdad tienen precios comparables hoy: un artículo de precios sin tabla
 * de precios es una página en blanco con título bonito.
 */
function masBuscados(datos, n = 10) {
  const vistos = new Map();
  for (const p of datos.presentaciones) {
    if (!vistos.has(p.medicamento)) {
      vistos.set(p.medicamento, { nombre: p.medicamento, rank: p.rank, categoria: p.categoria });
    }
  }
  return [...vistos.values()].sort((a, b) => a.rank - b.rank).slice(0, n);
}

/** Una fila publicable de la tabla de presentaciones. */
function fila(p) {
  const farmacias = Object.keys(p.precios);
  return {
    etiqueta:  p.etiqueta,
    mg:        p.mg,
    forma:     p.forma,
    piezas:    p.piezas,
    ml:        p.ml,
    tipo:      p.tipo,
    min:       p.min,
    max:       p.max,
    masBarata: p.masBarata,
    ahorroPct: pct(p.min, p.max),
    porUnidad: p.porUnidad ?? null,
    farmacias,
    precios:   p.precios,
  };
}

/**
 * Empareja cada caja de marca con la misma caja de sustancia (mismos mg, misma
 * forma, mismas piezas). Es la comparación que decide una compra: no "cuánto
 * cuesta Tempra" sino "cuánto pagas de más por Tempra frente al genérico de la
 * misma caja".
 */
function genericoVsMarca(sustancia, marca) {
  const porCaja = new Map(sustancia.map(p => [`${p.mg}|${p.forma}|${p.piezas}|${p.ml}`, p]));
  return marca
    .map(m => {
      const g = porCaja.get(`${m.mg}|${m.forma}|${m.piezas}|${m.ml}`);
      if (!g || !g.min || m.min <= g.min) return null;
      return {
        nombre:      m.etiqueta.split(' ')[0],
        etiqueta:    m.etiqueta,
        caja:        g.etiqueta,
        generico:    g.min,
        marca:       m.min,
        sobreprecio: Math.round(((m.min - g.min) / g.min) * 100),
        veces:       Math.round((m.min / g.min) * 10) / 10,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.sobreprecio - a.sobreprecio);
}

/** Hechos verificables de un medicamento. */
function hechos(nombre, datos = cargar()) {
  const todas     = datos.presentaciones.filter(p => p.medicamento === nombre).map(fila);
  const sustancia = todas.filter(p => p.tipo === 'sustancia');
  const marca     = todas.filter(p => p.tipo === 'marca');
  const sueltas   = datos.sueltas.filter(s => s.medicamento === nombre);

  if (!sustancia.length && !marca.length) return null;

  const base = sustancia.length ? sustancia : marca;
  const meta = datos.presentaciones.find(p => p.medicamento === nombre);

  // Farmacias donde este medicamento aparece, por número de presentaciones.
  const apariciones = {};
  for (const p of todas) for (const f of p.farmacias) apariciones[f] = (apariciones[f] || 0) + 1;
  const farmacias = Object.keys(apariciones)
    .sort((a, b) => apariciones[b] - apariciones[a] || FARMACIAS.indexOf(a) - FARMACIAS.indexOf(b));

  // Cuántas veces cada farmacia se lleva el precio más bajo. Es el dato que
  // contesta "¿dónde lo compro?" mejor que cualquier precio suelto.
  const gana = {};
  for (const p of base) gana[p.masBarata] = (gana[p.masBarata] || 0) + 1;
  const lider = Object.keys(gana).sort((a, b) => gana[b] - gana[a])[0] || null;

  // Presentación titular: primero las cajas contables (tabletas, cápsulas),
  // que son las que se buscan y las únicas con precio por pieza que signifique
  // algo; luego la que más farmacias tienen, y a igualdad la primera del orden
  // del catálogo. En un jarabe, "5 ml" es la concentración, no el envase: un
  // precio por ml calculado sobre eso miente.
  const destacada = [...base].sort((a, b) =>
    (b.piezas ? 1 : 0) - (a.piezas ? 1 : 0) || b.farmacias.length - a.farmacias.length)[0];

  // Precio por unidad solo entre cajas de la misma dosis y forma que la
  // titular: entre 500 mg y 1000 mg el precio por tableta cambia porque cambia
  // el medicamento, no porque una farmacia sea más cara.
  const mismaCaja = base.filter(
    p => p.forma === destacada.forma && p.mg === destacada.mg && p.porUnidad != null
  );
  const unidades = destacada.piezas ? mismaCaja.map(p => p.porUnidad) : [];

  // El rango y el conteo cuentan también las cajas de marca: son las mismas
  // que el comparador enseña al buscar este medicamento, y un artículo que
  // dice "5 presentaciones" junto a un comparador que dice "9" se contradice
  // a un clic de distancia.
  const min = Math.min(...todas.map(p => p.min));
  const max = Math.max(...todas.map(p => p.max));

  // La tabla ordena por lo que la gente busca: la caja más comparable primero,
  // luego el resto por dosis y tamaño.
  const orden = [...base].sort((a, b) => (a.mg || 0) - (b.mg || 0) || (a.piezas || 0) - (b.piezas || 0));
  const tabla = [destacada, ...orden.filter(p => p !== destacada)].slice(0, FILAS_TABLA);

  const marcas = meta && meta.marcasVistas ? meta.marcasVistas : [];

  return {
    medicamento: nombre,
    slugMed:     slugMed(nombre),
    slug:        `precio-${slugMed(nombre)}-mexico`,
    categoria:   meta ? meta.categoria : '',
    rank:        meta ? meta.rank : null,

    presentaciones: todas.length,
    tabla,
    destacada,
    sueltas,

    farmacias,
    nFarmacias: farmacias.length,
    lider,
    liderGana: lider ? gana[lider] : 0,
    liderDe:   base.length,

    min,
    max,
    ahorroPct:        pct(min, max),
    ahorroMedianoPct: mediana(base.map(p => p.ahorroPct)),
    brechaMax:        [...base].sort((a, b) => b.ahorroPct - a.ahorroPct)[0],

    unidad:       UNIDAD[destacada.forma] || 'pieza',
    porUnidad:    destacada.piezas ? destacada.porUnidad : null,
    porUnidadMin: unidades.length ? Math.min(...unidades) : null,
    porUnidadMax: unidades.length ? Math.max(...unidades) : null,

    marcas,
    marcaVs: genericoVsMarca(sustancia, marca),

    generado: datos.generated_at,
  };
}

module.exports = {
  FARMACIAS, NOMBRE_FARMACIA, UNIDAD,
  slugMed, cargar, masBuscados, hechos, pct,
};
