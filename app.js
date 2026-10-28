'use strict';
/* =========================================================
   Bodega Fácil — v0.2: Caja y Ventas + Supabase
   ---------------------------------------------------------
   "Primero el celular, después la nube":
   - Todo se guarda al instante en el equipo (localStorage),
     así se puede vender aunque se vaya el internet.
   - Cada cambio entra a una cola ("pendientes") que se sube
     a Supabase cuando hay señal. Luego se bajan los cambios
     hechos en otros celulares.
   - El dueño inicia sesión con correo una vez por equipo;
     después cada persona cambia de turno con su PIN.

   Organización del archivo:
     1. Utilidades             5. Pantallas de acceso
     2. Datos locales y nube   6. Caja (pantalla principal)
     3. Estado y reglas        7. Hojas: cobrar, carrito...
     4. Hojas y avisos         8. Otras pestañas y arranque
   ========================================================= */

const KEY = 'bodega_v2';
const OUTBOX_KEY = 'bodega_pendientes';
const USER_KEY = 'bodega_usuario';
const TABLAS = ['bodegas', 'usuarios', 'productos', 'clientes', 'ventas', 'gastos', 'abonos'];
const DIAS_LOCAL = 35;      // ventas/gastos que se guardan en el celular (los fiados se guardan siempre)
const PAGINA = 1000;

/* ---------- 1. Utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const soles = n => 'S/ ' + r2(n).toFixed(2);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const pad = n => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => { const x = new Date(d); return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate()); };
const hora = iso => { const d = new Date(iso); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const inicial = s => esc((String(s || '?').trim()[0] || '?').toUpperCase());
const haceDias = n => new Date(Date.now() - n * 864e5).toISOString();

/* IDs únicos creados en el celular (permiten vender sin internet sin duplicar) */
function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* SHA-256 (para no guardar los PIN en texto plano). Funciona también sin HTTPS. */
function sha256(texto) {
  const rr = (v, n) => (v >>> n) | (v << (32 - n));
  const K = [], H = [];
  for (let c = 2, p = 0; p < 64; c++) {
    let primo = true;
    for (let d = 2; d * d <= c; d++) if (c % d === 0) { primo = false; break; }
    if (!primo) continue;
    if (p < 8) H[p] = (Math.pow(c, 1 / 2) * 4294967296) | 0;
    K[p++] = (Math.pow(c, 1 / 3) * 4294967296) | 0;
  }
  const bytes = Array.from(new TextEncoder().encode(texto));
  const bits = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bits >>> (i * 8)) & 255);
  const w = new Array(64);
  for (let j = 0; j < bytes.length; j += 64) {
    for (let i = 0; i < 16; i++) w[i] = (bytes[j + 4 * i] << 24) | (bytes[j + 4 * i + 1] << 16) | (bytes[j + 4 * i + 2] << 8) | bytes[j + 4 * i + 3];
    for (let i = 16; i < 64; i++) {
      const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) | 0; });
  }
  return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}
const pinHash = (bodegaId, pin) => sha256(bodegaId + ':' + pin);

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

/* ---------- 2. Datos locales y sincronización con Supabase ---------- */
const nuevaDB = () => ({
  bodega: null,   // {id, owner_id, nombre, margen}
  usuarios: [],   // {id, nombre, pin_hash, rol: 'dueno'|'ayudante', activo}
  productos: [],  // {id, nombre, emoji, categoria, precio, costo|null, stock|null, stock_min, fijado, vendidos, activo}
  clientes: [],   // {id, nombre, celular}
  ventas: [],     // {id, fecha, usuario_id, items[], total, costo_total, metodo, cliente_id, paga, anulada}
  gastos: [],     // {id, fecha, tipo, monto, descripcion, anulado}   ← módulo 2
  abonos: [],     // {id, fecha, cliente_id, monto}                   ← módulo 4
  cursor: {},     // hasta dónde ya se bajó cada tabla
  ultimaSync: null
});

let db = cargar();
let outbox = cargarOutbox();   // [{t: tabla, op: 'upsert'|'patch', row}]

function cargar() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return Object.assign(nuevaDB(), JSON.parse(raw));
  } catch (e) { console.error(e); }
  return nuevaDB();
}
function cargarOutbox() {
  try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); } catch (e) { return []; }
}
function guardar() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (e) { toast('⚠ Memoria llena en este equipo. Sincroniza y avisa al dueño.', 5000); }
}
function guardarOutbox() {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox)); } catch (e) { /* ok */ }
}
function borrarLocal() {
  db = nuevaDB();
  outbox = [];
  [KEY, OUTBOX_KEY, USER_KEY].forEach(k => localStorage.removeItem(k));
}

const pendiente = (t, id) => outbox.some(o => o.t === t && o.row.id === id);

function upsertLocal(t, fila) {
  if (t === 'bodegas') { db.bodega = Object.assign(db.bodega || {}, fila); return; }
  const ex = db[t].find(x => x.id === fila.id);
  if (ex) Object.assign(ex, fila); else db[t].push(fila);
}

/* Anota un cambio para subirlo. 'upsert' = fila nueva o completa; 'patch' = solo algunas columnas. */
function encolar(t, op, fila) {
  const row = t === 'bodegas' ? Object.assign({}, fila) : Object.assign({ bodega_id: db.bodega.id }, fila);
  const ex = outbox.find(o => o.t === t && o.row.id === row.id && !o.enviando);
  if (ex) {
    Object.assign(ex.row, row);
    if (op === 'upsert') ex.op = 'upsert';
  } else {
    outbox.push({ t, op, row });
  }
  guardarOutbox();
  pintarSync();
  programarSync();
}

/* Guarda en el celular y anota para la nube, en un solo paso */
function guardarFila(t, local, op = 'upsert', nube = local) {
  upsertLocal(t, local);
  guardar();
  encolar(t, op, nube);
}

