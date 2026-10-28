'use strict';
/* =========================================================
   Bodega Fácil — Módulo 1: Caja y Ventas
   ---------------------------------------------------------
   - Sin dependencias ni compilación: abre index.html y listo.
   - Funciona sin internet: los datos viven en este equipo
     (localStorage). Usa "Respaldo" para no perderlos.
   - Organización del archivo:
       1. Utilidades      5. Pantallas de acceso (inicio / PIN)
       2. Datos           6. Caja (pantalla principal)
       3. Estado y reglas 7. Hojas: cobrar, carrito, venta libre...
       4. Hojas y avisos  8. Otras pestañas y arranque
   ========================================================= */

const KEY = 'bodega_v1';
const USER_KEY = 'bodega_usuario';

/* ---------- 1. Utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const soles = n => 'S/ ' + r2(n).toFixed(2);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const pad = n => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => { const x = new Date(d); return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate()); };
const hora = iso => { const d = new Date(iso); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const inicial = s => esc((String(s || '?').trim()[0] || '?').toUpperCase());

function parseNum(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return isFinite(n) ? n : null;
}

function vibrar(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* sin vibración */ } }

let actx;
function sonidoCaja() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, t);
    o.frequency.setValueAtTime(1320, t + 0.08);
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g); g.connect(actx.destination);
    o.start(t); o.stop(t + 0.26);
  } catch (e) { /* sin sonido */ }
}

/* Teclado numérico grande, reutilizable */
function keypad(decimales = true) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', decimales ? '.' : '', '0', '⌫'];
  return '<div class="keypad">' + keys.map(k => k
    ? `<button type="button" data-k="${k}" aria-label="${k === '⌫' ? 'Borrar' : k}">${k}</button>`
    : '<span></span>').join('') + '</div>';
}
function teclear(v, k, { dec = true, max = 7 } = {}) {
  if (k === '⌫') return v.slice(0, -1);
  if (k === '.') return (!dec || v.includes('.')) ? v : (v || '0') + '.';
  if (v.includes('.') && v.split('.')[1].length >= 2) return v;
  if (v.replace('.', '').length >= max) return v;
  return v === '0' ? k : v + k;
}

/* ---------- 2. Datos ---------- */
const nuevaDB = () => ({
  version: 1,
  config: { nombreBodega: '', margen: 20 },
  usuarios: [],   // {id, nombre, pin, rol: 'dueno'|'ayudante'}
  productos: [],  // {id, nombre, emoji, precio, costo|null, stock|null, stockMin, fijado, vendidos, activo}
  ventas: [],     // {id, fecha, usuarioId, items[], total, costoTotal, metodo, clienteId, paga, anulada}
  gastos: [],     // {id, fecha, tipo:'negocio'|'casa', monto, desc, usuarioId}   ← módulo 2
  clientes: [],   // {id, nombre, celular}
  abonos: []      // {id, fecha, clienteId, monto, usuarioId}                     ← módulo 4
});

let db = cargar();

function cargar() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      const base = nuevaDB();
      return Object.assign(base, d, { config: Object.assign(base.config, d.config || {}) });
    }
  } catch (e) { console.error(e); }
  return nuevaDB();
}

function guardar() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (e) { toast('⚠ No se pudo guardar: memoria llena. Haz un respaldo.', 5000); }
}

const EJEMPLOS = [
  ['Pan francés', '🍞', 0.20, 0.15, null, 0, 50],
  ['Gaseosa 500ml', '🥤', 3.00, 2.30, 24, 6, 30],
  ['Huevo', '🥚', 0.60, 0.48, 60, 30, 28],
  ['Leche tarro', '🥛', 4.20, 3.70, 12, 6, 20],
  ['Arroz 1kg', '🍚', 4.50, 3.80, 10, 5, 18],
  ['Galleta soda', '🍪', 1.00, 0.75, 30, 10, 15],
  ['Aceite 1L', '🧴', 9.50, 8.40, 3, 4, 12],
  ['Papel higiénico', '🧻', 1.50, 1.10, 2, 6, 10],
  ['Azúcar 1kg', '🍬', 4.00, 3.40, 8, 4, 9],
  ['Fideos 500g', '🍝', 2.80, 2.20, 15, 5, 8],
  ['Atún lata', '🐟', 6.50, 5.40, 6, 4, 5],
  ['Detergente', '🧼', 3.50, 2.80, 5, 3, 4]
];

const EMOJIS = ['📦', '🍞', '🥚', '🥛', '🍚', '🧴', '🥤', '🍪', '🍬', '🧻', '🧼', '🐟', '🍝', '🧀', '🍌', '🍅', '🧅', '🥔', '🍋', '🍺', '🧃', '🍫', '☕', '🧂', '🔋', '🕯️'];

/* ---------- 3. Estado y reglas de negocio ---------- */
const S = { tab: 'caja', cart: [], query: '', user: null };

const prod = id => db.productos.find(p => p.id === id);
const cliente = id => db.clientes.find(c => c.id === id);
const activos = () => db.productos.filter(p => p.activo !== false);
const esDueno = () => !!S.user && S.user.rol === 'dueno';
const nombreUsuario = id => (db.usuarios.find(u => u.id === id) || {}).nombre || '—';

/* Costo de una unidad: el real si lo registraste; si no, se estima con el margen promedio */
function costoUnit(p) {
  const c = parseNum(p.costo);
  return c != null ? c : r2(p.precio * (1 - db.config.margen / 100));
}

/* Semáforo de stock: rojo = reponer ya, amarillo = por acabarse, verde = bien */
function semaforo(p) {
  if (p.stock == null) return null;
  const min = p.stockMin || 0;
  if (p.stock <= Math.floor(min / 2)) return 'rojo';
  if (p.stock <= min) return 'amarillo';
  return 'verde';
}

function deudaCliente(id) {
  let d = 0;
  db.ventas.forEach(v => { if (!v.anulada && v.metodo === 'fiado' && v.clienteId === id) d += v.total; });
  db.abonos.forEach(a => { if (a.clienteId === id) d -= a.monto; });
  return r2(d);
}

/* Números del día: lo que ves en la tarjeta "Hoy ganaste" */
function statsDia(key) {
  const s = { vendido: 0, costo: 0, efectivo: 0, yape: 0, fiado: 0, gNeg: 0, gCasa: 0, n: 0 };
  for (const v of db.ventas) {
    if (v.anulada || dayKey(v.fecha) !== key) continue;
    s.n++;
    s.vendido += v.total;
    s.costo += v.costoTotal;
    s[v.metodo] += v.total;
  }
  for (const g of db.gastos) {
    if (dayKey(g.fecha) !== key) continue;
    if (g.tipo === 'casa') s.gCasa += g.monto; else s.gNeg += g.monto;
  }
  s.ganancia = r2(s.vendido - s.costo - s.gNeg);          // los gastos de la casa NO restan ganancia
  s.efectivoCaja = r2(s.efectivo - s.gNeg - s.gCasa);      // pero sí salen del cajón
  s.enCaja = r2(s.efectivoCaja + s.yape);                  // el fiado aún no entra a caja
  return s;
}

