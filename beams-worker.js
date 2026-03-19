// Beams animation — runs entirely off the main thread via OffscreenCanvas
// This keeps the main thread free for user interactions and parsing

let canvas, ctx, beams = [], raf, w = 0, h = 0, dpr = 1, running = true;

function mk() {
  return {
    x: Math.random() * w * 1.5 - w * 0.25,
    y: Math.random() * h * 1.5 - h * 0.25,
    width: 50 + Math.random() * 70,
    length: h * 2.5,
    angle: -35 + Math.random() * 10,
    speed: 0.4 + Math.random() * 0.8,
    opacity: 0.12 + Math.random() * 0.16,
    hue: 190 + Math.random() * 40,
    sat: 70 + Math.random() * 20,
    lig: 55 + Math.random() * 20,
    pulse: Math.random() * Math.PI * 2,
    pSpeed: 0.016 + Math.random() * 0.02
  };
}

function rst(b, i, tot) {
  const col = i % 3, sp = w / 3;
  b.y = h + 100;
  b.x = col * sp + sp / 2 + (Math.random() - 0.5) * sp * 0.5;
  b.width = 70 + Math.random() * 100;
  b.speed = 0.4 + Math.random() * 0.5;
  b.hue = 190 + (i * 40) / tot;
  b.opacity = 0.1 + Math.random() * 0.13;
}

function drw(b) {
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.angle * Math.PI / 180);
  const po = b.opacity * (0.8 + Math.sin(b.pulse) * 0.2);
  const g = ctx.createLinearGradient(0, 0, 0, b.length);
  const hs = `hsla(${b.hue},${b.sat}%,${b.lig}%,`;
  g.addColorStop(0,   hs + '0)');
  g.addColorStop(0.1, hs + (po * 0.5) + ')');
  g.addColorStop(0.4, hs + po + ')');
  g.addColorStop(0.6, hs + po + ')');
  g.addColorStop(0.9, hs + (po * 0.5) + ')');
  g.addColorStop(1,   hs + '0)');
  ctx.fillStyle = g;
  ctx.fillRect(-b.width / 2, 0, b.width, b.length);
  ctx.restore();
}

// Throttle to ~30fps to halve CPU usage — imperceptible visually
let lastT = 0;
function tick(t) {
  if (!running) return;
  raf = requestAnimationFrame(tick);
  if (t - lastT < 33) return; // ~30fps cap
  lastT = t;
  ctx.clearRect(0, 0, w, h);
  // NOTE: blur applied once as CSS filter on the canvas element (set from main thread)
  // NOT via ctx.filter here — that's what was killing performance
  const tot = beams.length;
  beams.forEach((b, i) => {
    b.y -= b.speed;
    b.pulse += b.pSpeed;
    if (b.y + b.length < -100) rst(b, i, tot);
    drw(b);
  });
}

self.onmessage = function(e) {
  const { type } = e.data;

  if (type === 'init') {
    canvas = e.data.canvas; // OffscreenCanvas transferred from main thread
    dpr = e.data.dpr || 1;
    w = e.data.w;
    h = e.data.h;
    ctx = canvas.getContext('2d');
    // 16 beams is plenty — was 26
    beams = Array.from({ length: 16 }, () => mk());
    raf = requestAnimationFrame(tick);
  }

  if (type === 'resize') {
    w = e.data.w;
    h = e.data.h;
    canvas.width = w;
    canvas.height = h;
    beams = Array.from({ length: 16 }, () => mk());
  }

  if (type === 'pause') {
    running = false;
    if (raf) cancelAnimationFrame(raf);
  }

  if (type === 'resume') {
    running = true;
    raf = requestAnimationFrame(tick);
  }
};