const NUMERICOS = ['precio', 'costo', 'total', 'costo_total', 'paga', 'monto', 'margen'];
function normFila(f) {
  NUMERICOS.forEach(k => { if (f[k] != null) f[k] = Number(f[k]); });
  if (Array.isArray(f.items)) f.items.forEach(i => { i.precio = Number(i.precio); i.costo = Number(i.costo); i.cant = Number(i.cant); });
  return f;
}

/* Solo se guardan en el celular las ventas y gastos recientes (y todos los fiados) */
function podar() {
  const corte = Date.now() - DIAS_LOCAL * 864e5;
  const reciente = (x, t) => Date.parse(x.fecha) >= corte || pendiente(t, x.id);
  db.ventas = db.ventas.filter(v => v.metodo === 'fiado' || reciente(v, 'ventas'));
  db.gastos = db.gastos.filter(g => reciente(g, 'gastos'));
}

const SYNC = { estado: navigator.onLine ? 'ok' : 'offline', corriendo: false, timer: null, error: '', errorItem: null };

function programarSync(ms = 1500) {
  clearTimeout(SYNC.timer);
  SYNC.timer = setTimeout(sincronizar, ms);
}

async function sincronizar() {
  if (SYNC.corriendo || !db.bodega || !SB.sesion()) return;
  if (!navigator.onLine) return pintarSync('offline');
  SYNC.corriendo = true;
  pintarSync('sync');
  try {
    // 1) Subir lo pendiente, en el mismo orden en que ocurrió
    while (outbox.length) {
      const o = outbox[0];
      o.enviando = true;
      if (o.op === 'patch') {
        const cambios = Object.assign({}, o.row);
        delete cambios.id;
        await SB.patch(o.t, o.row.id, cambios);
      } else {
        await SB.upsert(o.t, o.row);
      }
      outbox.shift();
      guardarOutbox();
    }
    // 2) Bajar lo que cambió (otros celulares, stock calculado en el servidor...)
    const n = await traerCambios();
    SYNC.error = ''; SYNC.errorItem = null;
    pintarSync('ok');
    const escribiendo = document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    if (n && S.user && !sheetOpen && !document.body.classList.contains('locked') && !escribiendo) renderView(false);
  } catch (e) {
    if (outbox[0]) delete outbox[0].enviando;
    if (e.auth) pintarSync('login');
    else if (e.red) pintarSync('offline');
    else { SYNC.error = e.message; SYNC.errorItem = outbox[0] || null; pintarSync('error'); console.error(e); }
  } finally {
    SYNC.corriendo = false;
  }
}

async function traerCambios() {
  let n = 0;
  for (const t of TABLAS) {
    let q = (t === 'bodegas' ? `id=eq.${db.bodega.id}` : `bodega_id=eq.${db.bodega.id}`) + '&select=*';
    const desde = db.cursor[t];
    if (desde) q += `&updated_at=gt.${encodeURIComponent(desde)}`;
    else if (t === 'ventas') q += `&or=(fecha.gte.${encodeURIComponent(haceDias(DIAS_LOCAL))},metodo.eq.fiado)`;
    else if (t === 'gastos') q += `&fecha=gte.${encodeURIComponent(haceDias(DIAS_LOCAL))}`;
    q += `&order=updated_at.asc,id.asc&limit=${PAGINA}`;
    let offset = 0, max = 0;
    for (;;) {
      const filas = await SB.select(t, `${q}&offset=${offset}`);
      for (const f of filas) {
        max = Math.max(max, Date.parse(f.updated_at) || 0);
        if (pendiente(t, f.id)) continue;        // lo de este celular manda hasta que se suba
        const local = t === 'bodegas' ? db.bodega : db[t].find(x => x.id === f.id);
        if (local && local.updated_at === f.updated_at) continue;
        upsertLocal(t, normFila(f));
        n++;
      }
      if (filas.length < PAGINA) break;
      offset += PAGINA;
    }
    if (max) db.cursor[t] = new Date(max - 5000).toISOString();   // 5 s de margen
  }
  podar();
  db.ultimaSync = new Date().toISOString();
  guardar();
  return n;
}

function pintarSync(estado) {
  if (estado) SYNC.estado = estado;
  const chip = $('#syncChip');
  if (!chip) return;
  const n = outbox.length;
  const vista = SYNC.estado === 'ok' && n ? 'pend' : SYNC.estado;
  const ico = { ok: '☁️', pend: '⏳', sync: '🔄', offline: '📴', error: '⚠️', login: '🔑' }[vista];
  chip.className = 'sync-chip ' + vista;
  chip.innerHTML = ico + (n ? `<b>${n}</b>` : '');
  chip.setAttribute('aria-label', textoSync().titulo);
  if (sheetOpen && $('#syncPanel')) pintarPanelSync();
}

function textoSync() {
  const n = outbox.length;
  const p = n ? `${n} cambio${n > 1 ? 's' : ''} por subir.` : 'Todo está guardado en la nube.';
  switch (SYNC.estado) {
    case 'offline': return { titulo: '📴 Sin internet', detalle: `Puedes seguir vendiendo. ${n ? p + ' Se subirán' : 'Todo se subirá'} solo cuando vuelva la señal.` };
    case 'sync': return { titulo: '🔄 Sincronizando…', detalle: p };
    case 'login': return { titulo: '🔑 Tu sesión venció', detalle: `Puedes seguir vendiendo, pero para subir los cambios el dueño debe volver a escribir su contraseña. ${n ? p : ''}` };
    case 'error': return { titulo: '⚠️ Hubo un problema al subir', detalle: `${SYNC.error}. ${p}` };
    default: return { titulo: n ? '⏳ Guardando en la nube…' : '☁️ Sincronizado', detalle: p };
  }
}

/* ---------- 3. Estado y reglas de negocio ---------- */
const S = { tab: 'caja', cart: [], query: '', user: null, catStock: '' };