function topProductos() {
  return activos().slice().sort((a, b) =>
    ((b.fijado ? 1 : 0) - (a.fijado ? 1 : 0)) ||
    ((b.vendidos || 0) - (a.vendidos || 0)) ||
    a.nombre.localeCompare(b.nombre)
  ).slice(0, 8);
}

/* Carrito (la venta actual) */
const cantEn = id => { const i = S.cart.find(x => x.productoId === id); return i ? i.cant : 0; };
const cartTotal = () => r2(S.cart.reduce((t, i) => t + i.precio * i.cant, 0));
const cartCount = () => S.cart.reduce((t, i) => t + i.cant, 0);

function agregar(p, n = 1) {
  const it = S.cart.find(i => i.productoId === p.id);
  if (it) it.cant += n;
  else S.cart.push({ key: p.id, productoId: p.id, nombre: p.nombre, emoji: p.emoji || '📦', precio: p.precio, costo: costoUnit(p), cant: n });
  vibrar(12);
  refreshCaja();
}

function setCant(key, n) {
  const i = S.cart.findIndex(x => x.key === key);
  if (i >= 0) {
    if (n <= 0) S.cart.splice(i, 1); else S.cart[i].cant = n;
  } else if (n > 0) {
    const p = prod(key);
    if (p) return agregar(p, n);
  }
  refreshCaja();
}

function agregarLibre(monto, nota) {
  S.cart.push({
    key: 'libre-' + uid(), productoId: null, nombre: nota || 'Venta libre', emoji: '✏️',
    precio: r2(monto), costo: r2(monto * (1 - db.config.margen / 100)), cant: 1
  });
  refreshCaja();
}

function registrarVenta(metodo, clienteId, paga) {
  const items = S.cart.map(i => ({ productoId: i.productoId, nombre: i.nombre, precio: i.precio, costo: i.costo, cant: i.cant }));
  const v = {
    id: uid(), fecha: new Date().toISOString(), usuarioId: S.user.id, items,
    total: r2(items.reduce((t, i) => t + i.precio * i.cant, 0)),
    costoTotal: r2(items.reduce((t, i) => t + i.costo * i.cant, 0)),
    metodo, clienteId: clienteId || null, paga: paga == null ? null : paga, anulada: false
  };
  db.ventas.push(v);
  items.forEach(it => {
    const p = it.productoId && prod(it.productoId);
    if (!p) return;
    p.vendidos = (p.vendidos || 0) + it.cant;
    if (p.stock != null) p.stock -= it.cant;
  });
  guardar();
  S.cart = [];
  S.query = '';
  return v;
}

function anularVenta(id) {
  const v = db.ventas.find(x => x.id === id);
  if (!v || v.anulada) return false;
  if (!confirm(`¿Anular la venta de ${soles(v.total)} de las ${hora(v.fecha)}?`)) return false;
  v.items.forEach(it => {
    const p = it.productoId && prod(it.productoId);
    if (!p) return;
    p.vendidos = Math.max(0, (p.vendidos || 0) - it.cant);
    if (p.stock != null) p.stock += it.cant;
  });
  v.anulada = true;
  v.anuladaPor = S.user.id;
  v.anuladaFecha = new Date().toISOString();
  guardar();
  toast('Venta anulada');
  return true;
}

/* ---------- 4. Hojas (paneles inferiores) y avisos ---------- */
let sheetOpen = false, sheetTok = 0, ignorePop = false;

const head = titulo => `<div class="sheet-head"><h2>${titulo}</h2><button type="button" class="x" data-close aria-label="Cerrar">✕</button></div>`;

function openSheet(html, mount) {
  const ov = $('#overlay'), sh = $('#sheet');
  sheetTok++;
  const box = document.createElement('div');
  box.innerHTML = html;
  sh.innerHTML = '';
  sh.appendChild(box);
  sh.scrollTop = 0;
  ov.classList.remove('hidden');
  void ov.offsetWidth; // fuerza la animación
  ov.classList.add('show');
  if (!sheetOpen) {
    sheetOpen = true;
    try { history.pushState({ hoja: 1 }, ''); } catch (e) { /* ok */ }
  }
  if (mount) mount(box);
}

function closeSheet(desdeAtras) {
  if (!sheetOpen) return;
  sheetOpen = false;
  const ov = $('#overlay'), tok = ++sheetTok;
  ov.classList.remove('show');
  setTimeout(() => { if (tok === sheetTok) { ov.classList.add('hidden'); $('#sheet').innerHTML = ''; } }, 200);
  if (!desdeAtras && history.state && history.state.hoja) { ignorePop = true; history.back(); }
}

let toastT;
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.add('hidden'), ms);
}

function setView(html) {
  const v = $('#view');
  const box = document.createElement('div');
  box.innerHTML = html;
  v.innerHTML = '';
  v.appendChild(box);
  return box;
}

/* ---------- 5. Pantallas de acceso ---------- */
function pantallaInicio() {
  document.body.classList.add('locked');
  $('#bodegaName').textContent = 'Bodega Fácil';
  const box = setView(`
    <div class="setup">
      <div class="center" style="font-size:56px">🏪</div>
      <h1 class="center">¡Bienvenido!</h1>
      <p class="hint center">Configura tu bodega en 1 minuto. Todo queda guardado en este equipo.</p>
      <label class="f">Nombre de tu bodega<input class="inp" id="sBod" maxlength="30" placeholder="Ej. Bodega Don Lucho"></label>
      <label class="f">Tu nombre<input class="inp" id="sNom" maxlength="20" placeholder="Ej. Lucho"></label>
      <label class="f">Crea un PIN de 4 números<input class="inp" id="sPin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="••••" autocomplete="off"></label>
      <label class="check"><input type="checkbox" id="sEj" checked> Cargar productos de ejemplo para probar</label>
      <button type="button" class="btn-primary big" id="sOk" style="margin-top:16px">Empezar</button>
    </div>`);
  $('#sOk', box).addEventListener('click', () => {
    const bodega = $('#sBod', box).value.trim() || 'Mi Bodega';
    const nombre = $('#sNom', box).value.trim();
    const pin = $('#sPin', box).value.trim();
    if (!nombre) return toast('Escribe tu nombre');
    if (!/^\d{4}$/.test(pin)) return toast('El PIN debe tener 4 números');
    db.config.nombreBodega = bodega;
    const u = { id: uid(), nombre, pin, rol: 'dueno' };
    db.usuarios.push(u);
    if ($('#sEj', box).checked) {
      EJEMPLOS.forEach(([nombre, emoji, precio, costo, stock, stockMin, vendidos]) =>
        db.productos.push({ id: uid(), nombre, emoji, precio, costo, stock, stockMin, fijado: false, vendidos, activo: true }));
    }
    guardar();
    entrar(u);
  });
}

