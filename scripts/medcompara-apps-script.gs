/**
 * Medcompara — Captura de leads, búsquedas y clicks en Google Sheets
 * ===================================================================
 * Una hoja de cálculo con este script publicado como aplicación web que recibe
 * POSTs de las tres verticales: laboratorio, GLP-1 y medicinas de farmacia.
 *
 * Los PRECIOS no pasan por aquí. Se escanean cada 7 días desde GitHub Actions
 * (.github/workflows/scrape-prices.yml) y se publican como JSON en el repo.
 * Ver docs/AUTOMATIZACION.md.
 *
 * ── POR QUÉ ESTA VERSIÓN ───────────────────────────────────────────────────
 * La anterior se escribió para la vertical de laboratorio y leía `laboratorio`
 * y `estudio`. Cuando GLPcompara se integró, su comparador empezó a mandar
 * `farmacia` y `medicamento` — nombres distintos para lo mismo—, así que cada
 * click quedó registrado con la columna de la farmacia **en blanco**.
 * Nada falló: la fila se escribía, solo que vacía justo en el dato que se
 * quería medir. Eso es peor que un error, porque no se nota.
 *
 * De ahí las dos reglas de este archivo:
 *   1. Los campos se leen por sinónimos (`farmacia` o `laboratorio`), así que
 *      una página vieja y una nueva caen en la misma columna.
 *   2. Todo lo que llega y no se reconoce se guarda igual, en la pestaña
 *      "Sin clasificar", con el JSON completo. Preferimos una fila fea a un
 *      dato perdido.
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
 * Las pestañas que ya existan se migran solas: si a una le faltan columnas
 * nuevas, se agregan a la derecha sin tocar lo que ya está escrito.
 */

/** Primer valor no vacío entre varios nombres posibles del mismo campo. */
function pick_(d, nombres) {
  for (var i = 0; i < nombres.length; i++) {
    var v = d[nombres[i]];
    if (v !== undefined && v !== null && String(v) !== '') return v;
  }
  return '';
}

