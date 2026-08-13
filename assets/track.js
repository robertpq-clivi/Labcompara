/**
 * Medcompara — Registro de eventos (hoja de cálculo + GA4)
 * =========================================================
 * Un solo archivo para las tres verticales. Antes cada comparador llevaba su
 * propia copia de la función de envío, y fue precisamente esa divergencia la
 * que dejó la columna "Laboratorio" de la hoja en blanco durante meses: el
 * comparador GLP-1 empezó a mandar `farmacia` y nadie actualizó el receptor.
 *
 * Dos problemas resuelve este archivo, y los dos son de pérdida silenciosa:
 *
 * 1. **El envío se cancela al navegar.** El evento que más importa —el click a
 *    la farmacia— ocurre justo cuando el navegador está abandonando la página,
 *    y ahí un `fetch` normal se aborta a mitad de vuelo. Se usa `sendBeacon`,
 *    que el navegador se compromete a entregar aunque la pestaña se cierre.
 *
 * 2. **Si falla, no queda rastro.** Sin red, o con la hoja caída, el evento se
 *    perdía sin que nadie se enterara. Ahora se guarda en localStorage y se
 *    reintenta al volver la conexión o en la siguiente visita.
 *
 * Uso:
 *   MC.init({ vertical: 'medicinas' });
 *   MC.identidad({ nombre, correo });
 *   MC.log('busqueda', { consulta: 'tempra', resultados: 3 });
 *   MC.log('click', { farmacia: 'Prixz', medicamento: '…', precio: 13 });
 */
(function (global) {
  'use strict';

  var WEBHOOK = 'https://script.google.com/macros/s/AKfycbxKB4HJnpIxH2e-CLvr74ZsC1YSDon_It_khHS70Ha_P2QqSvo7Ul3Fj9S19MRsxstn/exec';
  var COLA = 'mc_cola_eventos';
  var MAX_COLA = 50;   // más que esto y el problema no es la cola
  var cfg = { vertical: 'medicinas', origen: 'medcompara.com.mx' };
  var quien = {};

  function leerCola() {
    try { return JSON.parse(localStorage.getItem(COLA) || '[]'); } catch (e) { return []; }
  }
  function guardarCola(c) {
    try { localStorage.setItem(COLA, JSON.stringify(c.slice(-MAX_COLA))); } catch (e) { /* modo privado */ }
  }

  /**
   * Entrega un evento. Devuelve true solo si el navegador aceptó encargarse.
   *
   * `sendBeacon` va primero porque sobrevive a la navegación; `fetch` con
   * keepalive es el respaldo para navegadores que no lo tengan. El tipo
   * text/plain evita el preflight de CORS, que Apps Script no responde.
   */
  function entregar(cuerpo) {
    var texto = JSON.stringify(cuerpo);
    try {
      if (global.navigator && typeof navigator.sendBeacon === 'function') {
        var blob = new Blob([texto], { type: 'text/plain;charset=utf-8' });
        if (navigator.sendBeacon(WEBHOOK, blob)) return true;
      }
    } catch (e) { /* cae al respaldo */ }
    try {
      fetch(WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: texto,
        keepalive: true,     // el navegador termina el envío aunque la página muera
        mode: 'no-cors',
      }).catch(function () { encolar(cuerpo); });
      return true;
    } catch (e) { return false; }
  }

  function encolar(cuerpo) {
    var c = leerCola();
    c.push(cuerpo);
    guardarCola(c);
  }

  /** Reintenta lo que quedó pendiente. Se vacía solo si el navegador lo acepta. */
  function vaciarCola() {
    var c = leerCola();
    if (!c.length) return;
    guardarCola([]);
    for (var i = 0; i < c.length; i++) {
      if (!entregar(c[i])) { encolar(c[i]); break; }
    }
  }

  var MC = {
    init: function (opts) {
      if (opts && opts.vertical) cfg.vertical = opts.vertical;
      if (opts && opts.origen) cfg.origen = opts.origen;
      vaciarCola();
      return MC;
    },

    /** Nombre y correo del visitante, para que los eventos siguientes los lleven. */
    identidad: function (o) {
      quien = { nombre: (o && o.nombre) || '', correo: (o && o.correo) || '' };
      return MC;
    },

    /**
     * Registra un evento en la hoja y, en paralelo, en GA4.
     * @param {string} tipo lead | busqueda | comparacion | click | suscripcion
     */
    log: function (tipo, datos) {
      var cuerpo = { tipo: tipo, vertical: cfg.vertical, origen: cfg.origen,
                     nombre: quien.nombre || '', correo: quien.correo || '' };
      for (var k in (datos || {})) cuerpo[k] = datos[k];
      if (!entregar(cuerpo)) encolar(cuerpo);
      return cuerpo;
    },

    /** Evento de GA4. Separado del anterior porque no siempre coinciden. */
    ga: function (nombre, params) {
      if (typeof global.gtag === 'function') {
        var p = {};
        for (var k in (params || {})) p[k] = params[k];
        p.vertical = cfg.vertical;
        global.gtag('event', nombre, p);
      }
    },

    /** Cuántos eventos siguen esperando. Útil para revisar desde la consola. */
    pendientes: function () { return leerCola().length; },
  };

  // Al volver la conexión y al ocultar la pestaña: dos momentos en los que
  // conviene vaciar lo pendiente antes de que el navegador descarte la página.
  if (global.addEventListener) {
    global.addEventListener('online', vaciarCola);
    global.addEventListener('pagehide', vaciarCola);
    if (global.document) {
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') vaciarCola();
      });
    }
  }

  global.MC = MC;
})(typeof window !== 'undefined' ? window : this);