function pantallaQuienAtiende() {
  document.body.classList.add('locked');
  $('#bodegaName').textContent = db.config.nombreBodega || 'Mi Bodega';
  if (db.usuarios.length === 1) return pantallaPin(db.usuarios[0]);
  const box = setView(`
    <div class="setup">
      <h1 class="center">¿Quién atiende?</h1>
      <div class="users">${db.usuarios.map(u => `
        <button type="button" class="user-btn" data-u="${u.id}">
          <span class="avatar">${inicial(u.nombre)}</span>
          <span>${esc(u.nombre)}<small>${u.rol === 'dueno' ? 'Dueño' : 'Ayudante'}</small></span>
        </button>`).join('')}
      </div>
    </div>`);
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-u]');
    if (b) pantallaPin(db.usuarios.find(u => u.id === b.dataset.u));
  });
}

function pantallaPin(u) {
  let pin = '';
  const box = setView(`
    <div class="setup">
      ${db.usuarios.length > 1 ? '<button type="button" class="link" id="volver">← Volver</button>' : ''}
      <div class="center">
        <div class="avatar big">${inicial(u.nombre)}</div>
        <h1>Hola, ${esc(u.nombre)}</h1>
        <p class="hint">Ingresa tu PIN de 4 números</p>
      </div>
      <div class="pin-dots" id="dots"><i></i><i></i><i></i><i></i></div>
      ${keypad(false)}
    </div>`);
  const pintar = () => $$('#dots i', box).forEach((d, i) => d.classList.toggle('on', i < pin.length));
  box.addEventListener('click', e => {
    if (e.target.closest('#volver')) return pantallaQuienAtiende();
    const k = e.target.closest('[data-k]');
    if (!k) return;
    pin = teclear(pin, k.dataset.k, { dec: false, max: 4 });
    pintar();
    if (pin.length < 4) return;
    if (pin === u.pin) return entrar(u);
    const dots = $('#dots', box);
    dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake');
    vibrar([60, 40, 60]);
    toast('PIN incorrecto');
    pin = '';
    setTimeout(pintar, 300);
  });
}

function entrar(u) {
  S.user = u;
  S.tab = 'caja';
  localStorage.setItem(USER_KEY, u.id);
  mostrarApp();
  toast(`Hola, ${u.nombre} 👋`);
}

function cambiarUsuario() {
  if (S.cart.length && !confirm('Hay una venta sin cobrar. ¿Descartarla y cambiar de usuario?')) return;
  S.cart = [];
  S.query = '';
  closeSheet();
  localStorage.removeItem(USER_KEY);
  S.user = null;
  pantallaQuienAtiende();
}

function mostrarApp() {
  document.body.classList.remove('locked');
  $('#bodegaName').textContent = db.config.nombreBodega || 'Mi Bodega';
  $('#userName').textContent = S.user.nombre;
  renderView();
}

/* ---------- 6. Caja (pantalla principal) ---------- */
function renderView() {
  $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === S.tab));
  $('#cartBar').classList.toggle('hidden', S.tab !== 'caja');
  ({ caja: renderCaja, gastos: renderGastos, stock: renderStock, fiados: renderFiados })[S.tab]();
  window.scrollTo(0, 0);
}

function renderCaja() {
  const hoy = statsDia(dayKey());
  const d = new Date(); d.setDate(d.getDate() - 1);
  const ayer = statsDia(dayKey(d));
  const dueno = esDueno();
  const big = dueno ? hoy.ganancia : hoy.vendido;
  const ref = dueno ? ayer.ganancia : ayer.vendido;
  const alertas = activos().filter(p => { const s = semaforo(p); return s === 'rojo' || s === 'amarillo'; });

  let trend = '';
  if (hoy.n && ref > 0) {
    const up = big >= ref;
    trend = `<span class="trend ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} vs ayer</span>`;
  }

  const box = setView(`
    <div class="hoy" id="hoyCard" role="button" tabindex="0">
      <div class="hoy-label"><span>${dueno ? 'HOY GANASTE' : 'HOY VENDISTE'}</span><span class="hoy-more">Ver ventas ›</span></div>
      <div class="hoy-row"><span class="hoy-big ${big < 0 ? 'neg' : ''}">${soles(big)}</span>${trend}</div>
      <div class="hoy-grid">
        ${dueno
          ? `<div><small>Vendiste</small><b>${soles(hoy.vendido)}</b></div>`
          : `<div><small>Ventas</small><b>${hoy.n}</b></div>`}
        <div><small>Gastos</small><b class="txt-rojo">${soles(hoy.gNeg + hoy.gCasa)}</b></div>
        <div><small>En caja</small><b>${soles(hoy.enCaja)}</b></div>
      </div>
      <div class="hoy-pay">💵 ${soles(hoy.efectivoCaja)} &nbsp;·&nbsp; 📱 ${soles(hoy.yape)}${hoy.fiado ? ` &nbsp;·&nbsp; 📒 ${soles(hoy.fiado)}` : ''}</div>
    </div>
    ${alertas.length ? `<button type="button" class="alerta" id="alertaStock">⚠ ${alertas.length} producto${alertas.length > 1 ? 's' : ''} por acabarse <span>›</span></button>` : ''}
    <div class="search">
      <span aria-hidden="true">🔍</span>
      <input id="q" type="search" placeholder="Buscar producto..." autocomplete="off" value="${esc(S.query)}">
      <button type="button" class="kb" id="kbBtn" aria-label="Venta libre con teclado">123</button>
    </div>
    <div id="prodArea"></div>`);

  $('#hoyCard', box).addEventListener('click', hojaDia);
  const al = $('#alertaStock', box);
  if (al) al.addEventListener('click', () => { S.tab = 'stock'; renderView(); });
  $('#kbBtn', box).addEventListener('click', () => hojaVentaLibre(''));
  $('#q', box).addEventListener('input', e => { S.query = e.target.value; renderProdArea(); });
  bindPress($('#prodArea', box));
  renderProdArea();
  updateCartBar();
}

function tileHTML(p) {
  const s = semaforo(p), c = cantEn(p.id);
  return `<button type="button" class="tile ${c ? 'on' : ''}" data-id="${p.id}">
    ${s && s !== 'verde' ? `<i class="dot ${s}"></i>` : ''}
    <span class="emo">${esc(p.emoji || '📦')}</span>
    <span class="tn">${esc(p.nombre)}</span>
    <span class="tp">${soles(p.precio)}</span>
    ${c ? `<span class="badge">${c}</span>` : ''}
  </button>`;
}

function rowHTML(p) {
  const s = semaforo(p), c = cantEn(p.id);
  return `<button type="button" class="row ${c ? 'sel' : ''}" data-id="${p.id}">
    <span class="emo">${esc(p.emoji || '📦')}</span>
    <span class="rn">${esc(p.nombre)}${p.stock != null ? `<small>${s ? `<i class="sem ${s}"></i> ` : ''}Quedan ${p.stock}</small>` : ''}</span>
    <span class="rp">${soles(p.precio)}</span>
  </button>`;
}

