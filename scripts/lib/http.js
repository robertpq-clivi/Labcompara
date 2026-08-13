/**
 * Labcompara — Transporte HTTP con escalada a Zyte
 * -------------------------------------------------
 * Mismo proveedor que GLPcompara: Zyte (`api.zyte.com/v1/extract`), con la
 * misma variable de entorno `SCRAPER_API_KEY` y el mismo secret de GitHub.
 *
 * Diferencia respecto a GLPcompara: allá cada fuente se asigna a mano a "directo"
 * o "por proxy". Aquí la escalada es automática — se pide directo y solo se
 * reintenta por Zyte si el sitio responde como si estuviera bloqueando
 * (403, 429, 503, Cloudflare, error de red). Dos razones:
 *
 *   1. Hoy los seis laboratorios responden directo: la corrida del 13/08/2026
 *      hizo 9,247 requests directos y 0 por Zyte. Mandarlos por proxy gastaría
 *      ese mismo volumen de crédito por corrida para nada.
 *   2. Si mañana alguno empieza a bloquear, el scan se cura solo en vez de
 *      devolver cero y dejar la columna congelada hasta que alguien lo note.
 *
 * Un adaptador puede forzar el proxy desde el arranque con `proxy: true`.
 * Ninguno lo usa hoy; OLAB lo tuvo hasta comprobarse que no le hace falta.
 *
 * Como el proxy casi nunca se activa, `verificarProxy()` hace un request barato
 * al inicio de cada corrida: sin eso una clave vencida pasaría inadvertida
 * hasta el día que se necesite de verdad.
 */

'use strict';

const UA = 'LabcomparaBot/1.0 (+https://labcompara.com; comparador de precios)';
/**
 * Algunos WAF rechazan cualquier User-Agent que no parezca navegador aunque el
 * endpoint sea público — el /graphql de Farmacias del Ahorro es el caso. Para
 * esos se usa este UA en vez de ocultar quiénes somos en todo el scan.
 */
const UA_NAVEGADOR = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TIMEOUT_DIRECTO_MS = 25000;
const TIMEOUT_PROXY_MS = 90000;   // Zyte renderiza y reintenta: necesita más aire

/**
 * La clave puede llegar pegada con etiquetas o saltos de línea
 * ("SCRAPER_PROVIDER = zyte\n<key>"): se toma el último token, igual que en
 * GLPcompara.
 */
