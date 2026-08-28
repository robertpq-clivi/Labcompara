/**
 * Medcompara — Hechos de precio de los GLP-1.
 *
 * Tercera vertical con el mismo trato que medicinas y laboratorio: las páginas
 * de precio de Ozempic, Mounjaro y Wegovy citaban cifras escritas a mano
 * mientras data/medicamentos/prices.json se refrescaba cada semana sin que
 * nadie lo leyera.
 *
 * La diferencia con las otras dos verticales: aquí las fuentes no son
 * comparables entre sí. Una caja de farmacia y un plan con consulta,
 * seguimiento y estudios incluidos no son el mismo producto, y ponerlos en la
 * misma columna de "más barato" haría ver caro a quien incluye más. Se
 * separan.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ARCHIVO = path.join(__dirname, '..', '..', 'data', 'medicamentos', 'prices.json');

/** Cajas de farmacia: el precio es del producto y nada más. */
const FARMACIAS = ['Ahorro', 'Guadalajara', 'Benavides', 'SanPablo'];

/** Planes: el precio incluye acompañamiento médico, no solo el medicamento. */
const PLANES = ['Clivi', 'Revert'];

const NOMBRE = {
  Ahorro:      'Farmacias del Ahorro',
  Guadalajara: 'Farmacias Guadalajara',
  Benavides:   'Farmacias Benavides',
  SanPablo:    'Farmacia San Pablo',
  Clivi:       'Clivi',
  Revert:      'Revert',
};

/** Qué incluye cada familia, para no comparar peras con manzanas en la prosa. */
const FAMILIAS = {
  Ozempic:  { activo: 'semaglutida', via: 'inyección semanal', envase: 'pluma' },
  Mounjaro: { activo: 'tirzepatida', via: 'inyección semanal', envase: 'pluma' },
  Wegovy:   { activo: 'semaglutida', via: 'inyección semanal', envase: 'caja mensual' },
  Rybelsus: { activo: 'semaglutida', via: 'tableta diaria',    envase: 'caja de 30 tabletas' },
  Foundayz: { activo: 'orforglipron', via: 'tableta diaria',    envase: 'caja de 30 tabletas' },
};

const pct = (bajo, alto) => (alto > 0 ? Math.round(((alto - bajo) / alto) * 100) : 0);

const mediana = xs => {
  if (!xs.length) return 0;
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.floor(o.length / 2)];
};

function cargar() {
  return JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
}

/** "Mounjaro 7.5 mg (1 pluma)" → "7.5 mg". */
const dosis = producto => (producto.match(/(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?\s*mg)/) || [, producto])[1];

/**
 * Hechos de una familia. Devuelve null si el scan no trae al menos dos
 * presentaciones con precio de farmacia: sin eso no hay comparación que
 * publicar, solo una cifra suelta.
 */
function hechos(familia, datos = cargar()) {
  const meta = FAMILIAS[familia];
  if (!meta) return null;

  const filas = Object.entries(datos.prices)
    .filter(([nombre]) => nombre.startsWith(familia + ' '))
    .map(([nombre, v]) => {
      const fuentes = v.sources || {};
      const enFarmacia = FARMACIAS
        .filter(f => fuentes[f] && fuentes[f].price > 0)
        .map(f => ({ fuente: f, precio: fuentes[f].price }))
        .sort((a, b) => a.precio - b.precio);
      const enPlan = PLANES
        .filter(f => fuentes[f] && fuentes[f].price > 0)
        .map(f => ({ fuente: f, precio: fuentes[f].price }))
        .sort((a, b) => a.precio - b.precio);

      if (enFarmacia.length < 2) return null;

      const precios = enFarmacia.map(x => x.precio);
      const min = Math.min(...precios), max = Math.max(...precios);
      return {
        producto: nombre,
        dosis: dosis(nombre),
        farmacias: enFarmacia,
        planes: enPlan,
        min, max,
        barato: enFarmacia[0].fuente,
        caro: enFarmacia[enFarmacia.length - 1].fuente,
        ahorroPct: pct(min, max),
      };
    })
    .filter(Boolean);

  if (filas.length < 2) return null;

  const min = Math.min(...filas.map(f => f.min));
  const max = Math.max(...filas.map(f => f.max));

  // Quién gana más veces entre farmacias. Los planes no entran: no compiten
  // por precio de caja, compiten con lo que incluyen.
  const gana = {};
  for (const f of filas) gana[f.barato] = (gana[f.barato] || 0) + 1;
  const lider = Object.keys(gana).sort((a, b) => gana[b] - gana[a])[0];

  // La presentación de entrada es la que se busca: quien compara precio de un
  // GLP-1 casi siempre está por empezar, no a media titulación.
  const inicial = filas[0];

  const farmacias = [...new Set(filas.flatMap(f => f.farmacias.map(x => x.fuente)))];
  const planes    = [...new Set(filas.flatMap(f => f.planes.map(x => x.fuente)))];

  return {
    familia, ...meta,
    filas,
    inicial,
    nPresentaciones: filas.length,
    farmacias, nFarmacias: farmacias.length,
    planes, nPlanes: planes.length,
    min, max,
    ahorroPct: pct(min, max),
    ahorroMedianoPct: mediana(filas.map(f => f.ahorroPct)),
    lider, liderGana: gana[lider], liderDe: filas.length,
    generado: datos.generated_at,
  };
}