function renderProdArea() {
  const area = $('#prodArea');
  if (!area) return;
  const q = norm(S.query.trim());
  if (q) {
    const res = activos().filter(p => norm(p.nombre).includes(q)).slice(0, 30);
    area.innerHTML = res.length
      ? `<div class="sec-title">RESULTADOS</div><div class="list">${res.map(rowHTML).join('')}</div>`
      : `<div class="empty">
          <p>No encontré “${esc(S.query)}”.</p>
          <button type="button" class="btn-sec" data-action="libre">✏️ Vender como venta libre</button>
          ${esDueno() ? `<button type="button" class="btn-sec" data-action="nuevo">📦 Crear producto “${esc(S.query)}”</button>` : ''}
        </div>`;
    return;
  }
  const top = topProductos();
  let tiles = top.map(tileHTML).join('');
  if (top.length < 8 && esDueno()) {
    tiles += `<button type="button" class="tile tile-add" data-action="nuevo"><span class="emo">➕</span><span class="tn">Agregar producto</span></button>`;
  }
  tiles += `<button type="button" class="tile tile-libre" data-action="libre"><span class="emo">✏️</span><span class="tn">VENTA LIBRE</span><span class="tp">Solo monto</span></button>`;
  area.innerHTML = `<div class="sec-title">MÁS VENDIDOS <small>Mantén presionado = cantidad</small></div><div class="grid">${tiles}</div>`;
}

/* Toque = +1 · Mantener presionado = elegir cantidad */
function bindPress(el) {
  let timer = null, largo = false, sx = 0, sy = 0;
  el.addEventListener('pointerdown', e => {
    largo = false;
    clearTimeout(timer);
    const t = e.target.closest('[data-id]');
    if (!t) return;
    sx = e.clientX; sy = e.clientY;
    timer = setTimeout(() => { largo = true; vibrar(30); hojaCantidad(t.dataset.id); }, 450);
  });
  el.addEventListener('pointermove', e => {
    if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) clearTimeout(timer);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => el.addEventListener(ev, () => clearTimeout(timer)));
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('click', e => {
    if (largo) { largo = false; return; }
    const t = e.target.closest('[data-id],[data-action]');
    if (!t) return;
    if (t.dataset.id) {
      const p = prod(t.dataset.id);
      if (!p) return;
      if (S.query) { // desde el buscador: agrega y vuelve a la grilla
        S.query = '';
        const q = $('#q'); if (q) { q.value = ''; q.blur(); }
        toast(`✓ ${p.nombre}`, 1200);
      }
      agregar(p, 1);
    } else if (t.dataset.action === 'libre') {
      hojaVentaLibre(S.query.trim());
    } else if (t.dataset.action === 'nuevo') {
      hojaProducto(null, S.query.trim());
    }
  });
}

function refreshCaja() {
  if (S.tab === 'caja') renderProdArea();
  updateCartBar();
}

function updateCartBar() {
  const n = cartCount();
  $('#cartBar').innerHTML = n
    ? `<button type="button" class="cart-info" id="cartOpen">🛒 <b>${n}</b> ${n === 1 ? 'producto' : 'productos'}<span class="cart-total">${soles(cartTotal())}</span></button>
       <button type="button" class="btn-cobrar" id="cobrarBtn">COBRAR</button>`
    : `<div class="cart-empty">Toca un producto para empezar a vender</div>`;
}

/* ---------- 7. Hojas ---------- */
function hojaCantidad(id) {
  const p = prod(id);
  if (!p) return;
  let n = cantEn(id) || 1;
  openSheet(`
    ${head(esc(p.emoji + ' ' + p.nombre))}
    <div class="qty">
      <button type="button" class="qbtn" data-d="-1" aria-label="Menos">−</button>
      <div class="qnum" id="qn">${n}</div>
      <button type="button" class="qbtn" data-d="1" aria-label="Más">+</button>
    </div>
    <div class="qtotal">${soles(p.precio)} c/u · Total <b id="qt">${soles(n * p.precio)}</b></div>
    <div class="chips" style="justify-content:center">${[2, 3, 5, 10, 12, 20].map(x => `<button type="button" class="chip" data-n="${x}">${x}</button>`).join('')}</div>
    <div class="row2">
      <button type="button" class="btn-sec rojo" id="qQuitar">Quitar</button>
      <button type="button" class="btn-primary" id="qOk">Listo</button>
    </div>`, box => {
    const pintar = () => { $('#qn', box).textContent = n; $('#qt', box).textContent = soles(n * p.precio); };
    box.addEventListener('click', e => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.d) { n = Math.max(1, n + Number(t.dataset.d)); pintar(); }
      else if (t.dataset.n) { n = Number(t.dataset.n); pintar(); }
      else if (t.id === 'qQuitar') { setCant(id, 0); closeSheet(); }
      else if (t.id === 'qOk') { setCant(id, n); closeSheet(); }
    });
  });
}

function hojaVentaLibre(notaInicial) {
  let v = '';
  openSheet(`
    ${head('✏️ Venta libre')}
    <p class="hint">Para lo que vendes “al ojo” o aún no registras. No descuenta stock.</p>
    <div class="amount" id="amt">S/ 0</div>
    <input class="inp" id="nota" maxlength="40" placeholder="¿Qué fue? (opcional) ej. queso" value="${esc(notaInicial)}">
    ${keypad(true)}
    <div class="row2">
      <button type="button" class="btn-sec" id="lAdd">Agregar a la venta</button>
      <button type="button" class="btn-primary" id="lCob">Cobrar ya</button>
    </div>`, box => {
    box.addEventListener('click', e => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.k) {
        v = teclear(v, t.dataset.k);
        $('#amt', box).textContent = 'S/ ' + (v || '0');
        return;
      }
      if (t.id !== 'lAdd' && t.id !== 'lCob') return;
      const monto = parseNum(v);
      if (!monto || monto <= 0) return toast('Escribe el monto');
      agregarLibre(monto, $('#nota', box).value.trim());
      S.query = '';
      if (S.tab === 'caja') { const q = $('#q'); if (q) q.value = ''; renderProdArea(); }
      if (t.id === 'lCob') hojaCobrar(); else { closeSheet(); toast('✓ Agregado a la venta', 1200); }
    });
  });
}

function hojaCarrito() {
  openSheet(`
    ${head('🛒 Venta actual')}
    <div class="list" id="cl"></div>
    <div class="row2">
      <button type="button" class="btn-sec rojo" id="cVac">Vaciar</button>
      <button type="button" class="btn-primary" id="cCob">Cobrar</button>
    </div>`, box => {
    const pintar = () => {
      if (!S.cart.length) { closeSheet(); return; }
      $('#cl', box).innerHTML = S.cart.map(i => `
        <div class="row">
          <span class="emo">${esc(i.emoji)}</span>
          <span class="rn">${esc(i.nombre)}<small>${soles(i.precio)} c/u · ${soles(i.precio * i.cant)}</small></span>
          <button type="button" class="chip sm" data-key="${i.key}" data-d="-1" aria-label="Menos">−</button>
          <b style="min-width:28px;text-align:center">${i.cant}</b>
          <button type="button" class="chip sm" data-key="${i.key}" data-d="1" aria-label="Más">+</button>
        </div>`).join('') +
        `<div class="v-top" style="padding:10px 4px;font-size:18px">Total<span class="v-total">${soles(cartTotal())}</span></div>`;
      $('#cCob', box).textContent = 'Cobrar ' + soles(cartTotal());
    };
    pintar();
    box.addEventListener('click', e => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.key) {
        const it = S.cart.find(i => i.key === t.dataset.key);
        if (it) setCant(it.key, it.cant + Number(t.dataset.d));
        pintar();
      } else if (t.id === 'cVac') {
        if (confirm('¿Vaciar la venta actual?')) { S.cart = []; refreshCaja(); closeSheet(); }
      } else if (t.id === 'cCob') {
        hojaCobrar();
      }
    });
  });
}