function leerClave(env = process.env) {
  const bruto = (env.SCRAPER_API_KEY || '').trim();
  const partes = bruto.split(/\s+/).filter(Boolean);
  return partes.length ? partes[partes.length - 1] : '';
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Señales de que nos están bloqueando y vale la pena reintentar por proxy. */
function pareceBloqueo(err, status, cuerpo) {
  if (status === 403 || status === 429 || status === 503 || status === 401) return true;
  if (err) return true;  // DNS, TLS, connection reset, timeout
  if (cuerpo && /just a moment|cf-browser-verification|attention required|access denied/i.test(cuerpo.slice(0, 2000))) return true;
  return false;
}

/**
 * @param {object} opts
 * @param {string} [opts.zyteKey]   clave de Zyte; sin ella no hay escalada
 * @param {string} [opts.provider]  'zyte' (único soportado hoy)
 * @param {function} [opts.log]     para reportar cada escalada
 */
function crearCliente(opts = {}) {
  const clave = opts.zyteKey !== undefined ? opts.zyteKey : leerClave();
  const proveedor = (opts.provider || process.env.SCRAPER_PROVIDER || 'zyte').toLowerCase();
  const log = opts.log || (() => {});
  const stats = { directo: 0, proxy: 0, escaladas: 0, fallos: 0 };

  async function directo(url, o = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_DIRECTO_MS);
    try {
      const res = await fetch(url, {
        method: o.body ? 'POST' : 'GET',
        redirect: 'follow',
        signal: ctrl.signal,
        body: o.body,
        headers: {
          'User-Agent': o.navegador ? UA_NAVEGADOR : UA,
          'Accept-Language': 'es-MX,es;q=0.9',
          ...(o.body ? { 'Content-Type': 'application/json' } : {}),
          ...(o.headers || {}),
        },
      });
      const cuerpo = await res.text();
      return { status: res.status, cuerpo };
    } finally {
      clearTimeout(t);
    }
  }

  async function viaZyte(url, o = {}) {
    if (!clave) throw new Error('SCRAPER_API_KEY no está configurada');
    if (proveedor !== 'zyte') throw new Error(`proveedor no soportado: ${proveedor}`);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_PROXY_MS);

    // Las cabeceras del llamador tienen que viajar DENTRO del payload de Zyte,
    // no en el request a su API: si no, el destino nunca las ve. La API de San
    // Pablo devuelve XML en vez de JSON cuando le falta su Accept.
    const payload = { url, httpResponseBody: true, geolocation: 'MX' };
    if (o.headers && Object.keys(o.headers).length) {
      payload.customHttpRequestHeaders = Object.entries(o.headers)
        .map(([name, value]) => ({ name, value }));
    }

    try {
      const res = await fetch('https://api.zyte.com/v1/extract', {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${clave}:`).toString('base64'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Zyte HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      if (!data.httpResponseBody) throw new Error('Zyte no devolvió httpResponseBody');
      return Buffer.from(data.httpResponseBody, 'base64').toString('utf8');
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Pide una URL. Primero directo; si parece bloqueo y hay clave, por Zyte.
   * @param {string} url
   * @param {object} [o]
   * @param {boolean} [o.proxy]      saltarse el intento directo
   * @param {number}  [o.reintentos] reintentos del camino directo
   */
  async function pedir(url, o = {}) {
    const reintentos = o.reintentos ?? 2;

    if (o.proxy && clave) {
      stats.proxy++;
      return viaZyte(url, o);
    }

    let ultimoErr = null, ultimoStatus = 0, ultimoCuerpo = '';
    for (let i = 0; i <= reintentos; i++) {
      try {
        const { status, cuerpo } = await directo(url, o);
        if (status === 200) { stats.directo++; return cuerpo; }
        ultimoStatus = status; ultimoCuerpo = cuerpo; ultimoErr = null;
        // 404/410 son respuestas legítimas del sitio: no hay nada que escalar.
        if (status === 404 || status === 410) break;
      } catch (e) {
        ultimoErr = e; ultimoStatus = 0; ultimoCuerpo = '';
      }
      if (i < reintentos) await dormir(400 * (i + 1));
    }

    if (clave && pareceBloqueo(ultimoErr, ultimoStatus, ultimoCuerpo)) {
      stats.escaladas++; stats.proxy++;
      log(`escalando a Zyte (${ultimoStatus || (ultimoErr && ultimoErr.message) || 'sin respuesta'}): ${url}`);
      return viaZyte(url, o);
    }

    stats.fallos++;
    throw ultimoErr || new Error(`HTTP ${ultimoStatus} en ${url}`);
  }

  /**
   * Chequeo previo de la credencial de Zyte.
   *
   * Existe porque el proxy es una red de seguridad que casi nunca se activa: si
   * los seis laboratorios responden directo, una clave vencida o mal pegada
   * pasaría inadvertida durante meses y fallaría justo el día que alguno
   * empiece a bloquear — el peor momento posible. Un request barato por corrida
   * convierte ese fallo silencioso en una línea del log.
   *
   * Nunca aborta la corrida: si el proxy está roto, el scan directo sigue
   * siendo válido para los labs que no lo necesitan.
   */
  async function verificarProxy() {
    if (!clave) return { ok: false, motivo: 'sin SCRAPER_API_KEY' };
    try {
      const html = await viaZyte('https://example.com/');
      if (!/example domain/i.test(html)) return { ok: false, motivo: 'respuesta inesperada' };
      return { ok: true };
    } catch (e) {
      return { ok: false, motivo: String((e && e.message) || e).slice(0, 160) };
    }
  }

  return {
    get: (url, o) => pedir(url, o),
    getJSON: async (url, o) => JSON.parse(await pedir(url, o)),
    /**
     * POST con cuerpo JSON. No escala a Zyte: su endpoint /extract solo hace
     * GET, así que un POST bloqueado falla y se reporta en vez de fingir que
     * hay una alternativa.
     */
    postJSON: async (url, cuerpo, o = {}) =>
      JSON.parse(await pedir(url, { ...o, body: JSON.stringify(cuerpo), reintentos: o.reintentos ?? 1 })),
    stats: () => ({ ...stats }),
    tieneProxy: () => !!clave,
    verificarProxy,
    proveedor,
  };
}

module.exports = { crearCliente, leerClave, UA, pareceBloqueo };
