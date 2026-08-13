/**
 * Medcompara — Hechos de comparación entre laboratorios.
 *
 * Toda cifra que aparezca en una comparativa sale de aquí, y aquí sale de
 * data/precios.json. Nada de precios escritos a mano en el HTML: el scan
 * semanal cambia los números y las páginas se regeneran con ellos.
 */

const path = require('path');

// Orden de prominencia. Fija el slug: el lab que va primero manda.
// (Coincide con los slugs históricos: salud-digna-vs-chopo, chopo-vs-lapi, olab-vs-labbe.)
const LABS = ['Salud Digna', 'Chopo', 'OLAB', 'LAPI', 'Labbe', 'Polanco'];

// Estudios que encabezan la tabla, en orden de demanda de búsqueda.
// Los que no existan en el par se omiten y se rellena con los siguientes.
const DESTACADOS = [
  'Biometría Hemática',
  'Química Sanguínea 27 Elementos',
  'Glucosa en Suero',
  'Perfil de Lípidos',
  'Colesterol Total',
  'Hemoglobina Glicosilada (HbA1c)',
  'Perfil Tiroideo',
  'Examen General de Orina (EGO)',
  'Insulina Basal',
  'Creatinina Sérica',
  'Ácido Úrico',
  'Vitamina D (25-Hidroxi)',
  'Prueba de VIH',
  'Testosterona Total',
  'Perfil Hormonal Femenino',
  'Prueba de Embarazo en Sangre (Beta-HCG)',
];

const FILAS_TABLA = 12;

const slugLab = l => l.toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/ /g, '-');

/** Los 15 pares, siempre en el mismo orden. */
function pares() {
  const out = [];
  for (let i = 0; i < LABS.length; i++)
    for (let j = i + 1; j < LABS.length; j++)
      out.push({ a: LABS[i], b: LABS[j], slug: `${slugLab(LABS[i])}-vs-${slugLab(LABS[j])}-precios` });
  return out;
}

function cargarPrecios() {
  return require(path.join(__dirname, '..', '..', 'data', 'precios.json'));
}

/** Hechos verificables de un par: tabla destacada + agregados de todo el catálogo. */
function hechos(par, datos = cargarPrecios()) {
  const { a, b } = par;
  const conAmbos = datos.estudios.filter(
    e => typeof e[a] === 'number' && typeof e[b] === 'number' && e[a] > 0 && e[b] > 0
  );

  const fila = e => {
    const pa = e[a], pb = e[b];
    const barato = pa < pb ? a : pb < pa ? b : null;
    const caro   = Math.max(pa, pb);
    return {
      estudio: e.name,
      [a]: pa,
      [b]: pb,
      barato,
      ahorroPct: caro ? Math.round((Math.abs(pa - pb) / caro) * 100) : 0,
    };
  };

  // Destacados primero (en orden), luego los de mayor brecha para completar.
  const porNombre = new Map(conAmbos.map(e => [e.name, e]));
  const elegidos = DESTACADOS.map(n => porNombre.get(n)).filter(Boolean);
  const resto = conAmbos
    .filter(e => !elegidos.includes(e))
    .sort((x, y) => (Math.abs(y[a] - y[b]) / Math.max(y[a], y[b])) - (Math.abs(x[a] - x[b]) / Math.max(x[a], x[b])));
  const tabla = [...elegidos, ...resto].slice(0, FILAS_TABLA).map(fila);

  const todas = conAmbos.map(fila);
  const ganaA = todas.filter(f => f.barato === a).length;
  const ganaB = todas.filter(f => f.barato === b).length;

  // Mediana del ahorro donde gana el que gana más veces.
  const lider = ganaA >= ganaB ? a : b;
  const ahorros = todas.filter(f => f.barato === lider).map(f => f.ahorroPct).sort((x, y) => x - y);
  const ahorroMediano = ahorros.length ? ahorros[Math.floor(ahorros.length / 2)] : 0;

  const mayorBrecha = [...todas].sort((x, y) => y.ahorroPct - x.ahorroPct)[0] || null;

  // Canasta: suma de los destacados que ambos tienen.
  const canasta = tabla.reduce((acc, f) => ({ [a]: acc[a] + f[a], [b]: acc[b] + f[b] }), { [a]: 0, [b]: 0 });

  return {
    a, b, slug: par.slug,
    tabla,
    comparables: todas.length,
    ganaA, ganaB,
    empates: todas.length - ganaA - ganaB,
    lider,
    ahorroMediano,
    mayorBrecha,
    canasta,
    canastaAhorroPct: Math.round(
      (Math.abs(canasta[a] - canasta[b]) / Math.max(canasta[a], canasta[b])) * 100
    ),
    catalogo: { [a]: datos.estudios.filter(e => typeof e[a] === 'number').length,
                [b]: datos.estudios.filter(e => typeof e[b] === 'number').length },
    generado: datos.generado,
  };
}

module.exports = { LABS, DESTACADOS, slugLab, pares, hechos, cargarPrecios };