function hojaCobrar() {
  if (!S.cart.length) return toast('La venta está vacía');
  const total = cartTotal();
  const st = { m: 'efectivo', paga: null, otro: false, otroStr: '', cli: null, buscar: '', nuevo: false, nom: '', cel: '' };
  const billetes = [10, 20, 50, 100, 200].filter(b => b > total).slice(0, 3);

  openSheet(`
    ${head('Cobrar')}
    <div class="total-big">${soles(total)}</div>
    <div class="metodos">
      <button type="button" data-m="efectivo">💵<span>Efectivo</span></button>
      <button type="button" data-m="yape">📱<span>Yape / Plin</span></button>
      <button type="button" data-m="fiado">📒<span>Fiado</span></button>
    </div>
    <div id="mb"></div>
    <button type="button" class="btn-primary big" id="okVenta">✓ LISTO, VENDIDO</button>`, box => {
    const mb = $('#mb', box), ok = $('#okVenta', box);

    const valido = () => {
      if (st.m === 'efectivo') return st.paga == null || st.paga >= total - 0.001;
      if (st.m === 'fiado') return !!st.cli || (st.nuevo && st.nom.trim().length > 0);
      return true;
    };
    const actualizarBoton = () => {
      ok.disabled = !valido();
      ok.textContent = st.m === 'fiado' ? '📒 ANOTAR FIADO' : '✓ LISTO, VENDIDO';
    };
    const vueltoHTML = () => {
      if (st.paga == null) return '<div class="vuelto nada">Toca con cuánto paga para ver el vuelto</div>';
      const d = r2(st.paga - total);
      return d >= 0 ? `<div class="vuelto ok">VUELTO<b>${soles(d)}</b></div>` : `<div class="vuelto falta">FALTA<b>${soles(-d)}</b></div>`;
    };
    const listaClientes = () => {
      const q = norm(st.buscar);
      const l = db.clientes.filter(c => norm(c.nombre).includes(q))
        .sort((a, b) => a.nombre.localeCompare(b.nombre)).slice(0, 20);
      if (!l.length) return `<p class="hint">${db.clientes.length ? 'No encontrado.' : 'Aún no tienes clientes de fiado.'}</p>`;
      return l.map(c => {
        const d = deudaCliente(c.id);
        return `<button type="button" class="row ${st.cli === c.id ? 'sel' : ''}" data-cli="${c.id}">
          <span class="avatar">${inicial(c.nombre)}</span>
          <span class="rn">${esc(c.nombre)}<small>${d > 0 ? 'Debe ' + soles(d) : 'Sin deuda'}</small></span>
          ${st.cli === c.id ? '✓' : ''}
        </button>`;
      }).join('');
    };

    const pintar = () => {
      $$('[data-m]', box).forEach(b => b.classList.toggle('on', b.dataset.m === st.m));
      if (st.m === 'efectivo') {
        mb.innerHTML = `
          <p class="lbl">¿CON CUÁNTO PAGA?</p>
          <div class="chips">
            <button type="button" class="chip ${st.paga === total && !st.otro ? 'on' : ''}" data-paga="${total}">Exacto</button>
            ${billetes.map(b => `<button type="button" class="chip ${st.paga === b && !st.otro ? 'on' : ''}" data-paga="${b}">S/ ${b}</button>`).join('')}
            <button type="button" class="chip ${st.otro ? 'on' : ''}" data-otro>✎ Otro</button>
          </div>
          ${st.otro ? `<div class="amount" style="font-size:32px;margin-top:10px">S/ ${st.otroStr || '0'}</div>${keypad(true)}` : ''}
          ${vueltoHTML()}`;
      } else if (st.m === 'yape') {
        mb.innerHTML = '<div class="vuelto nada">📱 Verifica que el pago llegó a tu Yape o Plin antes de confirmar.</div>';
      } else {
        mb.innerHTML = `
          <input class="inp" id="fBus" type="search" placeholder="🔍 Buscar cliente..." value="${esc(st.buscar)}" autocomplete="off">
          <div class="list" id="fList" style="margin-top:8px">${listaClientes()}</div>
          ${st.nuevo
            ? `<div class="card" style="margin-top:8px">
                 <p class="lbl">CLIENTE NUEVO</p>
                 <input class="inp" id="fNom" maxlength="30" placeholder="Nombre (ej. Sra. Carmen)" value="${esc(st.nom)}">
                 <input class="inp" id="fCel" style="margin-top:8px" type="tel" inputmode="numeric" maxlength="9" placeholder="Celular (opcional, 9 dígitos)" value="${esc(st.cel)}">
               </div>`
            : '<button type="button" class="btn-sec" data-nuevo style="margin-top:8px">➕ Cliente nuevo</button>'}`;
      }
      actualizarBoton();
    };

    const confirmar = () => {
      if (!valido()) return;
      let clienteId = null;
      if (st.m === 'fiado') {
        if (st.cli) clienteId = st.cli;
        else {
          if (st.cel && !/^9\d{8}$/.test(st.cel)) return toast('El celular debe tener 9 dígitos y empezar con 9');
          const c = { id: uid(), nombre: st.nom.trim(), celular: st.cel || '', creado: new Date().toISOString() };
          db.clientes.push(c);
          clienteId = c.id;
        }
      }
      registrarVenta(st.m, clienteId, st.m === 'efectivo' ? st.paga : null);
      closeSheet();
      sonidoCaja();
      vibrar([20, 40, 20]);
      if (st.m === 'efectivo' && st.paga != null && st.paga > total) toast(`✓ Vendido · Vuelto ${soles(st.paga - total)}`, 3500);
      else if (st.m === 'fiado') toast(`📒 Anotado a ${cliente(clienteId).nombre} · Debe ${soles(deudaCliente(clienteId))}`, 3500);
      else toast('✓ Venta registrada');
      renderView();
    };

    pintar();

    box.addEventListener('click', e => {
      const t = e.target.closest('button');
      if (!t) return;
      const ds = t.dataset;
      if (ds.m) { st.m = ds.m; pintar(); }
      else if (ds.paga) { st.paga = Number(ds.paga); st.otro = false; pintar(); }
      else if ('otro' in ds) { st.otro = true; st.otroStr = ''; st.paga = null; pintar(); }
      else if (ds.k) { st.otroStr = teclear(st.otroStr, ds.k); st.paga = st.otroStr ? Number(st.otroStr) : null; pintar(); }
      else if (ds.cli) { st.cli = st.cli === ds.cli ? null : ds.cli; st.nuevo = false; pintar(); }
      else if ('nuevo' in ds) { st.nuevo = true; st.cli = null; pintar(); setTimeout(() => { const f = $('#fNom', box); if (f) f.focus(); }, 50); }
      else if (t.id === 'okVenta') confirmar();
    });
    box.addEventListener('input', e => {
      const id = e.target.id;
      if (id === 'fBus') { st.buscar = e.target.value; $('#fList', box).innerHTML = listaClientes(); }
      else if (id === 'fNom') { st.nom = e.target.value; actualizarBoton(); }
      else if (id === 'fCel') { st.cel = e.target.value.replace(/\D/g, ''); e.target.value = st.cel; }
    });
  });
}

