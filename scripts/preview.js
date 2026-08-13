#!/usr/bin/env node
/**
 * Medcompara — Servidor de preview local
 * ----------------------------------------
 * Sirve el sitio aplicando las reglas del propio vercel.json: cleanUrls,
 * rewrites y redirects condicionados por host. Sin eso, un servidor estático
 * devuelve 404 en /laboratorio y /medicamentos, que es justo lo que hay que
 * revisar antes de desplegar.
 *
 * No se usa `vercel dev` porque exige un script `build` en package.json, y
 * añadir uno cambiaría cómo se despliega en producción — un efecto secundario
 * caro para algo que solo sirve para mirar el sitio en local.
 *
 *   node scripts/preview.js            # http://localhost:3000
 *   node scripts/preview.js --port=8080
 *   node scripts/preview.js --host=labcompara.com   # probar los 301
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

const arg = (n, d) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const PORT = Number(arg('port', 3000));
/** Host simulado, para poder probar los redirects de labcompara sin DNS. */
const HOST_SIM = arg('host', '');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
};

/** Convierte "/blog/:slug" o "/(.*)" al RegExp equivalente + nombres de grupo. */
function compilar(source) {
  const nombres = [];
  const re = source
    .replace(/[.+?^${}()|[\]\\]/g, (m) => (m === '(' || m === ')' ? m : '\\' + m))
    .replace(/:(\w+)\*/g, (_, n) => { nombres.push(n); return '(.*)'; })
    .replace(/:(\w+)/g, (_, n) => { nombres.push(n); return '([^/]+)'; });
  return { re: new RegExp(`^${re}$`), nombres };
}

const REDIRECTS = (cfg.redirects || []).map((r) => ({ ...r, ...compilar(r.source) }));
const REWRITES = (cfg.rewrites || []).map((r) => ({ ...r, ...compilar(r.source) }));

function aplicar(regla, m) {
  let dest = regla.destination;
  regla.nombres.forEach((n, i) => { dest = dest.split(`:${n}*`).join(m[i + 1]).split(`:${n}`).join(m[i + 1]); });
  m.slice(1).forEach((g, i) => { dest = dest.split(`$${i + 1}`).join(g ?? ''); });
  return dest;
}

/** ¿La regla aplica a este host? Replica el `has: [{type:"host"}]` de Vercel. */
function hostCoincide(regla, host) {
  const cond = (regla.has || []).find((h) => h.type === 'host');
  if (!cond) return true;
  return new RegExp(`^${cond.value}$`).test(host);
}

function resolver(urlPath) {
  const candidatos = [urlPath];
  if (cfg.cleanUrls && !path.extname(urlPath)) candidatos.push(urlPath + '.html');
  candidatos.push(path.join(urlPath, 'index.html'));
  for (const c of candidatos) {
    const f = path.join(ROOT, c);
    if (f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  }
  return null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p = decodeURIComponent(url.pathname);
  const host = HOST_SIM || (req.headers.host || '').split(':')[0];

  // 1. redirects (incluye los condicionados por host)
  for (const r of REDIRECTS) {
    const m = p.match(r.re);
    if (m && hostCoincide(r, host)) {
      res.writeHead(r.permanent ? 308 : 307, { Location: aplicar(r, m) });
      return res.end();
    }
  }

  // 2. cleanUrls: /x.html → /x
  if (cfg.cleanUrls && p.endsWith('.html') && p !== '/index.html') {
    res.writeHead(308, { Location: p.slice(0, -5) });
    return res.end();
  }

  // 3. rewrites (no cambian la URL del navegador)
  for (const r of REWRITES) {
    const m = p.match(r.re);
    if (m) { p = aplicar(r, m); break; }
  }

  const archivo = resolver(p === '/' ? '/index.html' : p);
  if (!archivo) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<h1>404</h1><p>No existe <code>${p}</code></p>`);
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(archivo)] || 'application/octet-stream' });
  fs.createReadStream(archivo).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Medcompara — preview local${HOST_SIM ? ` (simulando host ${HOST_SIM})` : ''}`);
  console.log(`  ${REDIRECTS.length} redirects · ${REWRITES.length} rewrites · cleanUrls ${cfg.cleanUrls ? 'on' : 'off'}\n`);
  console.log(`     http://localhost:${PORT}/                 landing`);
  console.log(`     http://localhost:${PORT}/laboratorio      620 estudios`);
  console.log(`     http://localhost:${PORT}/medicamentos     16 GLP-1`);
  console.log(`     http://localhost:${PORT}/blog             159 posts\n`);
  console.log('  Ctrl+C para detener.\n');
});