function doPost(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var d = JSON.parse(e.postData.contents);
    var tipo = String(d.tipo || 'lead');
    // Qué comparador la mandó. Sin esto, con tres verticales en un dominio, la
    // hoja dice qué se buscó pero no dónde.
    var comun = {
      'Fecha': new Date(),
      'Vertical': pick_(d, ['vertical']) || 'laboratorio',
      'Nombre': pick_(d, ['nombre']),
      'Correo': pick_(d, ['correo']),
      'Origen': pick_(d, ['origen']),
    };
    var producto = pick_(d, ['medicamento', 'estudio', 'producto']);
    var lugar = pick_(d, ['farmacia', 'laboratorio', 'destino_nombre']);

    if (tipo === 'busqueda') {
      // Lo que la gente escribe, incluso cuando no encuentra nada. Las búsquedas
      // con 0 resultados son las más valiosas: son demanda que no cubrimos.
      escribir_(ss, 'Busquedas', ['Fecha', 'Vertical', 'Consulta', 'Resultados', 'Nombre', 'Correo', 'Origen'],
        obj_(comun, {'Consulta': pick_(d, ['consulta', 'query', 'q']), 'Resultados': pick_(d, ['resultados'])}));

    } else if (tipo === 'seleccion') {
      // Qué medicamento eligió, ya sin erratas ni búsquedas a medio escribir:
      // es la señal más limpia de qué se está buscando de verdad.
      escribir_(ss, 'Selecciones', ['Fecha', 'Vertical', 'Medicamento', 'Categoria', 'Presentaciones', 'Nombre', 'Correo', 'Origen'],
        obj_(comun, {'Medicamento': producto, 'Categoria': pick_(d, ['categoria']),
                     'Presentaciones': pick_(d, ['presentaciones'])}));

    } else if (tipo === 'comparacion') {
      escribir_(ss, 'Comparaciones', ['Fecha', 'Vertical', 'Nombre', 'Correo', 'Producto', 'Presentacion', 'Origen'],
        obj_(comun, {'Producto': producto, 'Estudio': producto,
                     'Presentacion': pick_(d, ['dosis', 'presentacion', 'presentaciones'])}));

    } else if (tipo === 'click') {
      escribir_(ss, 'Clicks', ['Fecha', 'Vertical', 'Nombre', 'Correo', 'Farmacia o laboratorio', 'Producto', 'Precio', 'Destino', 'Origen'],
        // 'Laboratorio' y 'Estudio' son los encabezados de la versión anterior:
        // si la pestaña ya existe con ellos, se siguen llenando además de los
        // nuevos, para que la columna histórica no se corte a la mitad.
        obj_(comun, {'Farmacia o laboratorio': lugar, 'Laboratorio': lugar,
                     'Producto': producto, 'Estudio': producto,
                     'Precio': pick_(d, ['precio', 'price_mxn']),
                     'Destino': pick_(d, ['destino', 'url'])}));

    } else if (tipo === 'suscripcion') {
      escribir_(ss, 'Suscripciones', ['Fecha', 'Vertical', 'Nombre', 'Correo', 'Productos', 'Origen'],
        obj_(comun, {'Productos': pick_(d, ['medicamentos', 'estudios', 'productos']),
                     'Estudios': pick_(d, ['medicamentos', 'estudios', 'productos'])}));

    } else if (tipo === 'lead') {
      escribir_(ss, 'Leads', ['Fecha', 'Vertical', 'Nombre', 'Correo', 'Sexo', 'Edad', 'Codigo Postal', 'Origen'],
        obj_(comun, {'Sexo': pick_(d, ['sexo']), 'Edad': pick_(d, ['edad']),
                     'Codigo Postal': pick_(d, ['cp', 'codigo_postal'])}));

    } else {
      // Un tipo que este script todavía no conoce. Se guarda entero: cuando el
      // front-end agregue un evento nuevo, el dato ya estará esperando aquí en
      // vez de haberse tirado durante semanas.
      escribir_(ss, 'Sin clasificar', ['Fecha', 'Tipo', 'Vertical', 'JSON'],
        obj_(comun, {'Tipo': tipo, 'JSON': JSON.stringify(d).slice(0, 4000)}));
    }

    return json_({ ok: true });
  } catch (err) {
    // El error también se guarda: un POST malformado que solo devuelve 500 se
    // pierde, y el front-end no lo reintenta porque no lee la respuesta.
    try {
      escribir_(SpreadsheetApp.getActiveSpreadsheet(), 'Errores', ['Fecha', 'Error', 'Cuerpo'],
        {'Fecha': new Date(), 'Error': String(err),
         'Cuerpo': (e && e.postData ? String(e.postData.contents) : '').slice(0, 4000)});
    } catch (e2) { /* si ni eso se puede, no hay a dónde escribir */ }
    return json_({ ok: false, error: String(err) });
  }
}

/** Mezcla los campos comunes con los propios de este tipo de evento. */
function obj_(base, extra) {
  var o = {};
  for (var k in base) o[k] = base[k];
  for (var k2 in extra) o[k2] = extra[k2];
  return o;
}

/** Permite comprobar desde el navegador que la implementación responde. */
function doGet() {
  return json_({ ok: true, servicio: 'medcompara-captura', version: 2 });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Escribe una fila buscando cada valor por el NOMBRE de su columna.
 *
 * Con appendRow posicional, agregar una columna a una pestaña que ya existía
 * habría corrido todos los valores un lugar: la farmacia caería en la columna
 * del correo y nadie lo notaría hasta leer la hoja. Aquí el orden lo manda la
 * pestaña, no este archivo.
 *
 * Las columnas que falten se agregan a la derecha; lo ya escrito no se toca.
 * Los valores cuya columna no existe ni se pide crear se ignoran en silencio
 * a propósito: son los alias de encabezados viejos (`Laboratorio`, `Estudio`),
 * que solo se llenan en las hojas que todavía los tienen.
 */
function escribir_(ss, name, headers, valores) {
  var s = ss.getSheetByName(name) || ss.insertSheet(name);
  if (s.getLastRow() === 0) {
    s.appendRow(headers);
    s.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    s.setFrozenRows(1);
  } else {
    var actuales = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
    var faltan = [];
    for (var i = 0; i < headers.length; i++) {
      if (actuales.indexOf(headers[i]) === -1) faltan.push(headers[i]);
    }
    if (faltan.length) {
      s.getRange(1, actuales.length + 1, 1, faltan.length).setValues([faltan]).setFontWeight('bold');
    }
  }
  var cols = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  var fila = [];
  for (var j = 0; j < cols.length; j++) {
    var v = valores[cols[j]];
    fila.push(v === undefined || v === null ? '' : v);
  }
  s.appendRow(fila);
  return s;
}