function ventaHTML(v) {
  const ico = { efectivo: '💵', yape: '📱', fiado: '📒' }[v.metodo];
  const items = v.items.map(i => (i.cant > 1 ? i.cant + '× ' : '') + i.nombre).join(', ');
  const cli = v.clienteId && cliente(v.clienteId) ? ' · ' + cliente(v.clienteId).nombre : '';
  const reciente = Date.now() - new Date(v.fecha).getTime() < 10 * 60 * 1000;
  const puede = !v.anulada && (esDueno() || (v.usuarioId === S.user.id && reciente));
  return `<div class="venta ${v.anulada ? 'anulada' : ''}">
    <div class="v-top"><b>${hora(v.fecha)}</b> ${ico} <span class="v-who">${esc(nombreUsuario(v.usuarioId) + cli)}</span><span class="v-total">${soles(v.total)}</span></div>
    <div class="v-items">${esc(items)}</div>
    ${v.anulada ? `<div class="v-who">Anulada por ${esc(nombreUsuario(v.anuladaPor))}</div>` : ''}
    ${puede ? `<button type="button" class="link-rojo" data-anular="${v.id}">Anular</button>` : ''}
  </div>`;
}

function hojaDia() {
  openSheet(`${head('Ventas de hoy')}<div id="dd"></div>`, box => {
    const pintar = () => {
      const hoy = dayKey(), st = statsDia(hoy);
      const ventas = db.ventas.filter(v => dayKey(v.fecha) === hoy).reverse();
      let html = '';
      if (esDueno()) {
        html += `<div class="resumen">
          <div><small>Vendido</small><b>${soles(st.vendido)}</b></div>
          <div><small>Costo de lo vendido</small><b>${soles(st.costo)}</b></div>
          <div><small>Gastos del negocio</small><b class="txt-rojo">${soles(st.gNeg)}</b></div>
          <div><small>Ganancia</small><b class="${st.ganancia < 0 ? 'txt-rojo' : 'txt-verde'}">${soles(st.ganancia)}</b></div>
        </div>`;
        const por = {};
        ventas.filter(v => !v.anulada).forEach(v => {
          por[v.usuarioId] = por[v.usuarioId] || { t: 0, n: 0 };
          por[v.usuarioId].t += v.total;
          por[v.usuarioId].n++;
        });
        const ids = Object.keys(por);
        if (db.usuarios.length > 1 && ids.length) {
          html += '<p class="lbl" style="margin-top:14px">POR PERSONA</p>' + ids.map(id =>
            `<div class="v-top" style="padding:6px 0">👤 ${esc(nombreUsuario(id))} · ${por[id].n} venta${por[id].n > 1 ? 's' : ''}<span class="v-total">${soles(por[id].t)}</span></div>`).join('');
        }
      }
      html += `<p class="lbl" style="margin-top:14px">DETALLE (${ventas.length})</p>`;
      html += ventas.length ? ventas.map(ventaHTML).join('') : '<p class="hint">Aún no hay ventas hoy.</p>';
      $('#dd', box).innerHTML = html;
    };
    pintar();
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-anular]');
      if (b && anularVenta(b.dataset.anular)) { pintar(); renderView(); }
    });
  });
}

/* --- Menú y administración (solo dueño) --- */
function hojaMenu() {
  const d = esDueno();
  const items = [
    d && ['productos', '📦', 'Mis productos y precios'],
    d && ['usuarios', '👥', 'Usuarios y PIN'],
    d && ['config', '⚙️', 'Configuración'],
    d && ['respaldo', '💾', 'Respaldo de datos'],
    ['cambiar', '🔒', 'Cambiar de usuario']
  ].filter(Boolean);
  openSheet(`
    ${head('Menú')}
    <div class="list menu-list">${items.map(([k, e, t]) => `<button type="button" class="row" data-menu="${k}"><span class="emo">${e}</span><span class="rn">${t}</span>›</button>`).join('')}</div>
    <p class="hint center" style="margin-top:16px">Bodega Fácil · v0.1 · Módulo Caja</p>`, box => {
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-menu]');
      if (!b) return;
      ({ productos: hojaProductos, usuarios: hojaUsuarios, config: hojaConfig, respaldo: hojaRespaldo, cambiar: cambiarUsuario })[b.dataset.menu]();
    });
  });
}

function hojaProductos() {
  let q = '';
  openSheet(`
    ${head('📦 Mis productos')}
    <input class="inp" id="pq" type="search" placeholder="🔍 Buscar..." autocomplete="off">
    <button type="button" class="btn-primary" id="pNew" style="margin-top:8px">➕ Nuevo producto</button>
    <div class="list" id="pl" style="margin-top:12px"></div>`, box => {
    const pintar = () => {
      const l = activos().filter(p => norm(p.nombre).includes(norm(q))).sort((a, b) => a.nombre.localeCompare(b.nombre));
      $('#pl', box).innerHTML = l.map(p => {
        const s = semaforo(p);
        return `<button type="button" class="row" data-id="${p.id}">
          <span class="emo">${esc(p.emoji || '📦')}</span>
          <span class="rn">${p.fijado ? '⭐ ' : ''}${esc(p.nombre)}<small>Costo ${p.costo != null ? soles(p.costo) : '—'} · Stock ${p.stock != null ? p.stock : '—'} ${s ? `<i class="sem ${s}"></i>` : ''}</small></span>
          <span class="rp">${soles(p.precio)}</span>
        </button>`;
      }).join('') || '<p class="hint">Sin productos.</p>';
    };
    pintar();
    $('#pq', box).addEventListener('input', e => { q = e.target.value; pintar(); });
    box.addEventListener('click', e => {
      if (e.target.closest('#pNew')) return hojaProducto(null, '', hojaProductos);
      const b = e.target.closest('[data-id]');
      if (b) hojaProducto(prod(b.dataset.id), '', hojaProductos);
    });
  });
}

