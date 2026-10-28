'use strict';
/* =========================================================
   Cliente mínimo de Supabase (Auth + REST), sin librerías.
   ~4 KB en lugar de los ~150 KB de supabase-js: importa en
   celulares de gama baja y con datos móviles limitados.
   ========================================================= */
const SB = (() => {
  const CFG = window.BODEGA_CONFIG || {};
  const base = String(CFG.supabaseUrl || '').trim().replace(/\/+$/, '');
  const key = String(CFG.supabaseAnonKey || '').trim();
  const SES = 'bodega_sesion';
  let ses = null;
  try { ses = JSON.parse(localStorage.getItem(SES) || 'null'); } catch (e) { ses = null; }

  function guardar(s) {
    ses = s;
    try { s ? localStorage.setItem(SES, JSON.stringify(s)) : localStorage.removeItem(SES); } catch (e) { /* ok */ }
  }

  function traducir(j, status) {
    const m = String((j && (j.error_description || j.msg || j.message || j.error)) || ('Error ' + status));
    if (/invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos';
    if (/email not confirmed/i.test(m)) return 'Primero confirma tu correo (revisa tu bandeja de entrada)';
    if (/already (been )?registered|already exists/i.test(m)) return 'Ese correo ya tiene cuenta. Inicia sesión.';
    if (/at least/i.test(m) && /password/i.test(m)) return 'La contraseña debe tener al menos 6 caracteres';
    if (/rate limit/i.test(m)) return 'Demasiados intentos. Espera un momento.';
    if (/relation .* does not exist|could not find the (table|function)/i.test(m)) return 'Falta crear las tablas: ejecuta supabase/schema.sql';
    return m;
  }

  function fallo(status, j, red) {
    const e = new Error(red ? 'Sin conexión a internet' : traducir(j, status));
    e.status = status;
    e.red = !!red;
    return e;
  }

  async function pedir(url, opts) {
    let r;
    const ctl = window.AbortController ? new AbortController() : null;
    const tm = ctl && setTimeout(() => ctl.abort(), 25000);   // redes móviles lentas
    try { r = await fetch(url, Object.assign({ signal: ctl && ctl.signal }, opts)); }
    catch (e) { throw fallo(0, null, true); }
    finally { clearTimeout(tm); }
    const txt = await r.text();
    let j = null;
    if (txt) { try { j = JSON.parse(txt); } catch (e) { j = txt; } }
    if (!r.ok) throw fallo(r.status, j, false);
    return j;
  }

  const auth = (path, body) => pedir(`${base}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const deToken = j => ({
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: Date.now() + (j.expires_in || 3600) * 1000,
    user: { id: j.user.id, email: j.user.email }
  });

  async function token() {
    if (!ses) { const e = fallo(401, { message: 'Inicia sesión' }); e.auth = true; throw e; }
    if (Date.now() > ses.expires_at - 60000) {
      try { guardar(deToken(await auth('token?grant_type=refresh_token', { refresh_token: ses.refresh_token }))); }
      catch (e) { if (!e.red) e.auth = true; throw e; }
    }
    return ses.access_token;
  }

  async function rest(method, path, body, prefer, reintento) {
    const h = { apikey: key, Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json' };
    if (prefer) h.Prefer = prefer;
    try {
      return await pedir(`${base}/rest/v1/${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      if (e.status === 401 && !reintento && ses) { ses.expires_at = 0; return rest(method, path, body, prefer, true); }
      if (e.status === 401) e.auth = true;
      throw e;
    }
  }

  return {
    configurado: () => /^https?:\/\/[^/]+/.test(base) && key.length > 20 && !/TU-PROYECTO|TU-CLAVE/.test(base + key),
    sesion: () => ses,
    async entrar(email, password) {
      guardar(deToken(await auth('token?grant_type=password', { email, password })));
      return ses;
    },
    /* Devuelve la sesión, o null si Supabase pide confirmar el correo primero */
    async registrar(email, password) {
      const j = await auth('signup', { email, password });
      if (j && j.access_token) { guardar(deToken(j)); return ses; }
      return null;
    },
    salir() {
      const s = ses;
      guardar(null);
      if (s) fetch(`${base}/auth/v1/logout`, { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + s.access_token } }).catch(() => {});
    },
    select: (tabla, query) => rest('GET', `${tabla}?${query}`),
    /* Inserta o actualiza una fila completa (idempotente: se puede reintentar) */
    upsert: (tabla, fila) => rest('POST', `${tabla}?on_conflict=id`, fila, 'resolution=merge-duplicates,return=minimal'),
    /* Cambia solo algunas columnas de una fila que ya existe */
    patch: (tabla, id, cambios) => rest('PATCH', `${tabla}?id=eq.${encodeURIComponent(id)}`, cambios, 'return=minimal'),
    rpc: (fn, args) => rest('POST', `rpc/${fn}`, args)
  };
})();