const EMOJIS = ['📦', '🍞', '🥐', '🥚', '🥛', '🧈', '🧀', '🍚', '🍝', '🧴', '🥤', '🧃', '💧', '🍺', '🍪', '🍫', '🍬', '🥔', '🧻', '🧼', '🧽', '🐟', '🥫', '🥣', '🧂', '🌾', '☕', '🍌', '🍋', '🍅', '🧅', '🦷', '👶', '🔋', '🕯️', '🔥', '🧊', '⚡'];
const CATEGORIAS = ['Abarrotes', 'Bebidas', 'Lácteos y huevos', 'Panadería', 'Golosinas', 'Licores', 'Limpieza', 'Cuidado personal', 'Frutas y verduras', 'Varios', 'Otros'];

const prod = id => db.productos.find(p => p.id === id);
const cliente = id => db.clientes.find(c => c.id === id);
const activos = () => db.productos.filter(p => p.activo !== false);
const usuariosActivos = () => db.usuarios.filter(u => u.activo !== false);
const esDueno = () => !!S.user && S.user.rol === 'dueno';
const nombreUsuario = id => (db.usuarios.find(u => u.id === id) || {}).nombre || '—';
const margen = () => Number(db.bodega && db.bodega.margen != null ? db.bodega.margen : 20);
const categorias = () => Array.from(new Set(CATEGORIAS.concat(activos().map(p => p.categoria).filter(Boolean))));

/* Costo de una unidad: el real si lo registraste; si no, se estima con el margen promedio */
function costoUnit(p) {
  const c = parseNum(p.costo);
  return c != null ? c : r2(p.precio * (1 - margen() / 100));
}

/* Semáforo de stock: rojo = reponer ya, amarillo = por acabarse, verde = bien */
function semaforo(p) {
  if (p.stock == null) return null;
  const min = p.stock_min || 0;
  if (p.stock <= Math.floor(min / 2)) return 'rojo';
  if (p.stock <= min) return 'amarillo';
  return 'verde';
}

function deudaCliente(id) {
  let d = 0;
  db.ventas.forEach(v => { if (!v.anulada && v.metodo === 'fiado' && v.cliente_id === id) d += v.total; });
  db.abonos.forEach(a => { if (a.cliente_id === id) d -= a.monto; });
  return r2(d);
}

/* Números del día: lo que ves en la tarjeta "Hoy ganaste".
   hastaMin: contar solo hasta esa hora (en minutos), para comparar "hoy vs ayer a la misma hora" */
const minutoDelDia = f => { const d = new Date(f); return d.getHours() * 60 + d.getMinutes(); };
function statsDia(key, hastaMin = null) {
  const s = { vendido: 0, costo: 0, efectivo: 0, yape: 0, fiado: 0, gNeg: 0, gCasa: 0, n: 0 };
  const fuera = f => dayKey(f) !== key || (hastaMin != null && minutoDelDia(f) > hastaMin);
  for (const v of db.ventas) {
    if (v.anulada || fuera(v.fecha)) continue;
    s.n++;
    s.vendido += v.total;
    s.costo += v.costo_total;
    s[v.metodo] += v.total;
  }
  for (const g of db.gastos) {
    if (g.anulado || fuera(g.fecha)) continue;
    if (g.tipo === 'casa') s.gCasa += g.monto; else s.gNeg += g.monto;
  }
  s.vendido = r2(s.vendido);
  s.costo = r2(s.costo);
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
const cantEn = id => { const i = S.cart.find(x => x.producto_id === id); return i ? i.cant : 0; };
const cartTotal = () => r2(S.cart.reduce((t, i) => t + i.precio * i.cant, 0));
const cartCount = () => S.cart.reduce((t, i) => t + i.cant, 0);

function agregar(p, n = 1) {
  const it = S.cart.find(i => i.producto_id === p.id);
  if (it) it.cant += n;
  else S.cart.push({ key: p.id, producto_id: p.id, nombre: p.nombre, emoji: p.emoji || '📦', precio: p.precio, costo: costoUnit(p), cant: n });
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
    key: 'libre-' + uid(), producto_id: null, nombre: nota || 'Venta libre', emoji: '✏️',
    precio: r2(monto), costo: r2(monto * (1 - margen() / 100)), cant: 1
  });
  refreshCaja();
}

function registrarVenta(metodo, clienteId, paga) {
  const items = S.cart.map(i => ({ producto_id: i.producto_id, nombre: i.nombre, precio: i.precio, costo: i.costo, cant: i.cant }));
  const v = {
    id: uid(), fecha: new Date().toISOString(), usuario_id: S.user.id, items,
    total: r2(items.reduce((t, i) => t + i.precio * i.cant, 0)),
    costo_total: r2(items.reduce((t, i) => t + i.costo * i.cant, 0)),
    metodo, cliente_id: clienteId || null, paga: paga == null ? null : paga, anulada: false
  };
  // En el celular se descuenta al instante; en la nube lo hace el trigger de la base de datos
  items.forEach(it => {
    const p = it.producto_id && prod(it.producto_id);
    if (!p) return;
    p.vendidos = (p.vendidos || 0) + it.cant;
    if (p.stock != null) p.stock -= it.cant;
  });
  guardarFila('ventas', v);
  S.cart = [];
  S.query = '';
  return v;
}