function hojaProducto(p, nombreInicial = '', volver = null) {
  const nuevo = !p;
  let emoji = (p && p.emoji) || '📦';
  const val = v => (v == null ? '' : v);
  openSheet(`
    ${head(nuevo ? 'Nuevo producto' : 'Editar producto')}
    <div class="emoji-pick" id="ep">${EMOJIS.map(e => `<button type="button" data-e="${e}" class="${e === emoji ? 'on' : ''}">${e}</button>`).join('')}</div>
    <label class="f">Nombre<input class="inp" id="pNom" maxlength="30" placeholder="Ej. Leche Gloria tarro" value="${esc(p ? p.nombre : nombreInicial)}"></label>
    <div class="row2" style="margin-top:12px">
      <label class="f">Precio de venta S/<input class="inp" id="pPre" inputmode="decimal" placeholder="0.00" value="${esc(val(p && p.precio))}"></label>
      <label class="f">Precio de costo S/<input class="inp" id="pCos" inputmode="decimal" placeholder="Opcional" value="${esc(val(p && p.costo))}"></label>
    </div>
    <div class="margen" id="pMar"></div>
    <div class="row2">
      <label class="f">Stock actual<input class="inp" id="pSto" inputmode="numeric" placeholder="Opcional" value="${esc(val(p && p.stock))}"></label>
      <label class="f">Avisar si quedan<input class="inp" id="pMin" inputmode="numeric" placeholder="Ej. 5" value="${esc(val(p && p.stockMin))}"></label>
    </div>
    <label class="check"><input type="checkbox" id="pFij" ${p && p.fijado ? 'checked' : ''}> ⭐ Fijar en botones rápidos</label>
    <div class="row2">
      ${nuevo ? '<button type="button" class="btn-sec" data-close>Cancelar</button>' : '<button type="button" class="btn-sec rojo" id="pDel">Eliminar</button>'}
      <button type="button" class="btn-primary" id="pOk">Guardar</button>
    </div>`, box => {
    const margen = () => {
      const pr = parseNum($('#pPre', box).value), co = parseNum($('#pCos', box).value), el = $('#pMar', box);
      if (pr && co != null) {
        const g = r2(pr - co);
        el.innerHTML = g >= 0
          ? `Ganas <b class="txt-verde">${soles(g)}</b> por unidad (${Math.round(g / pr * 100)}%)`
          : '<b class="txt-rojo">⚠ Estás vendiendo por debajo del costo</b>';
      } else if (pr) {
        el.textContent = `Sin costo: se estimará con tu margen promedio de ${db.config.margen}%`;
      } else {
        el.textContent = 'Escribe el precio de venta';
      }
    };
    margen();
    box.addEventListener('input', e => { if (e.target.id === 'pPre' || e.target.id === 'pCos') margen(); });
    box.addEventListener('click', e => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.e) {
        emoji = t.dataset.e;
        $$('#ep button', box).forEach(b => b.classList.toggle('on', b.dataset.e === emoji));
      } else if (t.id === 'pDel') {
        if (!confirm(`¿Eliminar “${p.nombre}”? Sus ventas pasadas se conservan.`)) return;
        p.activo = false;
        guardar();
        toast('Producto eliminado');
        if (volver) volver(); else closeSheet();
        renderView();
      } else if (t.id === 'pOk') {
        const nombre = $('#pNom', box).value.trim();
        const precio = parseNum($('#pPre', box).value);
        const costo = parseNum($('#pCos', box).value);
        const stock = parseNum($('#pSto', box).value);
        const min = parseNum($('#pMin', box).value);
        if (!nombre) return toast('Escribe el nombre');
        if (!precio || precio <= 0) return toast('Escribe el precio de venta');
        const data = {
          nombre, emoji, precio: r2(precio),
          costo: costo != null ? r2(costo) : null,
          stock: stock != null ? Math.round(stock) : null,
          stockMin: min != null ? Math.round(min) : (stock != null ? 3 : 0),
          fijado: $('#pFij', box).checked
        };
        if (nuevo) db.productos.push(Object.assign({ id: uid(), vendidos: 0, activo: true }, data));
        else Object.assign(p, data);
        guardar();
        if (nombreInicial) S.query = '';
        toast('✓ Producto guardado');
        if (volver) volver(); else closeSheet();
        renderView();
      }
    });
  });
}

function hojaUsuarios() {
  openSheet(`
    ${head('👥 Usuarios')}
    <div class="list" id="ul"></div>
    <h3 style="margin:20px 0 0">Agregar persona</h3>
    <label class="f">Nombre<input class="inp" id="uNom" maxlength="20" placeholder="Ej. Rosa"></label>
    <div class="row2" style="margin-top:12px">
      <label class="f">PIN (4 números)<input class="inp" id="uPin" type="password" inputmode="numeric" maxlength="4" autocomplete="off"></label>
      <label class="f">Rol<select class="inp" id="uRol"><option value="ayudante">Ayudante</option><option value="dueno">Dueño</option></select></label>
    </div>
    <p class="hint">El <b>ayudante</b> solo vende: no ve costos ni ganancias, y solo puede anular sus propias ventas de los últimos 10 minutos.</p>
    <button type="button" class="btn-primary" id="uAdd">Agregar</button>`, box => {
    const pintar = () => {
      $('#ul', box).innerHTML = db.usuarios.map(u => `
        <div class="row">
          <span class="avatar">${inicial(u.nombre)}</span>
          <span class="rn">${esc(u.nombre)}${u.id === S.user.id ? ' (tú)' : ''}<small>${u.rol === 'dueno' ? 'Dueño' : 'Ayudante'}</small></span>
          <button type="button" class="chip" data-pin="${u.id}">PIN</button>
          ${u.id !== S.user.id ? `<button type="button" class="chip sm" data-del="${u.id}" aria-label="Eliminar">🗑</button>` : ''}
        </div>`).join('');
    };
    pintar();
    box.addEventListener('click', e => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.pin) {
        const u = db.usuarios.find(x => x.id === t.dataset.pin);
        const nuevo = prompt(`Nuevo PIN de 4 números para ${u.nombre}:`);
        if (nuevo === null) return;
        if (!/^\d{4}$/.test(nuevo.trim())) return toast('El PIN debe tener 4 números');
        u.pin = nuevo.trim(); guardar(); toast('✓ PIN actualizado');
      } else if (t.dataset.del) {
        const u = db.usuarios.find(x => x.id === t.dataset.del);
        if (!confirm(`¿Quitar a ${u.nombre}? Sus ventas pasadas se conservan.`)) return;
        db.usuarios = db.usuarios.filter(x => x.id !== u.id);
        guardar(); pintar();
      } else if (t.id === 'uAdd') {
        const nombre = $('#uNom', box).value.trim();
        const pin = $('#uPin', box).value.trim();
        if (!nombre) return toast('Escribe el nombre');
        if (!/^\d{4}$/.test(pin)) return toast('El PIN debe tener 4 números');
        db.usuarios.push({ id: uid(), nombre, pin, rol: $('#uRol', box).value });
        guardar();
        $('#uNom', box).value = ''; $('#uPin', box).value = '';
        pintar();
        toast(`✓ ${nombre} agregado`);
      }
    });
  });
}