/** "Foundayz 2.5 mg (30 tabletas)" → 2.5, para ordenar la escalera de dosis. */
const dosisNum = (producto) => {
  const m = dosis(producto).match(/[\d.]+/);
  return m ? Number(m[0]) : 0;
};

/**
 * Hechos de una familia recién llegada, que todavía no da para una comparación
 * entre farmacias.
 *
 * `hechos()` exige dos precios de farmacia por presentación: con menos no hay
 * «de X a Y según dónde la compres» que publicar, sólo una cifra suelta. Un
 * lanzamiento tarda meses en llegar a ese piso —Foundayz entró primero por los
 * planes médicos y después a una sola cadena— y mientras tanto la pregunta de
 * quien busca el precio sigue existiendo.
 *
 * Lo que sí se puede comparar desde el día uno son las dos vías: la caja en el
 * mostrador y la mensualidad de un plan que incluye consulta y seguimiento. No
 * son el mismo producto y la página lo dice, pero son las dos formas reales de
 * conseguirlo y el lector elige entre ellas.
 *
 * Devuelve null con menos de dos presentaciones con precio.
 */
function hechosNuevo(familia, datos = cargar()) {
  const meta = FAMILIAS[familia];
  if (!meta) return null;

  const conPrecio = (fuentes, lista) => lista
    .filter(f => fuentes[f] && fuentes[f].price > 0)
    .map(f => ({ fuente: f, precio: fuentes[f].price }))
    .sort((a, b) => a.precio - b.precio);

  const filas = Object.entries(datos.prices)
    .filter(([nombre]) => nombre.startsWith(familia + ' '))
    .map(([nombre, v]) => {
      const fuentes = v.sources || {};
      const enFarmacia = conPrecio(fuentes, FARMACIAS);
      const enPlan = conPrecio(fuentes, PLANES);
      if (!enFarmacia.length && !enPlan.length) return null;

      const todos = [...enFarmacia, ...enPlan].map(x => x.precio);
      return {
        producto: nombre,
        dosis: dosis(nombre),
        farmacias: enFarmacia,
        planes: enPlan,
        minFarmacia: enFarmacia.length ? enFarmacia[0].precio : null,
        minPlan: enPlan.length ? enPlan[0].precio : null,
        maxPlan: enPlan.length ? enPlan[enPlan.length - 1].precio : null,
        min: Math.min(...todos),
        max: Math.max(...todos),
      };
    })
    .filter(Boolean);

  if (filas.length < 2) return null;

  // Se ordena por la dosis, no por el precio: es una escalera de titulación y
  // se recorre de abajo hacia arriba, aunque un día los precios no lo respeten.
  filas.sort((a, b) => dosisNum(a.producto) - dosisNum(b.producto));

  const farmacias = [...new Set(filas.flatMap(f => f.farmacias.map(x => x.fuente)))];
  const planes    = [...new Set(filas.flatMap(f => f.planes.map(x => x.fuente)))];

  // Cuál de las dos vías sale más barata no se escribe a mano en el copy: hoy
  // el plan queda por debajo de la caja en todas las dosis, y eso puede
  // invertirse en cualquier corrida sin que nadie vuelva a leer la frase.
  const comparables = filas.filter(f => f.minFarmacia != null && f.minPlan != null);
  const planGana = comparables.filter(f => f.minPlan < f.minFarmacia).length;

  return {
    familia, ...meta,
    filas,
    inicial: filas[0], alta: filas[filas.length - 1],
    nPresentaciones: filas.length,
    farmacias, nFarmacias: farmacias.length,
    planes, nPlanes: planes.length,
    comparables: comparables.length, planGana,
    min: Math.min(...filas.map(f => f.min)),
    max: Math.max(...filas.map(f => f.max)),
    generado: datos.generated_at,
  };
}

/**
 * Comparación cruzada de las cuatro familias: cuánto cuesta empezar y cuánto
 * mantener, al mes. Es la pregunta real de quien está decidiendo tratamiento y
 * no marca — y la única forma honesta de responderla es separar el precio de
 * entrada del de mantenimiento, porque casi todo el gasto está en el segundo.
 */
function hechosTodas(datos = cargar()) {
  const filas = Object.keys(FAMILIAS)
    .map(f => hechos(f, datos))
    .filter(Boolean)
    .map(h => {
      const alta = h.filas[h.filas.length - 1];
      return {
        familia: h.familia, activo: h.activo, via: h.via,
        inicioMin: h.inicial.min, inicioMax: h.inicial.max, inicioDosis: h.inicial.dosis,
        altaMin: alta.min, altaMax: alta.max, altaDosis: alta.dosis,
        barato: h.inicial.barato,
        nPres: h.nPresentaciones,
      };
    })
    .sort((a, b) => a.inicioMin - b.inicioMin);

  if (filas.length < 3) return null;

  return {
    filas,
    nFamilias: filas.length,
    min: Math.min(...filas.map(f => f.inicioMin)),
    max: Math.max(...filas.map(f => f.altaMax)),
    barata: filas[0],
    farmacias: [...new Set(Object.values(datos.prices).flatMap(v => Object.keys(v.sources || {})))]
      .filter(f => FARMACIAS.includes(f)),
    generado: datos.generated_at,
  };
}

module.exports = { FARMACIAS, PLANES, NOMBRE, FAMILIAS, cargar, hechos, hechosNuevo, hechosTodas, dosis, dosisNum, pct, mediana };
