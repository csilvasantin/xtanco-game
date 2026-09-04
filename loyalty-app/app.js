(() => {
  const APP_VERSION = '1.0.0';
  // dominio propio: LaLiga bloquea workers.dev en horas de fútbol, FLT-1633
  const API = 'https://loyalty.admira.store';
  const STORAGE_KEY = 'xtancoclub.v1';
  const POLL_MS = 12_000;

  const EMOJIS = ['🙂','😎','🦊','🐺','🦁','🐱','🐶','🐼','🐯','🦉','🐸','🐙','🦄','👽','🤖','🐉','🐢','🦋','🌵','🍀','🍕','🍩','☕','🚀','⚡','🔥','🌙','⭐','🎩','🎷','🎮','🪐'];
  const MONTHS = ['—','enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

  function fillBirthdaySelects(daySel, monthSel, current) {
    if (!daySel || !monthSel) return;
    daySel.innerHTML = '';
    monthSel.innerHTML = '';
    const empty = document.createElement('option');
    empty.value = ''; empty.textContent = 'día';
    daySel.appendChild(empty);
    for (let d = 1; d <= 31; d++) {
      const o = document.createElement('option');
      o.value = String(d).padStart(2, '0'); o.textContent = String(d);
      daySel.appendChild(o);
    }
    const emptyM = document.createElement('option');
    emptyM.value = ''; emptyM.textContent = 'mes';
    monthSel.appendChild(emptyM);
    for (let m = 1; m <= 12; m++) {
      const o = document.createElement('option');
      o.value = String(m).padStart(2, '0'); o.textContent = MONTHS[m];
      monthSel.appendChild(o);
    }
    if (current && /^\d{2}-\d{2}$/.test(current)) {
      const [mm, dd] = current.split('-');
      monthSel.value = mm;
      daySel.value = dd;
    }
  }

  function readBirthday(daySel, monthSel) {
    if (!daySel || !monthSel) return null;
    const dd = daySel.value, mm = monthSel.value;
    if (!dd || !mm) return null;
    return mm + '-' + dd;
  }

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch { return {}; }
  }
  function save(s) { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }
  function clearSession() { localStorage.removeItem(STORAGE_KEY); }

  function toast(msg, ms = 2200) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), ms);
  }

  function show(screenId) {
    ['screen-register', 'screen-home'].forEach(id => $('#' + id).classList.add('hidden'));
    $('#' + screenId).classList.remove('hidden');
  }

  function fmtTime(tsSec) {
    const d = new Date(tsSec * 1000);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    if (sameDay) return `hoy ${hh}:${mm}`;
    const dd = String(d.getDate()).padStart(2, '0');
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mo} ${hh}:${mm}`;
  }

  async function api(path, opts = {}) {
    const res = await fetch(API + path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const err = new Error((data && data.error) || `http_${res.status}`);
      err.status = res.status;
      err.payload = data;
      throw err;
    }
    return data;
  }

  function buildEmojiGrid(selectedEmoji) {
    const grid = $('#emoji-grid');
    grid.innerHTML = '';
    EMOJIS.forEach(e => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = e;
      if (e === selectedEmoji) b.classList.add('sel');
      b.addEventListener('click', () => {
        $$('#emoji-grid button').forEach(x => x.classList.remove('sel'));
        b.classList.add('sel');
      });
      grid.appendChild(b);
    });
  }

  function selectedEmoji() {
    const sel = $('#emoji-grid button.sel');
    return sel ? sel.textContent : EMOJIS[0];
  }

  function readJoinCodeFromUrl() {
    const params = new URLSearchParams(location.search);
    const c = (params.get('join') || params.get('code') || '').trim();
    return c.toUpperCase();
  }

  function renderHome(state) {
    const c = state.customer;
    $('#me-emoji').textContent = c.avatarEmoji || '🙂';
    $('#me-name').textContent = c.name;
    $('#me-visits').textContent = c.totalVisits;
    $('#me-spend').textContent = c.totalSpend;
    // Antigüedad: socio desde createdAt + tiempo transcurrido
    const sinceEl = $('#me-since'), sinceLapseEl = $('#me-since-lapse');
    if (sinceEl && sinceLapseEl) {
      if (c.createdAt) {
        const sinceMs = c.createdAt > 1e12 ? c.createdAt : c.createdAt * 1000;
        const d = new Date(sinceMs);
        const dStr = String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear();
        sinceEl.textContent = dStr;
        const days = Math.max(0, Math.floor((Date.now() - sinceMs) / 86400000));
        const years = Math.floor(days / 365);
        const months = Math.floor((days % 365) / 30);
        let lapse;
        if (years > 0) lapse = years + ' año' + (years === 1 ? '' : 's') + (months > 0 ? ' ' + months + ' mes' + (months === 1 ? '' : 'es') : '');
        else if (months > 0) lapse = months + ' mes' + (months === 1 ? '' : 'es');
        else lapse = days + ' día' + (days === 1 ? '' : 's');
        sinceLapseEl.textContent = 'hace ' + lapse;
      } else {
        sinceEl.textContent = '—';
        sinceLapseEl.textContent = '';
      }
    }
    const N = state.stampsForFree || 5;
    const row = $('#stamps-row');
    row.innerHTML = '';
    for (let i = 0; i < N; i++) {
      const d = document.createElement('div');
      d.className = 'stamp' + (i < c.stamps ? ' on' : '');
      d.textContent = i < c.stamps ? '✦' : '';
      if (c.freePending && i === N - 1) {
        d.classList.remove('on');
        d.classList.add('free');
        d.textContent = '🎁';
      }
      row.appendChild(d);
    }
    if (c.freePending) {
      $('#me-free-banner').classList.remove('hidden');
      $('#stamps-text').textContent = `Has completado ${N} sellos. Tu próxima compra es gratis.`;
    } else {
      $('#me-free-banner').classList.add('hidden');
      $('#stamps-text').textContent = `${c.stamps} de ${N} sellos. Te faltan ${N - c.stamps} para una compra gratis.`;
    }
    const bdayBanner = $('#me-birthday-banner');
    if (bdayBanner) {
      if (c.isBirthday) bdayBanner.classList.remove('hidden');
      else bdayBanner.classList.add('hidden');
    }
    const bdayDay = $('#bday-day'), bdayMonth = $('#bday-month');
    if (bdayDay && bdayMonth && bdayMonth.options.length === 0) fillBirthdaySelects(bdayDay, bdayMonth, c.birthday);
    else if (bdayDay && bdayMonth && c.birthday && /^\d{2}-\d{2}$/.test(c.birthday)) {
      const [mm, dd] = c.birthday.split('-');
      if (bdayMonth.value !== mm) bdayMonth.value = mm;
      if (bdayDay.value !== dd) bdayDay.value = dd;
    }
    const bdayStatus = $('#bday-status');
    if (bdayStatus) {
      if (c.birthday && /^\d{2}-\d{2}$/.test(c.birthday)) {
        const [mm, dd] = c.birthday.split('-');
        bdayStatus.textContent = `Guardado: ${parseInt(dd, 10)} de ${MONTHS[parseInt(mm, 10)]}`;
      } else {
        bdayStatus.textContent = 'Sin guardar.';
      }
    }
    const visitsEl = $('#visits-list');
    if (state.recentVisits && state.recentVisits.length) {
      visitsEl.innerHTML = '';
      state.recentVisits.forEach(v => {
        const row = document.createElement('div');
        row.className = 'visit';
        const what = document.createElement('div');
        what.className = 'what';
        const free = v.was_free ? ' <span class="badge free">Gratis</span>' : '';
        what.innerHTML = `<b>${v.product || 'Compra'}</b>${free} <span class="muted" style="font-size:12px">· ${v.revenue}€</span>`;
        const when = document.createElement('div');
        when.className = 'when';
        when.textContent = fmtTime(v.ts);
        row.appendChild(what);
        row.appendChild(when);
        visitsEl.appendChild(row);
      });
    } else {
      visitsEl.innerHTML = '<p class="muted" style="font-size:13px">Aún no has comprado nada.</p>';
    }
    updateSignal(c);
  }

  function updateSignal(customer) {
    const sig = $('#me-signal');
    const txt = $('#me-status');
    const now = Math.floor(Date.now() / 1000);
    const since = now - (customer.lastCheckin || 0);
    if (customer.lastCheckin && since < 120) {
      sig.classList.add('on');
      txt.textContent = `presente en el estanco · check-in hace ${since}s`;
    } else {
      sig.classList.remove('on');
      txt.textContent = customer.lastCheckin ? 'fuera del estanco' : 'aún no has visitado el estanco';
    }
  }

  async function refresh(state) {
    try {
      const data = await api('/me?token=' + encodeURIComponent(state.token));
      state.customer = data.customer;
      state.recentVisits = data.recentVisits;
      state.stampsForFree = data.stampsForFree;
      save(state);
      renderHome(state);
    } catch (err) {
      if (err.status === 404) {
        toast('Tu cuenta ya no existe en el servidor');
        clearSession();
        boot();
      } else {
        console.warn('refresh failed', err);
      }
    }
  }

  async function doRegister(state) {
    const name = $('#reg-name').value.trim();
    const code = $('#reg-code').value.trim().toUpperCase();
    const emoji = selectedEmoji();
    const birthday = readBirthday($('#reg-bday-day'), $('#reg-bday-month'));
    const errEl = $('#reg-err');
    errEl.textContent = '';
    if (!name) { errEl.textContent = 'Pon tu nombre.'; return; }
    if (!code) { errEl.textContent = 'Falta el código del estanco (escanea el QR del tótem Metahuman).'; return; }
    const btn = $('#reg-submit');
    btn.disabled = true; btn.textContent = 'Creando…';
    try {
      const res = await api('/register', { method: 'POST', body: { joinCode: code, name, avatarEmoji: emoji, birthday } });
      state.token = res.token;
      state.customer = res.customer;
      save(state);
      toast('¡Bienvenido al Club, ' + res.customer.name + '!');
      await refresh(state);
      show('screen-home');
      startPolling(state);
    } catch (err) {
      if (err.status === 403) errEl.textContent = 'Código inválido. Pide al estanquero que muestre el QR del Metahuman.';
      else if (err.status === 400) errEl.textContent = 'Nombre no válido.';
      else errEl.textContent = 'No se pudo crear la tarjeta. Inténtalo de nuevo.';
    } finally {
      btn.disabled = false; btn.textContent = 'Crear mi tarjeta';
    }
  }

  async function doSaveBirthday(state) {
    const birthday = readBirthday($('#bday-day'), $('#bday-month'));
    const btn = $('#bday-save');
    btn.disabled = true;
    try {
      const res = await api('/update', { method: 'POST', body: { token: state.token, birthday } });
      state.customer = res.customer;
      save(state);
      toast(birthday ? '🎂 Cumpleaños guardado' : 'Cumpleaños borrado');
      renderHome(state);
    } catch (err) {
      toast('No se pudo guardar.');
    } finally {
      btn.disabled = false;
    }
  }

  async function doCheckin(state) {
    const btn = $('#checkin-btn');
    btn.disabled = true; btn.textContent = 'Avisando al estanco…';
    try {
      const res = await api('/checkin', { method: 'POST', body: { token: state.token } });
      state.customer = res.customer;
      save(state);
      toast('🛎️ El estanco te ve. Mira la simulación.');
      renderHome(state);
    } catch (err) {
      toast('No se pudo hacer check-in.');
    } finally {
      btn.disabled = false; btn.textContent = 'Estoy en el estanco ahora';
    }
  }

  let pollHandle = null;
  function startPolling(state) {
    stopPolling();
    pollHandle = setInterval(() => refresh(state), POLL_MS);
    document.addEventListener('visibilitychange', onVisibility);
  }
  function stopPolling() {
    if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
    document.removeEventListener('visibilitychange', onVisibility);
  }
  function onVisibility() {
    if (document.visibilityState === 'visible') {
      const s = load();
      if (s.token) refresh(s);
    }
  }

  function boot() {
    $('#app-version').textContent = APP_VERSION;
    const state = load();
    const urlCode = readJoinCodeFromUrl();
    if (state.token) {
      buildEmojiGrid(state.customer && state.customer.avatarEmoji);
      fillBirthdaySelects($('#bday-day'), $('#bday-month'), state.customer && state.customer.birthday);
      show('screen-home');
      refresh(state);
      startPolling(state);
    } else {
      buildEmojiGrid(EMOJIS[0]);
      fillBirthdaySelects($('#reg-bday-day'), $('#reg-bday-month'), null);
      if (urlCode) $('#reg-code').value = urlCode;
      show('screen-register');
    }
    $('#reg-submit').addEventListener('click', () => doRegister(state));
    $('#checkin-btn').addEventListener('click', () => doCheckin(load()));
    $('#bday-save').addEventListener('click', () => doSaveBirthday(load()));
    $('#logout-btn').addEventListener('click', () => {
      if (!confirm('¿Olvidar la tarjeta de este dispositivo? Los sellos siguen guardados en el servidor pero perderás el acceso desde aquí.')) return;
      stopPolling();
      clearSession();
      boot();
    });
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  boot();
})();