function hojaConfig() {
  openSheet(`
    ${head('⚙️ Configuración')}
    <label class="f">Nombre de la bodega<input class="inp" id="cBod" maxlength="30" value="${esc(db.config.nombreBodega)}"></label>
    <label class="f">Margen promedio (%)<input class="inp" id="cMar" inputmode="numeric" value="${db.config.margen}"></label>
    <p class="hint">Se usa para estimar la ganancia de la <b>venta libre</b> y de productos sin precio de costo.</p>
    <button type="button" class="btn-primary" id="cOk" style="margin-top:8px">Guardar</button>`, box => {
    $('#cOk', box).addEventListener('click', () => {
      const m = parseNum($('#cMar', box).value);
      if (m == null || m < 0 || m >= 100) return toast('El margen debe estar entre 0 y 99');
      db.config.nombreBodega = $('#cBod', box).value.trim() || 'Mi Bodega';
      db.config.margen = m;
      guardar();
      $('#bodegaName').textContent = db.config.nombreBodega;
      closeSheet();
      toast('✓ Guardado');
    });
  });
}

function hojaRespaldo() {
  openSheet(`
    ${head('💾 Respaldo')}
    <p class="hint">Tus datos viven solo en este equipo. Descarga un respaldo cada semana y guárdalo en tu WhatsApp o Drive.</p>
    <div class="resumen">
      <div><small>Productos</small><b>${activos().length}</b></div>
      <div><small>Ventas registradas</small><b>${db.ventas.length}</b></div>
    </div>
    <button type="button" class="btn-primary" id="bExp">⬇ Descargar respaldo</button>
    <button type="button" class="btn-sec" id="bImp" style="margin-top:8px">⬆ Restaurar desde archivo</button>
    <input type="file" id="bFile" accept="application/json,.json" class="hidden">`, box => {
    $('#bExp', box).addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(db)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `bodega-respaldo-${dayKey()}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    $('#bImp', box).addEventListener('click', () => $('#bFile', box).click());
    $('#bFile', box).addEventListener('change', e => {
      const f = e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const d = JSON.parse(rd.result);
          if (!Array.isArray(d.productos) || !Array.isArray(d.ventas) || !Array.isArray(d.usuarios) || !d.usuarios.length) throw new Error('formato');
          if (!confirm('Esto REEMPLAZARÁ todos los datos actuales por los del respaldo. ¿Continuar?')) return;
          localStorage.setItem(KEY, JSON.stringify(d));
          localStorage.removeItem(USER_KEY);
          location.reload();
        } catch (err) { toast('⚠ Ese archivo no es un respaldo válido'); }
      };
      rd.readAsText(f);
    });
  });
}

/* ---------- 8. Otras pestañas (se completan en los próximos módulos) ---------- */
const pendiente = (ico, t, x) => `<div class="pendiente"><div class="big">${ico}</div><h3>${t}</h3><p>${x}</p></div>`;

function renderGastos() {
  setView(pendiente('💸', 'Control de gastos', 'Separar los gastos del negocio y los de la casa llega en el siguiente módulo.'));
}

function renderStock() {
  const orden = { rojo: 0, amarillo: 1, verde: 2 };
  const con = activos().filter(p => p.stock != null)
    .sort((a, b) => (orden[semaforo(a)] - orden[semaforo(b)]) || a.nombre.localeCompare(b.nombre));
  const sin = activos().filter(p => p.stock == null);
  const n = { rojo: 0, amarillo: 0, verde: 0 };
  con.forEach(p => n[semaforo(p)]++);
  setView(`
    <div class="resumen" style="grid-template-columns:repeat(3,1fr);margin-top:0">
      <div><small>🔴 Reponer ya</small><b>${n.rojo}</b></div>
      <div><small>🟡 Por acabarse</small><b>${n.amarillo}</b></div>
      <div><small>🟢 Bien</small><b>${n.verde}</b></div>
    </div>
    <div class="list">${con.map(p => `
      <div class="row">
        <i class="sem ${semaforo(p)}"></i>
        <span class="emo">${esc(p.emoji || '📦')}</span>
        <span class="rn">${esc(p.nombre)}<small>Avisar si quedan ${p.stockMin}</small></span>
        <span class="rp">${p.stock} unid.</span>
      </div>`).join('')}</div>
    ${sin.length ? `<p class="hint" style="margin-top:12px">Sin control de stock: ${sin.map(p => esc(p.nombre)).join(', ')}</p>` : ''}
    ${pendiente('🛒', 'Lista de compras automática', 'Ajustar el stock y armar la lista para el mercado mayorista llega en el módulo de Inventario.')}`);
}

function renderFiados() {
  const lista = db.clientes.map(c => ({ c, d: deudaCliente(c.id) })).filter(x => x.d > 0.009).sort((a, b) => b.d - a.d);
  const total = r2(lista.reduce((t, x) => t + x.d, 0));
  setView(`
    <div class="card">
      <div class="hoy-label">TE DEBEN</div>
      <div class="hoy-big" style="color:var(--ambar)">${soles(total)}</div>
      <div class="hint" style="margin:0">${lista.length} cliente${lista.length === 1 ? '' : 's'} con deuda</div>
    </div>
    <div class="list" style="margin-top:12px">${lista.map(({ c, d }) => `
      <div class="row">
        <span class="avatar">${inicial(c.nombre)}</span>
        <span class="rn">${esc(c.nombre)}<small>${c.celular ? '📞 ' + esc(c.celular) : 'Sin celular'}</small></span>
        <span class="rp" style="color:var(--ambar)">${soles(d)}</span>
      </div>`).join('')}</div>
    ${pendiente('💬', 'Cobros y recordatorios por WhatsApp', 'Registrar abonos y enviar el recordatorio amable llega en el módulo de Fiados.')}`);
}

/* ---------- Arranque ---------- */
function bindChrome() {
  $('.tabbar').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    S.tab = b.dataset.tab;
    renderView();
  });
  $('#cartBar').addEventListener('click', e => {
    if (e.target.closest('#cobrarBtn')) hojaCobrar();
    else if (e.target.closest('#cartOpen')) hojaCarrito();
  });
  $('#menuBtn').addEventListener('click', hojaMenu);
  $('#userChip').addEventListener('click', cambiarUsuario);
  $('#overlay').addEventListener('click', e => {
    if (e.target.id === 'overlay' || e.target.closest('[data-close]')) closeSheet();
  });
  window.addEventListener('popstate', () => {
    if (ignorePop) { ignorePop = false; return; }
    if (sheetOpen) closeSheet(true);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
}

function init() {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ok */ }
  bindChrome();
  if (!db.usuarios.length) return pantallaInicio();
  S.user = db.usuarios.find(u => u.id === localStorage.getItem(USER_KEY)) || null;
  if (!S.user) return pantallaQuienAtiende();
  mostrarApp();
}

/* Modo sin internet (en localhost se desactiva para que veas tus cambios al instante) */
if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

init();