function anularVenta(id) {
  const v = db.ventas.find(x => x.id === id);
  if (!v || v.anulada) return false;
  if (!confirm(`¿Anular la venta de ${soles(v.total)} de las ${hora(v.fecha)}?`)) return false;
  v.items.forEach(it => {
    const p = it.producto_id && prod(it.producto_id);
    if (!p) return;
    p.vendidos = Math.max(0, (p.vendidos || 0) - it.cant);
    if (p.stock != null) p.stock += it.cant;
  });
  const cambios = { id: v.id, anulada: true, anulada_por: S.user.id, anulada_fecha: new Date().toISOString() };
  guardarFila('ventas', cambios, 'patch');
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
function pantallaSimple(ico, titulo, texto, boton, accion) {
  document.body.classList.add('locked');
  const box = setView(`
    <div class="setup center">
      <div style="font-size:56px;margin-top:24px">${ico}</div>
      <h1>${titulo}</h1>
      <p class="hint">${texto}</p>
      ${boton ? `<button type="button" class="btn-primary" id="psBtn" style="margin-top:16px">${boton}</button>` : ''}
    </div>`);
  if (boton) $('#psBtn', box).addEventListener('click', accion);
}

function pantallaConfig() {
  pantallaSimple('🔧', 'Falta conectar Supabase',
    'Abre el archivo <b>config.js</b> y pega la URL y la clave <i>anon</i> (o <i>publishable</i>) de tu proyecto. Luego recarga esta página.');
}

function pantallaLogin(modo = 'entrar', aviso = '') {
  document.body.classList.add('locked');
  $('#bodegaName').textContent = 'Bodega Fácil';
  const nuevo = modo === 'crear';
  const box = setView(`
    <div class="setup">
      <div class="center" style="font-size:56px">🏪</div>
      <h1 class="center">${nuevo ? 'Crea tu cuenta' : 'Bodega Fácil'}</h1>
      <p class="hint center">${nuevo ? 'Solo el dueño necesita cuenta. Tus ayudantes entran con un PIN.' : 'Entra con la cuenta del dueño de la bodega.'}</p>
      ${aviso ? `<div class="aviso">${esc(aviso)}</div>` : ''}
      <label class="f">Correo<input class="inp" id="lEmail" type="email" inputmode="email" autocomplete="email" placeholder="tucorreo@gmail.com"></label>
      <label class="f">Contraseña<input class="inp" id="lPass" type="password" autocomplete="${nuevo ? 'new-password' : 'current-password'}" placeholder="${nuevo ? 'Mínimo 6 caracteres' : ''}"></label>
      <button type="button" class="btn-primary big" id="lOk" style="margin-top:16px">${nuevo ? 'Crear cuenta' : 'Entrar'}</button>
      <button type="button" class="link" id="lAlt" style="width:100%;margin-top:8px">${nuevo ? '¿Ya tienes cuenta? Inicia sesión' : '¿Primera vez? Crea tu cuenta'}</button>
    </div>`);
  $('#lAlt', box).addEventListener('click', () => pantallaLogin(nuevo ? 'entrar' : 'crear'));
  $('#lOk', box).addEventListener('click', async () => {
    const email = $('#lEmail', box).value.trim().toLowerCase();
    const pass = $('#lPass', box).value;
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Escribe un correo válido');
    if (pass.length < 6) return toast('La contraseña debe tener al menos 6 caracteres');
    const btn = $('#lOk', box);
    btn.disabled = true; btn.textContent = 'Un momento…';
    try {
      const s = nuevo ? await SB.registrar(email, pass) : await SB.entrar(email, pass);
      if (!s) return pantallaLogin('entrar', 'Te enviamos un correo para confirmar tu cuenta. Ábrelo y luego inicia sesión aquí.');
      despuesDeLogin();
    } catch (e) {
      toast(e.message, 4000);
      btn.disabled = false; btn.textContent = nuevo ? 'Crear cuenta' : 'Entrar';
    }
  });
}

function despuesDeLogin() {
  const s = SB.sesion();
  if (db.bodega && db.bodega.owner_id && db.bodega.owner_id !== s.user.id) borrarLocal();   // otra cuenta
  if (!db.bodega) return prepararBodega();
  arrancarTurno();
  sincronizar();
}

async function prepararBodega() {
  pantallaSimple('⏳', 'Buscando tu bodega…', 'Un momento.');
  try {
    const filas = await SB.select('bodegas', 'select=*&limit=1');
    if (!filas.length) return pantallaCrearBodega();
    db = nuevaDB();
    db.bodega = normFila(filas[0]);
    pantallaSimple('⬇️', 'Descargando tu bodega…', 'Productos, ventas y fiados. Solo la primera vez tarda un poco.');
    await traerCambios();
    arrancarTurno();
  } catch (e) {
    if (e.auth) { SB.salir(); return pantallaLogin(); }
    pantallaSimple('📴', 'No se pudo conectar',
      e.red ? 'La primera vez necesitas internet para descargar tu bodega.' : esc(e.message),
      'Reintentar', prepararBodega);
  }
}

function pantallaCrearBodega() {
  document.body.classList.add('locked');
  const box = setView(`
    <div class="setup">
      <div class="center" style="font-size:56px">🏪</div>
      <h1 class="center">Configura tu bodega</h1>
      <p class="hint center">Solo una vez. Luego cada persona entra con su PIN.</p>
      <label class="f">Nombre de tu bodega<input class="inp" id="sBod" maxlength="30" placeholder="Ej. Bodega Don Lucho"></label>
      <label class="f">Tu nombre<input class="inp" id="sNom" maxlength="20" placeholder="Ej. Lucho"></label>
      <label class="f">Crea un PIN de 4 números<input class="inp" id="sPin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="••••" autocomplete="off"></label>
      <label class="check"><input type="checkbox" id="sEj" checked> <span>Cargar bodega de ejemplo<small class="hint" style="display:block;margin:0">60 productos, una semana de ventas y fiados para probar</small></span></label>
      <button type="button" class="btn-primary big" id="sOk" style="margin-top:16px">Empezar</button>
      <button type="button" class="link" id="sSalir" style="width:100%;margin-top:8px">Usar otra cuenta</button>
    </div>`);
  $('#sSalir', box).addEventListener('click', () => { SB.salir(); borrarLocal(); pantallaLogin(); });
  $('#sOk', box).addEventListener('click', async () => {
    const bodega = $('#sBod', box).value.trim() || 'Mi Bodega';
    const nombre = $('#sNom', box).value.trim();
    const pin = $('#sPin', box).value.trim();
    const ejemplo = $('#sEj', box).checked;
    if (!nombre) return toast('Escribe tu nombre');
    if (!/^\d{4}$/.test(pin)) return toast('El PIN debe tener 4 números');
    const btn = $('#sOk', box);
    btn.disabled = true; btn.textContent = ejemplo ? 'Preparando la bodega de ejemplo…' : 'Creando…';
    const bid = uid(), usuId = uid();
    try {
      const msg = await SB.rpc('crear_bodega', {
        p_id: bid, p_nombre: bodega, p_usuario_id: usuId, p_usuario_nombre: nombre,
        p_pin_hash: pinHash(bid, pin), p_ejemplo: ejemplo
      });
      db = nuevaDB();
      db.bodega = { id: bid, owner_id: SB.sesion().user.id, nombre: bodega, margen: 20 };
      await traerCambios();
      entrar(db.usuarios.find(u => u.id === usuId));
      if (ejemplo) toast('✓ ' + msg, 5000);
    } catch (e) {
      if (e.auth) { SB.salir(); return pantallaLogin(); }
      toast(e.message, 5000);
      btn.disabled = false; btn.textContent = 'Empezar';
    }
  });
}

function arrancarTurno() {
  const u = usuariosActivos().find(x => x.id === localStorage.getItem(USER_KEY));
  if (u) { S.user = u; mostrarApp(); }
  else pantallaQuienAtiende();
}

function pantallaQuienAtiende() {
  document.body.classList.add('locked');
  $('#bodegaName').textContent = db.bodega.nombre || 'Mi Bodega';
  const lista = usuariosActivos();
  if (lista.length === 1) return pantallaPin(lista[0]);
  const box = setView(`
    <div class="setup">
      <h1 class="center">¿Quién atiende?</h1>
      <div class="users">${lista.map(u => `
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
      ${usuariosActivos().length > 1 ? '<button type="button" class="link" id="volver">← Volver</button>' : ''}
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
    if (pinHash(db.bodega.id, pin) === u.pin_hash) return entrar(u);
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

function cerrarSesion() {
  const n = outbox.length;
  const msg = n
    ? `⚠ Hay ${n} cambio${n > 1 ? 's' : ''} que AÚN NO se subieron y se perderán. ¿Cerrar sesión de todos modos?`
    : '¿Cerrar sesión en este equipo? Tus datos quedan seguros en la nube.';
  if (!confirm(msg)) return;
  closeSheet();
  SB.salir();
  borrarLocal();
  S.user = null; S.cart = [];
  pantallaLogin();
}

function mostrarApp() {
  document.body.classList.remove('locked');
  $('#bodegaName').textContent = db.bodega.nombre || 'Mi Bodega';
  $('#userName').textContent = S.user.nombre;
  pintarSync();
  renderView();
}

/* ---------- 6. Caja (pantalla principal) ---------- */
function renderView(arriba = true) {
  $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === S.tab));
  $('#cartBar').classList.toggle('hidden', S.tab !== 'caja');
  const y = window.scrollY;
  ({ caja: renderCaja, gastos: renderGastos, stock: renderStock, fiados: renderFiados })[S.tab]();
  window.scrollTo(0, arriba ? 0 : y);
}

function renderCaja() {
  const hoy = statsDia(dayKey());
  const d = new Date(); d.setDate(d.getDate() - 1);
  const ayer = statsDia(dayKey(d), minutoDelDia(new Date()));   // ayer, hasta esta misma hora
  const dueno = esDueno();
  const big = dueno ? hoy.ganancia : hoy.vendido;
  const ref = dueno ? ayer.ganancia : ayer.vendido;
  const alertas = activos().filter(p => { const s = semaforo(p); return s === 'rojo' || s === 'amarillo'; });

  let trend = '';
  if (hoy.n && ref > 0) {
    const up = big >= ref;
    const pct = Math.round(Math.abs(big - ref) / ref * 100);
    trend = `<span class="trend ${up ? 'up' : 'down'}" title="Comparado con ayer a esta misma hora">${up ? '▲' : '▼'} ${pct}% vs ayer</span>`;
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
  if (al) al.addEventListener('click', () => { S.tab = 'stock'; S.catStock = 'alerta'; renderView(); });
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
    <span class="rn">${esc(p.nombre)}<small>${s ? `<i class="sem ${s}"></i> Quedan ${p.stock} · ` : ''}${esc(p.categoria || '')}</small></span>
    <span class="rp">${soles(p.precio)}</span>
  </button>`;
}

function renderProdArea() {
  const area = $('#prodArea');
  if (!area) return;
  const q = norm(S.query.trim());
  if (q) {
    const res = activos().filter(p => norm(p.nombre + ' ' + (p.categoria || '')).includes(q))
      .sort((a, b) => (b.vendidos || 0) - (a.vendidos || 0)).slice(0, 30);
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
    <div class="qtotal">${soles(p.precio)} c/u · Total <b id="qt">${soles(n * p.precio)}</b>${p.stock != null ? ` · Quedan ${p.stock}` : ''}</div>
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
          const c = { id: uid(), nombre: st.nom.trim(), celular: st.cel || '' };
          guardarFila('clientes', c);
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
  const cli = v.cliente_id && cliente(v.cliente_id) ? ' · ' + cliente(v.cliente_id).nombre : '';
  const reciente = Date.now() - new Date(v.fecha).getTime() < 10 * 60 * 1000;
  const puede = !v.anulada && (esDueno() || (v.usuario_id === S.user.id && reciente));
  const nube = pendiente('ventas', v.id) ? ' <span title="Aún no se sube">⏳</span>' : '';
  return `<div class="venta ${v.anulada ? 'anulada' : ''}">
    <div class="v-top"><b>${hora(v.fecha)}</b> ${ico} <span class="v-who">${esc(nombreUsuario(v.usuario_id) + cli)}</span>${nube}<span class="v-total">${soles(v.total)}</span></div>
    <div class="v-items">${esc(items)}</div>
    ${v.anulada ? `<div class="v-who">Anulada por ${esc(nombreUsuario(v.anulada_por))}</div>` : ''}
    ${puede ? `<button type="button" class="link-rojo" data-anular="${v.id}">Anular</button>` : ''}
  </div>`;
}

function hojaDia() {
  openSheet(`${head('Ventas de hoy')}<div id="dd"></div>`, box => {
    const pintar = () => {
      const hoy = dayKey(), st = statsDia(hoy);
      const ventas = db.ventas.filter(v => dayKey(v.fecha) === hoy).sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha));
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
          por[v.usuario_id] = por[v.usuario_id] || { t: 0, n: 0 };
          por[v.usuario_id].t += v.total;
          por[v.usuario_id].n++;
        });
        const ids = Object.keys(por);
        if (usuariosActivos().length > 1 && ids.length) {
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
      if (b && anularVenta(b.dataset.anular)) { pintar(); renderView(false); }
    });
  });
}

/* --- Sincronización --- */
function pintarPanelSync() {
  const p = $('#syncPanel');
  if (!p) return;
  const t = textoSync();
  const cuenta = {};
  outbox.forEach(o => { cuenta[o.t] = (cuenta[o.t] || 0) + 1; });
  const nombres = { ventas: 'ventas', productos: 'productos', clientes: 'clientes', usuarios: 'usuarios', gastos: 'gastos', abonos: 'abonos', bodegas: 'configuración' };
  const ses = SB.sesion();
  p.innerHTML = `
    <div class="card">
      <h3 style="margin:0 0 4px">${t.titulo}</h3>
      <p class="hint" style="margin:0">${esc(t.detalle)}</p>
      ${Object.keys(cuenta).length ? `<p class="hint" style="margin:8px 0 0">Pendiente: ${Object.keys(cuenta).map(k => `${cuenta[k]} ${nombres[k] || k}`).join(', ')}</p>` : ''}
      <p class="hint" style="margin:8px 0 0">Última sincronización: ${db.ultimaSync ? new Date(db.ultimaSync).toLocaleString('es-PE') : '—'}</p>
      <p class="hint" style="margin:4px 0 0">Cuenta: ${esc(ses ? ses.user.email : '—')}</p>
    </div>
    ${SYNC.estado === 'login' ? `
      <label class="f">Contraseña del dueño<input class="inp" id="rePass" type="password" autocomplete="current-password"></label>
      <button type="button" class="btn-primary" id="reLogin" style="margin-top:8px">Volver a entrar</button>` : ''}
    <button type="button" class="btn-primary" id="syncYa" style="margin-top:12px" ${SYNC.estado === 'sync' ? 'disabled' : ''}>🔄 Sincronizar ahora</button>
    ${SYNC.estado === 'error' && SYNC.errorItem && esDueno() ? `
      <button type="button" class="btn-sec rojo" id="syncDescartar" style="margin-top:8px">Descartar el cambio con problema (${esc(nombres[SYNC.errorItem.t] || SYNC.errorItem.t)})</button>` : ''}`;
}

function hojaSync() {
  openSheet(`${head('☁️ Sincronización')}<div id="syncPanel"></div>`, box => {
    pintarPanelSync();
    box.addEventListener('click', async e => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.id === 'syncYa') sincronizar();
      else if (t.id === 'syncDescartar') {
        if (!confirm('Este cambio no se subirá nunca. ¿Descartarlo?')) return;
        const i = outbox.indexOf(SYNC.errorItem);
        if (i >= 0) outbox.splice(i, 1);
        guardarOutbox();
        SYNC.error = ''; SYNC.errorItem = null;
        sincronizar();
      } else if (t.id === 'reLogin') {
        const ses = SB.sesion();
        try {
          const nueva = await SB.entrar(ses.user.email, $('#rePass', box).value);
          if (nueva.user.id !== db.bodega.owner_id) { toast('Esa no es la cuenta de esta bodega'); return; }
          toast('✓ Sesión renovada');
          sincronizar();
        } catch (err) { toast(err.message, 4000); }
      }
    });
  });
}

/* --- Menú y administración --- */
function hojaMenu() {
  const d = esDueno();
  const items = [
    d && ['productos', '📦', 'Mis productos y precios'],
    d && ['usuarios', '👥', 'Personas y PIN'],
    ['sync', '☁️', 'Sincronización'],
    d && ['config', '⚙️', 'Configuración'],
    d && ['respaldo', '💾', 'Descargar respaldo'],
    ['cambiar', '🔒', 'Cambiar de turno'],
    d && ['salir', '🚪', 'Cerrar sesión en este equipo']
  ].filter(Boolean);
  openSheet(`
    ${head('Menú')}
    <div class="list menu-list">${items.map(([k, e, t]) => `<button type="button" class="row" data-menu="${k}"><span class="emo">${e}</span><span class="rn">${t}</span>›</button>`).join('')}</div>
    <p class="hint center" style="margin-top:16px">Bodega Fácil · v0.2 · Caja + nube</p>`, box => {
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-menu]');
      if (!b) return;
      ({ productos: hojaProductos, usuarios: hojaUsuarios, sync: hojaSync, config: hojaConfig, respaldo: hojaRespaldo, cambiar: cambiarUsuario, salir: cerrarSesion })[b.dataset.menu]();
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
      const l = activos().filter(p => norm(p.nombre + ' ' + (p.categoria || '')).includes(norm(q)))
        .sort((a, b) => (a.categoria || '').localeCompare(b.categoria || '') || a.nombre.localeCompare(b.nombre));
      let cat = null;
      $('#pl', box).innerHTML = l.map(p => {
        const s = semaforo(p);
        const titulo = p.categoria !== cat ? `<p class="lbl" style="margin:10px 0 2px">${esc((cat = p.categoria) || 'Sin categoría').toUpperCase()}</p>` : '';
        return `${titulo}<button type="button" class="row" data-id="${p.id}">
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
  const cats = categorias();
  const catActual = (p && p.categoria) || 'Otros';
  openSheet(`
    ${head(nuevo ? 'Nuevo producto' : 'Editar producto')}
    <div class="emoji-pick" id="ep">${EMOJIS.map(e => `<button type="button" data-e="${e}" class="${e === emoji ? 'on' : ''}">${e}</button>`).join('')}</div>
    <label class="f">Nombre<input class="inp" id="pNom" maxlength="40" placeholder="Ej. Leche Gloria tarro" value="${esc(p ? p.nombre : nombreInicial)}"></label>
    <label class="f">Categoría<select class="inp" id="pCat">${cats.map(c => `<option ${c === catActual ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
    <div class="row2" style="margin-top:12px">
      <label class="f">Precio de venta S/<input class="inp" id="pPre" inputmode="decimal" placeholder="0.00" value="${esc(val(p && p.precio))}"></label>
      <label class="f">Precio de costo S/<input class="inp" id="pCos" inputmode="decimal" placeholder="Opcional" value="${esc(val(p && p.costo))}"></label>
    </div>
    <div class="margen" id="pMar"></div>
    <div class="row2">
      <label class="f">Stock actual<input class="inp" id="pSto" inputmode="numeric" placeholder="Opcional" value="${esc(val(p && p.stock))}"></label>
      <label class="f">Avisar si quedan<input class="inp" id="pMin" inputmode="numeric" placeholder="Ej. 5" value="${esc(val(p && p.stock_min))}"></label>
    </div>
    <label class="check"><input type="checkbox" id="pFij" ${p && p.fijado ? 'checked' : ''}> ⭐ Fijar en botones rápidos</label>
    <div class="row2">
      ${nuevo ? '<button type="button" class="btn-sec" data-close>Cancelar</button>' : '<button type="button" class="btn-sec rojo" id="pDel">Eliminar</button>'}
      <button type="button" class="btn-primary" id="pOk">Guardar</button>
    </div>`, box => {
    const pintarMargen = () => {
      const pr = parseNum($('#pPre', box).value), co = parseNum($('#pCos', box).value), el = $('#pMar', box);
      if (pr && co != null) {
        const g = r2(pr - co);
        el.innerHTML = g >= 0
          ? `Ganas <b class="txt-verde">${soles(g)}</b> por unidad (${Math.round(g / pr * 100)}%)`
          : '<b class="txt-rojo">⚠ Estás vendiendo por debajo del costo</b>';
      } else if (pr) {
        el.textContent = `Sin costo: se estimará con tu margen promedio de ${margen()}%`;
      } else {
        el.textContent = 'Escribe el precio de venta';
      }
    };
    pintarMargen();
    box.addEventListener('input', e => { if (e.target.id === 'pPre' || e.target.id === 'pCos') pintarMargen(); });
    box.addEventListener('click', e => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.e) {
        emoji = t.dataset.e;
        $$('#ep button', box).forEach(b => b.classList.toggle('on', b.dataset.e === emoji));
      } else if (t.id === 'pDel') {
        if (!confirm(`¿Eliminar “${p.nombre}”? Sus ventas pasadas se conservan.`)) return;
        guardarFila('productos', { id: p.id, activo: false }, 'patch');
        toast('Producto eliminado');
        if (volver) volver(); else closeSheet();
        renderView(false);
      } else if (t.id === 'pOk') {
        const nombre = $('#pNom', box).value.trim();
        const precio = parseNum($('#pPre', box).value);
        const costo = parseNum($('#pCos', box).value);
        const stock = parseNum($('#pSto', box).value);
        const min = parseNum($('#pMin', box).value);
        if (!nombre) return toast('Escribe el nombre');
        if (!precio || precio <= 0) return toast('Escribe el precio de venta');
        const data = {
          nombre, emoji, categoria: $('#pCat', box).value, precio: r2(precio),
          costo: costo != null ? r2(costo) : null,
          stock_min: min != null ? Math.round(min) : (stock != null ? 3 : 0),
          fijado: $('#pFij', box).checked
        };
        const stockNuevo = stock != null ? Math.round(stock) : null;
        if (nuevo) {
          const fila = Object.assign({ id: uid(), stock: stockNuevo, activo: true }, data);
          guardarFila('productos', Object.assign({ vendidos: 0 }, fila), 'upsert', fila);
        } else {
          // El stock solo se envía si lo cambiaste, para no pisar lo que vendieron otros celulares
          if (stockNuevo !== p.stock) data.stock = stockNuevo;
          guardarFila('productos', Object.assign({ id: p.id }, data), 'patch');
        }
        if (nombreInicial) S.query = '';
        toast('✓ Producto guardado');
        if (volver) volver(); else closeSheet();
        renderView(false);
      }
    });
  });
}

function hojaUsuarios() {
  openSheet(`
    ${head('👥 Personas que atienden')}
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
      $('#ul', box).innerHTML = usuariosActivos().map(u => `
        <div class="row">
          <span class="avatar">${inicial(u.nombre)}</span>
          <span class="rn">${esc(u.nombre)}${u.id === S.user.id ? ' (tú)' : ''}<small>${u.rol === 'dueno' ? 'Dueño' : 'Ayudante'}</small></span>
          <button type="button" class="chip" data-pin="${u.id}">PIN</button>
          ${u.id !== S.user.id ? `<button type="button" class="chip sm" data-del="${u.id}" aria-label="Quitar">🗑</button>` : ''}
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
        guardarFila('usuarios', { id: u.id, pin_hash: pinHash(db.bodega.id, nuevo.trim()) }, 'patch');
        toast('✓ PIN actualizado');
      } else if (t.dataset.del) {
        const u = db.usuarios.find(x => x.id === t.dataset.del);
        if (!confirm(`¿Quitar a ${u.nombre}? Sus ventas pasadas se conservan.`)) return;
        guardarFila('usuarios', { id: u.id, activo: false }, 'patch');
        pintar();
      } else if (t.id === 'uAdd') {
        const nombre = $('#uNom', box).value.trim();
        const pin = $('#uPin', box).value.trim();
        if (!nombre) return toast('Escribe el nombre');
        if (!/^\d{4}$/.test(pin)) return toast('El PIN debe tener 4 números');
        guardarFila('usuarios', { id: uid(), nombre, pin_hash: pinHash(db.bodega.id, pin), rol: $('#uRol', box).value, activo: true });
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
    <label class="f">Nombre de la bodega<input class="inp" id="cBod" maxlength="30" value="${esc(db.bodega.nombre)}"></label>
    <label class="f">Margen promedio (%)<input class="inp" id="cMar" inputmode="numeric" value="${margen()}"></label>
    <p class="hint">Se usa para estimar la ganancia de la <b>venta libre</b> y de productos sin precio de costo.</p>
    <button type="button" class="btn-primary" id="cOk" style="margin-top:8px">Guardar</button>`, box => {
    $('#cOk', box).addEventListener('click', () => {
      const m = parseNum($('#cMar', box).value);
      if (m == null || m < 0 || m >= 100) return toast('El margen debe estar entre 0 y 99');
      guardarFila('bodegas', { id: db.bodega.id, nombre: $('#cBod', box).value.trim() || 'Mi Bodega', margen: m }, 'patch');
      $('#bodegaName').textContent = db.bodega.nombre;
      closeSheet();
      toast('✓ Guardado');
    });
  });
}

function hojaRespaldo() {
  openSheet(`
    ${head('💾 Respaldo')}
    <p class="hint">Tus datos ya se guardan en la nube (Supabase). Este archivo es una copia extra de lo que hay en este equipo, por si quieres revisarla en Excel o guardarla aparte.</p>
    <div class="resumen">
      <div><small>Productos</small><b>${activos().length}</b></div>
      <div><small>Ventas en este equipo</small><b>${db.ventas.length}</b></div>
    </div>
    <button type="button" class="btn-primary" id="bExp">⬇ Descargar copia (.json)</button>`, box => {
    $('#bExp', box).addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(db)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `bodega-respaldo-${dayKey()}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  });
}

/* ---------- 8. Otras pestañas (se completan en los próximos módulos) ---------- */
const pendienteHTML = (ico, t, x) => `<div class="pendiente"><div class="big">${ico}</div><h3>${t}</h3><p>${x}</p></div>`;

function renderGastos() {
  setView(pendienteHTML('💸', 'Control de gastos', 'Separar los gastos del negocio y los de la casa llega en el siguiente módulo.'));
}

function renderStock() {
  const orden = { rojo: 0, amarillo: 1, verde: 2 };
  const con = activos().filter(p => p.stock != null);
  const n = { rojo: 0, amarillo: 0, verde: 0 };
  con.forEach(p => n[semaforo(p)]++);
  const cats = Array.from(new Set(con.map(p => p.categoria || 'Otros'))).sort();
  const f = S.catStock;
  const lista = con
    .filter(p => !f || (f === 'alerta' ? semaforo(p) !== 'verde' : (p.categoria || 'Otros') === f))
    .sort((a, b) => (orden[semaforo(a)] - orden[semaforo(b)]) || a.nombre.localeCompare(b.nombre));
  const sin = activos().filter(p => p.stock == null);
  const box = setView(`
    <div class="resumen" style="grid-template-columns:repeat(3,1fr);margin-top:0">
      <div><small>🔴 Reponer ya</small><b>${n.rojo}</b></div>
      <div><small>🟡 Por acabarse</small><b>${n.amarillo}</b></div>
      <div><small>🟢 Bien</small><b>${n.verde}</b></div>
    </div>
    <div class="chips scroll-x" id="catF">
      <button type="button" class="chip ${!f ? 'on' : ''}" data-c="">Todos</button>
      <button type="button" class="chip ${f === 'alerta' ? 'on' : ''}" data-c="alerta">⚠ Por reponer</button>
      ${cats.map(c => `<button type="button" class="chip ${f === c ? 'on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('')}
    </div>
    <div class="list" style="margin-top:10px">${lista.map(p => `
      <div class="row">
        <i class="sem ${semaforo(p)}"></i>
        <span class="emo">${esc(p.emoji || '📦')}</span>
        <span class="rn">${esc(p.nombre)}<small>${esc(p.categoria || '')} · avisar si quedan ${p.stock_min}</small></span>
        <span class="rp">${p.stock} unid.</span>
      </div>`).join('') || '<p class="hint">Nada en este filtro. 👍</p>'}</div>
    ${sin.length && !f ? `<p class="hint" style="margin-top:12px">Sin control de stock: ${sin.map(p => esc(p.nombre)).join(', ')}</p>` : ''}
    ${pendienteHTML('🛒', 'Lista de compras automática', 'Ingresar mercadería y armar la lista para el mercado mayorista llega en el módulo de Inventario.')}`);
  $('#catF', box).addEventListener('click', e => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    S.catStock = b.dataset.c;
    renderView(false);
  });
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
    ${pendienteHTML('💬', 'Cobros y recordatorios por WhatsApp', 'Registrar abonos y enviar el recordatorio amable llega en el módulo de Fiados.')}`);
}

/* ---------- Arranque ---------- */
function bindChrome() {
  $('.tabbar').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    S.tab = b.dataset.tab;
    if (S.tab !== 'stock') S.catStock = '';
    renderView();
  });
  $('#cartBar').addEventListener('click', e => {
    if (e.target.closest('#cobrarBtn')) hojaCobrar();
    else if (e.target.closest('#cartOpen')) hojaCarrito();
  });
  $('#menuBtn').addEventListener('click', hojaMenu);
  $('#userChip').addEventListener('click', cambiarUsuario);
  $('#syncChip').addEventListener('click', hojaSync);
  $('#overlay').addEventListener('click', e => {
    if (e.target.id === 'overlay' || e.target.closest('[data-close]')) closeSheet();
  });
  window.addEventListener('popstate', () => {
    if (ignorePop) { ignorePop = false; return; }
    if (sheetOpen) closeSheet(true);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

  // Sincronización automática
  window.addEventListener('online', () => sincronizar());
  window.addEventListener('offline', () => pintarSync('offline'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sincronizar(); });
  setInterval(sincronizar, 30000);
}

function init() {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ok */ }
  bindChrome();
  if (!SB.configurado()) return pantallaConfig();
  if (!SB.sesion()) return pantallaLogin();
  if (!db.bodega) return prepararBodega();
  podar();
  arrancarTurno();        // abre al instante con lo guardado, aunque no haya internet
  sincronizar();
}

/* Modo sin internet (en localhost se desactiva para que veas tus cambios al instante) */
if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

init();
