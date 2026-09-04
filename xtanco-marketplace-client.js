// Admira XP — marketplace bridge.
// Polls /active-campaigns and exposes the winning campaigns to the game so
// individual surfaces (ds1, ds2, escaparate, metahuman, hilo, posters,
// gondola, flyer) and the global "takeover" can apply branded overlays.
(function () {
  // dominio propio: LaLiga bloquea workers.dev en horas de fútbol, FLT-1633
  const API = 'https://marketplace.admira.store';
  const POLL_MS = 30_000;
  const STATE = {
    bySurface: {},   // surface_ref -> campaign payload (e.g. ds1, hilo, poster-a, all)
    takeover: null,  // shorthand for STATE.bySurface.all
    lastSync: 0,
    failures: 0,
  };

  async function poll() {
    try {
      const r = await fetch(API + '/active-campaigns', { cache: 'no-store' });
      if (!r.ok) throw new Error('http_' + r.status);
      const data = await r.json();
      const map = data.campaigns || {};
      const bySurface = {};
      for (const slotId in map) {
        const c = map[slotId];
        // The slot id IS the surface ref by convention in our seed (ds1, ds2,
        // escaparate, metahuman, hilo-musical, poster-a, flyer, gondola, takeover).
        bySurface[slotId] = c;
      }
      STATE.bySurface = bySurface;
      STATE.takeover = bySurface['takeover'] || null;
      STATE.lastSync = Date.now();
      STATE.failures = 0;
    } catch (err) {
      STATE.failures++;
      if (STATE.failures < 3) console.warn('MarketplaceBridge.poll failed', err);
    }
  }

  function getCampaignFor(surfaceRef) {
    // Takeover wins over individual slots.
    if (STATE.takeover) return STATE.takeover;
    return STATE.bySurface[surfaceRef] || null;
  }

  function getTakeover() { return STATE.takeover; }
  function getMusicCampaign() { return getCampaignFor('hilo-musical'); }

  // Paint a branded card into a digital signage canvas (used by ds1/ds2 in
  // renderDSCanvas, by escaparate and by the Metahuman tótem). Returns true
  // if it painted (caller should `return`).
  function drawSignageCampaign(ctx, w, h, campaign, opts) {
    if (!campaign) return false;
    opts = opts || {};
    const t = Date.now() / 1000;
    const color = campaign.brandColor || '#78f3ff';
    const dark = shade(color, -0.55);

    // Background gradient
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, dark);
    g.addColorStop(0.5, shade(color, -0.30));
    g.addColorStop(1, '#02030a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    // Brand color band on top
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.22;
    ctx.fillRect(0, 0, w, Math.max(2, Math.floor(h * 0.18)));
    ctx.globalAlpha = 1;

    // Diagonal sheen
    const sx = ((t * 60) % (w * 1.4)) - w * 0.4;
    const sg = ctx.createLinearGradient(sx, 0, sx + w * 0.4, h);
    sg.addColorStop(0, hex2rgba(color, 0));
    sg.addColorStop(0.5, hex2rgba(color, 0.18));
    sg.addColorStop(1, hex2rgba(color, 0));
    ctx.fillStyle = sg; ctx.fillRect(0, 0, w, h);

    // Brand name
    const titleSize = Math.max(12, Math.min(64, Math.floor(h * 0.22)));
    ctx.font = 'bold ' + titleSize + 'px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillText(campaign.brandName || '', w / 2 + 1, h * 0.46 + 1);
    ctx.fillStyle = '#fff';
    ctx.fillText(campaign.brandName || '', w / 2, h * 0.46);

    // Optional copy
    if (campaign.brandMessage) {
      const msgSize = Math.max(9, Math.min(22, Math.floor(h * 0.10)));
      ctx.font = msgSize + 'px sans-serif';
      ctx.fillStyle = hex2rgba('#ffffff', 0.85);
      ctx.fillText(truncate(campaign.brandMessage, 64), w / 2, h * 0.66);
    }

    // Footer ribbon
    const rh = Math.max(12, Math.floor(h * 0.10));
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, h - rh, w, rh);
    const fSize = Math.max(7, Math.min(13, Math.floor(rh * 0.55)));
    ctx.font = fSize + 'px monospace';
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText('▌ PATROCINADO', 8, h - rh / 2 + fSize / 3);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('admira xp marketplace', w - 8, h - rh / 2 + fSize / 3);

    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    return true;
  }

  // Paint a paper poster / flyer / gondola tile in the iso world. Coordinates
  // are screen pixels on the main game canvas.
  function drawPaperPoster(ctx, x, y, w, h, campaign, label) {
    const color = (campaign && campaign.brandColor) || '#1c2530';
    const brand = (campaign && campaign.brandName) || 'DISPONIBLE';
    const dark = shade(color, -0.55);
    // Outer paper edge
    ctx.save();
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    // Paper background
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, color);
    g.addColorStop(1, dark);
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    // Top white sliver (paper grain)
    ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(x, y, w, 1);
    // Brand text
    ctx.fillStyle = '#fff';
    ctx.font = 'bold ' + Math.max(5, Math.floor(h * 0.22)) + 'px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(truncate(brand, 14), x + w / 2, y + h * 0.44);
    if (campaign && campaign.brandMessage) {
      ctx.font = Math.max(4, Math.floor(h * 0.12)) + 'px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(truncate(campaign.brandMessage, 22), x + w / 2, y + h * 0.66);
    }
    // Label tag at bottom
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x, y + h - Math.max(6, Math.floor(h * 0.18)), w, Math.max(6, Math.floor(h * 0.18)));
    ctx.font = Math.max(4, Math.floor(h * 0.11)) + 'px monospace';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(label || 'POSTER', x + w / 2, y + h - 3);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  // Helpers ────────────────────────────────────────────────────────
  function shade(hex, pct) {
    const { r, g, b } = parseHex(hex);
    const k = pct < 0 ? 0 : 255;
    const t = Math.abs(pct);
    const nr = Math.round(r + (k - r) * t);
    const ng = Math.round(g + (k - g) * t);
    const nb = Math.round(b + (k - b) * t);
    return rgb2hex(nr, ng, nb);
  }
  function parseHex(hex) {
    const s = hex.replace('#', '');
    return {
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16),
    };
  }
  function rgb2hex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('');
  }
  function hex2rgba(hex, a) {
    const { r, g, b } = parseHex(hex);
    return `rgba(${r},${g},${b},${a})`;
  }
  function truncate(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  window.MarketplaceBridge = {
    api: API,
    poll, getCampaignFor, getTakeover, getMusicCampaign,
    drawSignageCampaign, drawPaperPoster,
    state: STATE,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { poll(); setInterval(poll, POLL_MS); }, { once: true });
  } else {
    poll();
    setInterval(poll, POLL_MS);
  }
})();
