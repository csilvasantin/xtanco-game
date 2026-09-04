// Admira XP Marketplace — pujas + countdown + cuadro de inventario.
(() => {
  // dominio propio: LaLiga bloquea workers.dev en horas de fútbol, FLT-1633
  const API = 'https://marketplace.admira.store';
  const POLL_MS = 15_000;
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  const KIND_ICON = {
    screen: '📺', poster: '📰', flyer: '📄', gondola: '🛒', jingle: '🎵', all: '🚨',
  };
  const CHANNEL_LABEL = {
    digital: 'Digital', physical: 'Físico', audio: 'Audio', takeover: 'Takeover',
  };

  let invState = { items: [], serverTime: 0, fetchedAt: 0 };
  let activeFilter = 'all';
  let drawerSlot = null;

  const fmtAmount = n => (n | 0).toLocaleString('es-ES');
  function fmtTimeLeft(secs) {
    secs = Math.max(0, secs | 0);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
    return `${m}m ${String(s).padStart(2, '0')}s`;
  }

  async function fetchInventory() {
    try {
      const r = await fetch(API + '/inventory', { cache: 'no-store' });
      if (!r.ok) throw new Error('http_' + r.status);
      const data = await r.json();
      invState = { items: data.items || [], serverTime: data.serverTime | 0, fetchedAt: Date.now() };
      render();
    } catch (e) {
      const grid = $('#inv-grid');
      if (grid && !grid.children.length) grid.innerHTML = '<p class="loading">No se pudo cargar el inventario. Reintentando…</p>';
    }
  }

  function liveSeconds(item) {
    if (!item.auction) return 0;
    const elapsedSinceFetch = Math.floor((Date.now() - invState.fetchedAt) / 1000);
    const serverNow = invState.serverTime + elapsedSinceFetch;
    return (item.auction.endsAt | 0) - serverNow;
  }

  function render() {
    renderStrip();
    renderTakeover();
    renderInventory();
  }

  function renderStrip() {
    const slots = invState.items.length;
    const totalBids = invState.items.reduce((acc, it) => acc + (it.auction?.bidCount || 0), 0);
    const top = invState.items.reduce((acc, it) => Math.max(acc, it.auction?.leader?.amount || 0), 0);
    const active = invState.items.filter(it => it.activeCampaign).length;
    $('#strip-slots').textContent = String(slots);
    $('#strip-bids').textContent = String(totalBids);
    $('#strip-top').textContent = top ? fmtAmount(top) : '0';
    $('#strip-active').textContent = String(active);
  }

  function renderTakeover() {
    const card = $('#takeover-card');
    if (!card) return;
    const item = invState.items.find(i => i.slot.id === 'takeover');
    if (!item) { card.innerHTML = '<div class="loading">No disponible.</div>'; return; }
    const leader = item.auction?.leader;
    const left = liveSeconds(item);
    const reserve = item.slot.reservePrice;
    const minNext = leader ? leader.amount + 5 : reserve;

    const swatchStyle = leader ? `background:${leader.brandColor};box-shadow:0 0 18px ${leader.brandColor}99;` : '';
    const leaderHtml = leader ? `
      <div class="leader-row">
        <div class="swatch" style="${swatchStyle}"></div>
        <div class="lr-meta">
          <div class="lr-brand">${escapeHtml(leader.brandName)}<span style="font-size:11px;color:var(--mute);font-family:var(--font-mono);letter-spacing:.4px">por ${escapeHtml(leader.bidderName)}</span></div>
          <div class="lr-msg">${escapeHtml(leader.brandMessage || '— sin mensaje —')}</div>
        </div>
        <div class="lr-amount">${fmtAmount(leader.amount)} €</div>
      </div>
    ` : `<div class="inv-empty">Sin pujas todavía. Reserva ${fmtAmount(reserve)} €.</div>`;

    card.innerHTML = `
    <div class="takeover-card">
      <div class="left-col">
        <span class="badge-tk">🚨 MANCHA DE MARCA · 24 H</span>
        <h3>${escapeHtml(item.slot.name)}</h3>
        <p class="desc">${escapeHtml(item.slot.description)}</p>
        <div class="surfaces">
          <span>📺 DS1</span><span>📺 DS2</span><span>🪟 Escaparate</span>
          <span>🤖 Metahuman</span><span>🎵 Hilo</span><span>📰 Posters</span>
          <span>🛒 Góndola</span><span>🎟️ Turnos</span><span>💬 Opinador</span>
        </div>
        ${leaderHtml}
        <div class="countdown" data-countdown="takeover">⏱ Cierra en <b>${fmtTimeLeft(left)}</b></div>
      </div>
      <div class="right-col">
        <h4>Lo que te llevas</h4>
        <ul>
          <li>Pantallas DS1, DS2 y escaparate al 100%</li>
          <li>Tótem Metahuman bajo tu marca</li>
          <li>Cuña de hilo musical en bucle</li>
          <li>Cartel A2, flyer y cabeza de góndola</li>
          <li>Gestión de turnos personalizada</li>
          <li>Opinador con preguntas branded</li>
          <li>24 horas de exclusiva sobre toda la tienda</li>
        </ul>
        <button class="btn primary" data-bid="takeover">Pujar mancha de marca · mín ${fmtAmount(minNext)} €</button>
      </div>
    </div>`;
    card.querySelector('[data-bid="takeover"]')?.addEventListener('click', () => openDrawer('takeover'));
  }

  function renderInventory() {
    const grid = $('#inv-grid');
    if (!grid) return;
    const items = invState.items.filter(it => {
      if (it.slot.id === 'takeover') return false;
      if (activeFilter === 'all') return true;
      return it.slot.channel === activeFilter;
    });
    if (!items.length) { grid.innerHTML = '<p class="loading">No hay slots en este canal.</p>'; return; }
    grid.innerHTML = items.map(cardHtml).join('');
    grid.querySelectorAll('[data-bid]').forEach(b => {
      b.addEventListener('click', () => openDrawer(b.dataset.bid));
    });
  }

  function cardHtml(item) {
    const s = item.slot;
    const leader = item.auction?.leader;
    const camp = item.activeCampaign;
    const left = liveSeconds(item);
    const reserve = s.reservePrice;
    const minNext = leader ? leader.amount + 5 : reserve;
    const isAwarded = !!camp;
    const cls = ['inv-card'];
    if (s.channel === 'takeover') cls.push('is-tk');
    if (isAwarded) cls.push('is-awarded');

    const liveTag = isAwarded
      ? '<span class="live-tag">EN DIRECTO</span>'
      : '<span class="live-tag">SUBASTA · LIVE</span>';

    const leaderBlock = leader ? `
      <div class="inv-leader">
        <div class="sw" style="background:${leader.brandColor};box-shadow:0 0 12px ${leader.brandColor}99"></div>
        <div class="lm">
          <b>${escapeHtml(leader.brandName)}</b>
          <span>por ${escapeHtml(leader.bidderName)}</span>
        </div>
        <div class="amount">${fmtAmount(leader.amount)} €</div>
      </div>
    ` : `<div class="inv-empty">Sin pujas · reserva ${fmtAmount(reserve)} €</div>`;

    const campBlock = camp ? `
      <div class="inv-leader" style="border-color:rgba(255,126,182,.4);background:rgba(255,126,182,.05)">
        <div class="sw" style="background:${camp.brandColor};box-shadow:0 0 12px ${camp.brandColor}99"></div>
        <div class="lm">
          <b>${escapeHtml(camp.brandName)} <span style="font-size:10px;color:var(--magenta);letter-spacing:.4px;font-family:var(--font-mono)">EN DIRECTO</span></b>
          <span>${escapeHtml(camp.brandMessage || 'Sin copy')}</span>
        </div>
        <div class="amount" style="color:var(--magenta)">${fmtAmount(camp.amount)} €</div>
      </div>` : '';

    return `
      <article class="${cls.join(' ')}" data-channel="${s.channel}" data-slot="${s.id}">
        ${liveTag}
        <div class="inv-head">
          <div class="ch">${KIND_ICON[s.kind] || '·'}</div>
          <div class="title"><b>${escapeHtml(s.name)}</b><span>${CHANNEL_LABEL[s.channel] || s.channel} · ${escapeHtml(s.size || '—')}</span></div>
        </div>
        <p class="inv-desc">${escapeHtml(s.description || '')}</p>
        ${campBlock}
        ${leaderBlock}
        <div class="inv-foot">
          <div class="meta" data-countdown="${s.id}">⏱ <b>${fmtTimeLeft(left)}</b></div>
          <button class="btn primary" data-bid="${s.id}">Pujar · mín ${fmtAmount(minNext)} €</button>
        </div>
      </article>
    `;
  }

  function tickCountdowns() {
    if (!invState.items.length) return;
    for (const item of invState.items) {
      const left = liveSeconds(item);
      const els = $$(`[data-countdown="${item.slot.id}"] b`);
      els.forEach(el => { el.textContent = fmtTimeLeft(left); });
    }
  }

  // ── Drawer + form ──────────────────────────────────────────────
  function openDrawer(slotId) {
    const item = invState.items.find(i => i.slot.id === slotId);
    if (!item) return;
    drawerSlot = item;
    const leader = item.auction?.leader;
    const reserve = item.slot.reservePrice;
    const minNext = leader ? leader.amount + 5 : reserve;
    $('#bid-kicker').textContent = (CHANNEL_LABEL[item.slot.channel] || item.slot.channel) + ' · ' + (item.slot.size || '');
    $('#bid-title').textContent = item.slot.name;
    $('#bid-desc').textContent = item.slot.description || '';
    let stateHtml = leader
      ? `Líder actual: <b>${escapeHtml(leader.brandName)}</b> · ${fmtAmount(leader.amount)} €. Mínimo siguiente: <b>${fmtAmount(minNext)} €</b>.`
      : `Sin pujas · reserva <b>${fmtAmount(reserve)} €</b>.`;
    // Cross-link to AdmiraTunes Studio for audio slots / takeover.
    if (item.slot.id === 'hilo-musical' || item.slot.id === 'takeover') {
      stateHtml += ` · <a href="../studio/" target="_blank" rel="noopener" style="color:var(--lime)">🎼 Crea jingle en Studio</a>`;
    }
    $('#bid-state').innerHTML = stateHtml;
    const fa = $('#f-amount');
    fa.min = String(minNext);
    fa.placeholder = String(minNext);
    fa.value = '';
    $('#hint-amount').textContent = leader
      ? `Debe superar al líder en al menos 5 €.`
      : `Debe igualar o superar la reserva.`;
    $('#f-error').hidden = true;
    $('#bid-drawer').hidden = false;
    setTimeout(() => fa.focus(), 60);
  }
  function closeDrawer() {
    $('#bid-drawer').hidden = true;
    drawerSlot = null;
  }

  async function submitBid(e) {
    e.preventDefault();
    if (!drawerSlot) return;
    const amount = parseInt($('#f-amount').value, 10);
    const brand = $('#f-brand').value.trim();
    const bidder = $('#f-bidder').value.trim();
    const color = $('#f-color').value || '#78f3ff';
    const msg = $('#f-msg').value.trim();
    const email = $('#f-email').value.trim();
    const errEl = $('#f-error');
    errEl.hidden = true;
    if (!brand || !bidder || !Number.isFinite(amount)) {
      errEl.hidden = false; errEl.textContent = 'Completa importe, marca y nombre.';
      return;
    }
    const btn = $('#f-submit');
    btn.disabled = true; btn.textContent = 'Pujando…';
    try {
      const r = await fetch(API + '/bid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slotId: drawerSlot.slot.id,
          amount, bidderName: bidder, bidderEmail: email,
          brandName: brand, brandColor: color, brandMessage: msg,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        errEl.hidden = false;
        if (data.error === 'bid_too_low') {
          errEl.textContent = `Puja demasiado baja. Mínimo: ${fmtAmount(data.minRequired)} €.`;
        } else if (data.error === 'auction_ended') {
          errEl.textContent = 'La subasta acaba de cerrarse.';
        } else if (data.error === 'invalid_bidder_name') {
          errEl.textContent = 'El nombre del licitador no es válido.';
        } else if (data.error === 'invalid_brand_name') {
          errEl.textContent = 'El nombre de marca no es válido.';
        } else {
          errEl.textContent = 'No se pudo registrar la puja: ' + (data.error || ('http_' + r.status));
        }
        return;
      }
      closeDrawer();
      await fetchInventory();
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = 'Error de red: ' + (err && err.message || err);
    } finally {
      btn.disabled = false; btn.textContent = 'Pujar ahora';
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ── Wire up ────────────────────────────────────────────────────
  function wire() {
    $$('.filter-pill').forEach(p => p.addEventListener('click', () => {
      $$('.filter-pill').forEach(x => x.classList.toggle('is-on', x === p));
      activeFilter = p.dataset.filter;
      renderInventory();
    }));
    $('#bid-close').addEventListener('click', closeDrawer);
    $('#f-cancel').addEventListener('click', closeDrawer);
    $('#bid-backdrop').addEventListener('click', closeDrawer);
    $('#bid-form').addEventListener('submit', submitBid);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#bid-drawer').hidden) closeDrawer(); });
  }

  wire();
  fetchInventory();
  setInterval(fetchInventory, POLL_MS);
  setInterval(tickCountdowns, 1000);
})();
