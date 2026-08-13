/**
 * Labcompara — Captura de leads en Google Sheets
 * ===============================================
 * Mismo patrón que glpcompara-apps-script-v5.gs: una hoja de cálculo con el
 * script publicado como aplicación web que recibe POSTs del formulario.
 *
 * Los PRECIOS no pasan por aquí. Se escanean cada 7 días desde GitHub Actions
 * (.github/workflows/scrape-prices.yml → scripts/scan-labs.js, con Zyte como
 * proveedor anti-bloqueo, igual que GLPcompara) y se publican como
 * data/precios.json en el repo. Ver docs/AUTOMATIZACION.md.
 *
 * INSTALACIÓN
 *   1. Crea una hoja de cálculo nueva en Google Sheets.
 *   2. Extensiones → Apps Script. Pega este archivo.
 *   3. Implementar → Nueva implementación → Aplicación web
 *        Ejecutar como: Yo
 *        Quién tiene acceso: Cualquier persona
 *   4. Copia la URL /exec al front-end.
 *
 * REDEPLOY
 *   Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva versión.
 *   (Se conserva la misma URL.)
 *
 * Si cambias los encabezados de una pestaña, borra la pestaña antes de
 * redeployar para que se regenere con las columnas nuevas.
 */

function doPost(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var d = JSON.parse(e.postData.contents);
    var tipo = d.tipo || 'lead';

    if (tipo === 'comparacion') {
      sheet_(ss, 'Comparaciones', ['Fecha', 'Nombre', 'Correo', 'Estudio', 'Origen'])
        .appendRow([new Date(), d.nombre || '', d.correo || '', d.estudio || '', d.origen || '']);

    } else if (tipo === 'click') {
      sheet_(ss, 'Clicks', ['Fecha', 'Nombre', 'Correo', 'Laboratorio', 'Estudio', 'Precio', 'Origen'])
        .appendRow([new Date(), d.nombre || '', d.correo || '', d.laboratorio || '',
                    d.estudio || '', d.precio || '', d.origen || '']);

    } else if (tipo === 'suscripcion') {
      sheet_(ss, 'Suscripciones', ['Fecha', 'Nombre', 'Correo', 'Estudios', 'Origen'])
        .appendRow([new Date(), d.nombre || '', d.correo || '', d.estudios || '', d.origen || '']);

    } else {
      sheet_(ss, 'Leads', ['Fecha', 'Nombre', 'Correo', 'Sexo', 'Edad', 'Codigo Postal', 'Origen'])
        .appendRow([new Date(), d.nombre || '', d.correo || '', d.sexo || '',
                    d.edad || '', d.cp || '', d.origen || '']);
    }

    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function sheet_(ss, name, headers) {
  var s = ss.getSheetByName(name) || ss.insertSheet(name);
  if (s.getLastRow() === 0) {
    s.appendRow(headers);
    s.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    s.setFrozenRows(1);
  }
  return s;
}
