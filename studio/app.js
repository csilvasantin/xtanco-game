// AdmiraTunes Studio — generación de jingles + videoclips.
//
// Pipeline:
//   1. Brief del usuario  →  POST a admira-grok-proxy (Gemini)
//      pidiendo JSON estricto con título, hook, líneas de letra,
//      bpm, key, paleta y estructura.
//   2. Render en pantalla del payload + visualización en directo.
//   3. Reproducción del jingle con Web Audio API (drums + bass + lead +
//      stab vocal con el nombre de la marca).
//   4. Upsell: render de videoclip canvas reactivo a beat con karaoke,
//      grabable como WebM via MediaRecorder.

(() => {
  // dominio propio: LaLiga bloquea workers.dev en horas de fútbol, FLT-1633
  const GROK_API  = 'https://grok.admira.store/grok/ask';
  // dominio propio: LaLiga bloquea workers.dev en horas de fútbol, FLT-1633
  const TUNES_API = 'https://tunes.admira.store';
  const DRAWTHINGS_API = 'http://127.0.0.1:7869';
  const SUNO_POLL_MS = 5_000;
  const SUNO_MAX_WAIT_MS = 5 * 60_000;

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  // ── Music theory helpers ──────────────────────────────────────
  const NOTE_OFFSETS = { C:0, 'C#':1, Db:1, D:2, 'D#':3, Eb:3, E:4, F:5, 'F#':6, Gb:6, G:7, 'G#':8, Ab:8, A:9, 'A#':10, Bb:10, B:11 };
  const SCALES = {
    minor:    [0,2,3,5,7,8,10],
    major:    [0,2,4,5,7,9,11],
    dorian:   [0,2,3,5,7,9,10],
    phrygian: [0,1,3,5,7,8,10],
  };
  function freqFromMidi(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function midiOf(rootName, octave, scaleSteps, degree) {
    const root = NOTE_OFFSETS[rootName] ?? 9;
    const steps = scaleSteps[((degree % scaleSteps.length) + scaleSteps.length) % scaleSteps.length];
    const oct = octave + Math.floor(degree / scaleSteps.length);
    return 12 * (oct + 1) + root + steps;
  }
  function rndChoice(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }
  function makeRng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = (h * 16777619) >>> 0; }
    return h;
  }

  // ── Vibe presets (mapping to BPM range, scale, palette hint) ──
  const VIBE_PRESETS = {
    uplifting: { bpm: [108, 120], scaleType: 'major',    rootChoices: ['C','D','E','G','A'] },
    edgy:      { bpm: [128, 140], scaleType: 'minor',    rootChoices: ['F#','G','A','B','D'] },
    cinematic: { bpm: [80, 100],  scaleType: 'minor',    rootChoices: ['D','E','G','A','C'] },
    chill:     { bpm: [72, 86],   scaleType: 'dorian',   rootChoices: ['C','D','F','A'] },
    retro:     { bpm: [110, 124], scaleType: 'minor',    rootChoices: ['A','C','E','D'] },
    latino:    { bpm: [92, 100],  scaleType: 'minor',    rootChoices: ['A','C','D','E'] },
  };

  // ── State ────────────────────────────────────────────────────
  let TUNE = null;          // current tune payload
  let UNLOCKED = false;     // video clip purchased
  let CONTEXT = null;       // AudioContext shared
  let PLAYING = null;       // { stop, sources, until }
  let VIZ_RAF = 0;
  let VIDEO_RAF = 0;
  let RECORDER = null;
  let ENGINE = 'local';     // 'local' | 'suno'
  let SUNO_AUDIO_URL = null;
  let SUNO_TASK_ID = null;
  let SUNO_POLL = null;

  // ── Status helpers ───────────────────────────────────────────
  function setStatus(msg, mode) {
    const el = $('#gen-status');
    el.textContent = msg || '';
    el.style.color = mode === 'err' ? '#ff8aa0' : 'var(--mute)';
  }
  function setPlayerStatus(msg) { $('#player-status').textContent = msg || ''; }
  function setRenderStatus(msg) { $('#render-status').textContent = msg || ''; }
  function setDrawThingsStatus(msg, mode) {
    const el = $('#drawthings-status');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = mode === 'err' ? '#ff8aa0' : 'var(--mute)';
  }

  // ── Generation: prompt Gemini for structured JSON ────────────
  function buildPrompt({ brand, values, vibe, length, lang }) {
    const langLabel = lang === 'en' ? 'English'
                    : lang === 'es-en' ? 'mezcla español/inglés (mayoría español, hooks o frases cortas en inglés)'
                    : 'español de España';
    const linesByLength = { 15: 4, 30: 8, 60: 14, 90: 22 };
    const targetLines = linesByLength[length] || 8;
    return [
      `OUTPUT FORMAT: Devuelve EXCLUSIVAMENTE un objeto JSON válido (RFC 8259). NADA antes, NADA después, sin markdown, sin \`\`\`, sin texto explicativo.`,
      `Usa SOLO comillas dobles ASCII ("), NUNCA comillas tipográficas («» " " ' '), NUNCA apóstrofos, NUNCA trailing commas.`,
      `Si necesitas comillas dentro de una cadena, escápalas como \\". Mantén todo en una sola cadena por línea (sin saltos \\n dentro de las strings).`,
      ``,
      `Eres letrista publicitario para Admira XP.`,
      ``,
      `Brief:`,
      `- Marca: ${brand}`,
      `- Valores y propuesta: ${values}`,
      `- Vibe: ${vibe}`,
      `- Duración objetivo: ${length} segundos`,
      `- Idioma: ${langLabel}`,
      ``,
      `Forma EXACTA del JSON:`,
      `{`,
      `  "title": "string corto, max 40 caracteres, sin emojis",`,
      `  "hookLine": "una sola linea pegadiza, max 80 caracteres, menciona la marca o sus valores con naturalidad",`,
      `  "tagline": "frase de cierre tipo claim, max 60 caracteres",`,
      `  "structure": ["intro","verse","chorus","verse","chorus","outro"],`,
      `  "lyrics": ["linea 1", "linea 2", "..."],`,
      `  "moodWords": ["3-5", "palabras", "clave"]`,
      `}`,
      ``,
      `lyrics debe tener exactamente ${targetLines} elementos (una linea por elemento). Cada linea max 90 caracteres, sin parentesis con notas escenicas, sin saltos de linea dentro de la string.`,
      ``,
      `Si la marca o los valores son sensibles (tabaco, alcohol, juego), usa lenguaje sugerente sin glorificar consumo.`,
    ].join('\n');
  }

  // Tolerant JSON repair for LLM output. Smart quotes, trailing commas, line
  // breaks inside strings, control characters — fix them best-effort before
  // calling JSON.parse. Returns the original input if no repair was needed.
  function repairJson(s) {
    let t = String(s);
    // Strip BOM and zero-width chars
    t = t.replace(/[﻿​‌‍⁠]/g, '');
    // Replace common smart quotes
    t = t.replace(/[“”„‟″‶]/g, '"')   // “ ” „ ‟ ″ ‶
         .replace(/[‘’‚‛′‵]/g, "'")   // ‘ ’ ‚ ‛ ′ ‵
         .replace(/[«»]/g, '"');                          // « »
    // Em/en dashes inside JSON to hyphen — only if they cause issues; safer to leave.
    // Fix trailing commas before ] or }
    t = t.replace(/,(\s*[\]\}])/g, '$1');
    // Replace literal newlines inside strings: a quick heuristic — split on
    // boundaries we know are safe (after ":, ", or [ ", or , ").
    // First pass: collapse \r and replace CRLF with \n
    t = t.replace(/\r\n?/g, '\n');
    // Inside string contents, replace bare newlines with a space.
    let out = '', inStr = false, esc = false;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (esc) { out += ch; esc = false; continue; }
      if (ch === '\\') { out += ch; esc = true; continue; }
      if (ch === '"') { inStr = !inStr; out += ch; continue; }
      if (inStr && ch === '\n') { out += ' '; continue; }
      if (inStr && ch.charCodeAt(0) < 0x20) { out += ' '; continue; }
      out += ch;
    }
    return out;
  }

  function parseTuneJson(text) {
    if (!text) return null;
    const s = String(text).trim();
    const tryParse = str => { try { return JSON.parse(str); } catch { return null; } };
    // 1) raw
    let r = tryParse(s); if (r) return r;
    // 2) strip ``` fences if any
    const fence = s.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
    if (fence) { r = tryParse(fence[1]); if (r) return r; }
    // 3) extract first balanced { ... }
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) {
      const slice = s.slice(a, b + 1);
      r = tryParse(slice); if (r) return r;
      // 4) repair + parse
      r = tryParse(repairJson(slice)); if (r) return r;
    }
    // 5) repair the whole string + parse
    r = tryParse(repairJson(s)); if (r) return r;
    return null;
  }

  // Heuristic fallback: pull title + lyrics out of free-form text when the
  // model refuses to return JSON. Good enough to ship a tune.
  function rescueFromFreeText(text, fallbackBrand) {
    if (!text) return null;
    const t = String(text);
    // Title: first line, or "Título:" pattern
    const titleM = t.match(/(?:t[ií]tulo|title)\s*[:\-–]\s*([^\n]+)/i);
    let title = titleM ? titleM[1].trim() : '';
    if (!title) {
      const firstLine = t.split('\n').find(l => l.trim().length && l.trim().length <= 60);
      title = firstLine ? firstLine.trim() : (fallbackBrand + ' Anthem');
    }
    title = title.replace(/^["'«»\s]+|["'«»\s]+$/g, '').slice(0, 40);
    // Lyrics: lines 2..N that aren't headers / labels
    const lines = t.split('\n')
      .map(l => l.trim())
      .filter(l => l && !/^[#>*\-]+\s*$/.test(l) && !/^(t[ií]tulo|title|hook|tagline|estructura|structure|moodwords|estribillo|verse|chorus|intro|outro)[:\-–]/i.test(l) && !/^```/.test(l))
      .filter(l => l !== title);
    const lyrics = lines.slice(0, 12);
    if (lyrics.length < 2) return null;
    return {
      title, hookLine: lyrics[0], tagline: lyrics[lyrics.length - 1].slice(0, 60),
      structure: ['intro','verse','chorus','verse','chorus','outro'],
      lyrics, moodWords: [],
    };
  }

  function pickKeyAndBpm(seed, vibe) {
    const preset = VIBE_PRESETS[vibe] || VIBE_PRESETS.uplifting;
    const rng = makeRng(seed);
    const root = rndChoice(preset.rootChoices, rng);
    const scale = preset.scaleType;
    const bpm = Math.round(preset.bpm[0] + rng() * (preset.bpm[1] - preset.bpm[0]));
    return { root, scale, bpm };
  }

  function buildPalette(seed, baseColorHex) {
    const base = hex2hsl(baseColorHex || '#78f3ff');
    const rng = makeRng(seed);
    const accents = [];
    for (let i = 0; i < 4; i++) {
      const dh = (rng() * 80 - 40 + i * 35) % 360;
      const sat = Math.min(95, Math.max(40, base.s + (rng() * 30 - 15)));
      const lig = Math.min(78, Math.max(28, base.l + (rng() * 30 - 10)));
      accents.push(hsl2hex({ h: (base.h + dh + 360) % 360, s: sat, l: lig }));
    }
    return [baseColorHex, ...accents];
  }

  function hex2hsl(hex) {
    const s = hex.replace('#','');
    const r = parseInt(s.slice(0,2),16)/255, g = parseInt(s.slice(2,4),16)/255, b = parseInt(s.slice(4,6),16)/255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    let h, sat, l = (max+min)/2;
    if (max === min) { h = sat = 0; }
    else {
      const d = max - min;
      sat = l > 0.5 ? d/(2-max-min) : d/(max+min);
      switch (max) {
        case r: h = (g-b)/d + (g<b?6:0); break;
        case g: h = (b-r)/d + 2; break;
        default: h = (r-g)/d + 4;
      }
      h *= 60;
    }
    return { h, s: sat*100, l: l*100 };
  }
  function hsl2hex({h,s,l}) {
    s/=100; l/=100;
    const c = (1 - Math.abs(2*l-1)) * s;
    const x = c * (1 - Math.abs((h/60)%2 - 1));
    const m = l - c/2;
    let [r,g,b] = [0,0,0];
    if (h<60)      [r,g,b]=[c,x,0];
    else if (h<120)[r,g,b]=[x,c,0];
    else if (h<180)[r,g,b]=[0,c,x];
    else if (h<240)[r,g,b]=[0,x,c];
    else if (h<300)[r,g,b]=[x,0,c];
    else            [r,g,b]=[c,0,x];
    const to = v => Math.round((v+m)*255).toString(16).padStart(2,'0');
    return '#' + to(r) + to(g) + to(b);
  }

  async function generate() {
    const brand  = $('#f-brand').value.trim();
    const values = $('#f-values').value.trim();
    const vibe   = $('#f-vibe').value;
    const length = parseInt($('#f-length').value, 10);
    const lang   = $('#f-lang').value;
    const color  = $('#f-color').value || '#78f3ff';
    if (!brand) { setStatus('Pon el nombre de la marca.', 'err'); return; }
    if (!values) { setStatus('Cuéntale a la IA qué quieres comunicar.', 'err'); return; }

    setStatus('🤖 Llamando a Gemini para escribir la letra…');
    $('#btn-generate').disabled = true;

    const prompt = buildPrompt({ brand, values, vibe, length, lang });
    let payload = null;
    try {
      const r = await fetch(GROK_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, message: prompt }),
      });
      const data = await r.json();
      if (!data || !data.ok) {
        setStatus('La IA devolvió un error: ' + (data && data.error || ('http_' + r.status)), 'err');
        $('#btn-generate').disabled = false; return;
      }
      payload = parseTuneJson(data.text);
      if (!payload || !Array.isArray(payload.lyrics) || payload.lyrics.length < 2) {
        // Last-resort: rescue title + lyrics from free-form text.
        const rescued = rescueFromFreeText(data.text, brand);
        console.warn('[studio] JSON parse failed, raw response was:\n', data.text);
        if (rescued) {
          payload = rescued;
          setStatus('⚠ La IA no devolvió JSON estricto, recuperé título y letras del texto libre.');
        } else {
          setStatus('La IA devolvió texto que no se puede parsear. Reintenta o cambia el brief. Revisa la consola para ver la respuesta cruda.', 'err');
          $('#btn-generate').disabled = false; return;
        }
      }
    } catch (err) {
      setStatus('Error de red: ' + (err && err.message || err), 'err');
      $('#btn-generate').disabled = false; return;
    }

    // Decide musical params
    const seed = hashSeed(brand + '|' + values + '|' + vibe + '|' + length);
    const { root, scale, bpm } = pickKeyAndBpm(seed, vibe);
    const palette = buildPalette(seed, color);

    TUNE = {
      brand, values, vibe, length, lang, color,
      seed,
      title: payload.title || (brand + ' Anthem'),
      hookLine: payload.hookLine || values.split(/[.,]/)[0] || brand,
      tagline: payload.tagline || ('— ' + brand + ' —'),
      structure: Array.isArray(payload.structure) && payload.structure.length ? payload.structure : ['intro','verse','chorus','verse','chorus','outro'],
      lyrics: payload.lyrics.map(s => String(s).trim()).filter(Boolean),
      moodWords: Array.isArray(payload.moodWords) ? payload.moodWords.slice(0,5) : [],
      bpm, root, scale, palette,
      generatedAt: Date.now(),
    };

    UNLOCKED = false;
    renderTune();
    setStatus('✅ Letra lista. Pulsa "Reproducir jingle" para escuchar el beat sintetizado.');
    $('#btn-generate').disabled = false;
  }

  function renderTune() {
    if (!TUNE) return;
    $('#result-empty').hidden = true;
    $('#result-payload').hidden = false;
    $('#r-title').textContent = TUNE.title;
    $('#r-tag-vibe').textContent = TUNE.vibe;
    $('#r-tag-bpm').textContent = TUNE.bpm + ' BPM';
    $('#r-tag-key').textContent = TUNE.root + ' ' + TUNE.scale;
    $('#r-tag-length').textContent = TUNE.length + 's';
    const sw = $('#r-swatch');
    sw.style.background = `linear-gradient(135deg,${TUNE.palette[0]},${TUNE.palette[2] || TUNE.palette[0]})`;
    sw.style.boxShadow = `0 0 22px ${TUNE.palette[0]}80`;
    $('#r-hook').textContent = '« ' + TUNE.hookLine + ' »';
    $('#r-lyrics').textContent = TUNE.lyrics.join('\n');
    $('#campaign-link').hidden = false;
  }

  // ── Web Audio synth ──────────────────────────────────────────
  function ctx() {
    if (!CONTEXT) CONTEXT = new (window.AudioContext || window.webkitAudioContext)();
    return CONTEXT;
  }

  function playJingle({ recordTo } = {}) {
    if (!TUNE) return null;
    if (PLAYING) stopJingle();
    const ac = ctx();
    if (ac.state === 'suspended') ac.resume();

    const master = ac.createGain();
    master.gain.value = 0.85;
    const compressor = ac.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 24;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.18;
    master.connect(compressor).connect(ac.destination);

    const analyser = ac.createAnalyser();
    analyser.fftSize = 512;
    compressor.connect(analyser);

    let recDestination = null;
    if (recordTo) {
      recDestination = ac.createMediaStreamDestination();
      compressor.connect(recDestination);
    }

    const bpm = TUNE.bpm;
    const beat = 60 / bpm;
    const bar = beat * 4;
    const length = TUNE.length;
    const totalBars = Math.max(4, Math.round(length / bar));
    const startAt = ac.currentTime + 0.05;
    const endAt = startAt + totalBars * bar;

    const scaleSteps = SCALES[TUNE.scale] || SCALES.minor;

    const rng = makeRng(TUNE.seed);
    // Bass: root, fifth, sixth, seventh degrees alternating per bar
    const bassDegrees = [0, 4, 5, 3, 0, 4, 6, 3];
    // Lead: small motif sequence
    const leadMotif = [
      [0, 2, 4, 5, 4, 2, 0, -1],
      [4, 5, 4, 2, 0, 2, 4, 7],
      [7, 5, 4, 2, 0, -3, 0, 2],
      [0, 4, 5, 7, 5, 4, 2, 0],
    ];

    // Drums (kick + snare + hi-hat)
    for (let b = 0; b < totalBars; b++) {
      const t0 = startAt + b * bar;
      // Pattern: kick on 1 & 3, snare on 2 & 4, hats on 8ths (with slight swing)
      // Vibe-driven variations.
      const swing = TUNE.vibe === 'latino' ? 0.06 : 0.0;
      for (let h = 0; h < 8; h++) {
        const tH = t0 + h * (beat / 2) + (h % 2 === 1 ? swing * beat : 0);
        playHat(ac, master, tH, h % 4 === 0 ? 0.18 : 0.11);
      }
      playKick(ac, master, t0, 0.9);
      playKick(ac, master, t0 + 2 * beat, 0.85);
      if (TUNE.vibe === 'edgy' || TUNE.vibe === 'latino') {
        playKick(ac, master, t0 + 0.75 * beat, 0.55);
      }
      playSnare(ac, master, t0 + 1 * beat, 0.7);
      playSnare(ac, master, t0 + 3 * beat, 0.7);
    }

    // Bass — quarter notes, octave 2.
    for (let b = 0; b < totalBars; b++) {
      const deg = bassDegrees[b % bassDegrees.length];
      const m = midiOf(TUNE.root, 2, scaleSteps, deg);
      const f = freqFromMidi(m);
      for (let q = 0; q < 4; q++) {
        const tQ = startAt + b * bar + q * beat;
        playBass(ac, master, tQ, beat * 0.92, f);
      }
    }

    // Pad — sustained over each bar.
    for (let b = 0; b < totalBars; b++) {
      const deg = bassDegrees[b % bassDegrees.length];
      const triad = [0, 2, 4].map(i => freqFromMidi(midiOf(TUNE.root, 4, scaleSteps, deg + i)));
      playPad(ac, master, startAt + b * bar, bar * 0.96, triad, TUNE.vibe);
    }

    // Lead — eighth-note motif on bar 2..N (skip intro).
    for (let b = 1; b < totalBars; b++) {
      const motif = leadMotif[(b - 1) % leadMotif.length];
      for (let i = 0; i < motif.length; i++) {
        const t = startAt + b * bar + i * (beat / 2);
        const deg = motif[i] + bassDegrees[b % bassDegrees.length];
        const f = freqFromMidi(midiOf(TUNE.root, 5, scaleSteps, deg));
        playLead(ac, master, t, beat / 2 * 0.92, f);
      }
    }

    // Vocal stab: speak the brand at bar 0, halfway and bar N-1.
    const stabBars = [0, Math.floor(totalBars / 2), totalBars - 1];
    for (const b of stabBars) {
      playBrandStab(ac, master, startAt + b * bar + 0.05, beat * 1.5, TUNE.brand);
    }

    PLAYING = { ac, master, analyser, until: endAt, recDestination };

    setPlayerStatus('▶ Reproduciendo… ' + TUNE.bpm + ' BPM, ' + TUNE.root + ' ' + TUNE.scale + ', ' + Math.round((endAt - startAt) * 10) / 10 + 's');
    $('#btn-stop').hidden = false;
    $('#btn-play').textContent = '▶ Reproducir de nuevo';
    drawVisualizer(analyser);

    setTimeout(() => {
      if (PLAYING && Date.now() / 1000 + 0.3 >= PLAYING.until) stopJingle();
    }, (endAt - startAt + 0.4) * 1000);

    return { startAt, endAt, recDestination, analyser };
  }

  function stopJingle() {
    if (!PLAYING) return;
    try { PLAYING.master.gain.setTargetAtTime(0, PLAYING.ac.currentTime, 0.05); } catch {}
    setTimeout(() => { try { PLAYING.master.disconnect(); } catch {} }, 200);
    PLAYING = null;
    cancelAnimationFrame(VIZ_RAF);
    setPlayerStatus('');
    $('#btn-stop').hidden = true;
  }

  // ── Synth voices ──────────────────────────────────────────────
  function playKick(ac, dest, t, gain) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.18);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.30);
    osc.connect(g).connect(dest);
    osc.start(t); osc.stop(t + 0.32);
    // Click layer
    const click = ac.createOscillator();
    const cg = ac.createGain();
    click.type = 'square'; click.frequency.value = 1100;
    cg.gain.setValueAtTime(0.18 * gain, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    click.connect(cg).connect(dest);
    click.start(t); click.stop(t + 0.05);
  }
  function playSnare(ac, dest, t, gain) {
    const buffer = noiseBuffer(ac, 0.20);
    const src = ac.createBufferSource(); src.buffer = buffer;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 0.9;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain * 0.85, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(bp).connect(g).connect(dest);
    src.start(t); src.stop(t + 0.20);
    // Tone body
    const osc = ac.createOscillator();
    const og = ac.createGain();
    osc.type = 'triangle'; osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(160, t + 0.10);
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(gain * 0.35, t + 0.005);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(og).connect(dest);
    osc.start(t); osc.stop(t + 0.16);
  }
  function playHat(ac, dest, t, gain) {
    const buffer = noiseBuffer(ac, 0.06);
    const src = ac.createBufferSource(); src.buffer = buffer;
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(hp).connect(g).connect(dest);
    src.start(t); src.stop(t + 0.06);
  }
  function playBass(ac, dest, t, dur, freq) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, t);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 1.5;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.01);
    g.gain.linearRampToValueAtTime(0.18, t + dur * 0.6);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    osc.connect(lp).connect(g).connect(dest);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  function playLead(ac, dest, t, dur, freq) {
    const osc = ac.createOscillator();
    const osc2 = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'square'; osc2.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    osc2.frequency.setValueAtTime(freq * 1.005, t);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400; lp.Q.value = 0.4;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.13, t + 0.01);
    g.gain.linearRampToValueAtTime(0.06, t + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.04);
    osc.connect(lp); osc2.connect(lp);
    lp.connect(g).connect(dest);
    osc.start(t); osc.stop(t + dur + 0.06);
    osc2.start(t); osc2.stop(t + dur + 0.06);
  }
  function playPad(ac, dest, t, dur, freqs, vibe) {
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.6);
    g.gain.linearRampToValueAtTime(0.05, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.value = vibe === 'cinematic' ? 2200 : (vibe === 'chill' ? 1400 : 3200);
    g.connect(lp).connect(dest);
    for (const f of freqs) {
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t);
      const detune = ac.createOscillator(); // LFO for slight vibrato
      detune.type = 'sine'; detune.frequency.value = 4.5;
      const detuneG = ac.createGain(); detuneG.gain.value = 5;
      detune.connect(detuneG).connect(o.detune);
      o.connect(g);
      o.start(t); o.stop(t + dur + 0.1);
      detune.start(t); detune.stop(t + dur + 0.1);
    }
  }
  function playBrandStab(ac, dest, t, dur, brand) {
    // Vocal-ish stab: a short formant cluster + a quick sweep.
    const freqs = [220, 440, 660]; // approx vowel-like cluster
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
    g.connect(lp).connect(dest);
    for (const f of freqs) {
      const o = ac.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * 0.94, t + dur);
      o.connect(g);
      o.start(t); o.stop(t + dur + 0.04);
    }
  }
  function noiseBuffer(ac, sec) {
    const len = Math.max(1, Math.round(ac.sampleRate * sec));
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ── Visualizer ───────────────────────────────────────────────
  function drawVisualizer(analyser) {
    const cv = $('#visualizer');
    const ctx2 = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const data = new Uint8Array(analyser.frequencyBinCount);
    function frame() {
      analyser.getByteFrequencyData(data);
      ctx2.clearRect(0, 0, W, H);
      const bars = 48;
      const barW = (W - bars - 4) / bars;
      for (let i = 0; i < bars; i++) {
        const idx = Math.floor((i / bars) * data.length);
        const v = data[idx] / 255;
        const h = Math.max(2, v * (H - 6));
        const grd = ctx2.createLinearGradient(0, H, 0, 0);
        grd.addColorStop(0, TUNE.palette[0]);
        grd.addColorStop(1, TUNE.palette[2] || TUNE.palette[0]);
        ctx2.fillStyle = grd;
        ctx2.fillRect(2 + i * (barW + 1), H - h, barW, h);
      }
      VIZ_RAF = requestAnimationFrame(frame);
    }
    cancelAnimationFrame(VIZ_RAF);
    VIZ_RAF = requestAnimationFrame(frame);
  }

  // ── Video clip render ────────────────────────────────────────
  function unlockVideo() {
    UNLOCKED = true;
    $('#upsell').hidden = true;
    $('#video-stage').hidden = false;
    drawVideoFrameStill();
    setRenderStatus('Listo. Pulsa "Renderizar y descargar" para grabar el clip al ritmo del jingle.');
  }

  function drawVideoFrameStill() {
    if (!TUNE) return;
    const cv = $('#video-canvas');
    const c = cv.getContext('2d');
    drawVideoFrame(c, cv.width, cv.height, TUNE, 0, 0, null, null);
  }

  function drawVideoFrame(c, W, H, tune, t, audioData, lyricLineIdx, brandFlash) {
    // Background gradient
    const angle = t * 0.6;
    const g = c.createLinearGradient(
      W * 0.5 + Math.cos(angle) * W * 0.5,
      H * 0.5 + Math.sin(angle) * H * 0.5,
      W * 0.5 - Math.cos(angle) * W * 0.5,
      H * 0.5 - Math.sin(angle) * H * 0.5
    );
    g.addColorStop(0, tune.palette[0]);
    g.addColorStop(0.5, tune.palette[2] || tune.palette[0]);
    g.addColorStop(1, tune.palette[3] || tune.palette[1] || '#000000');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // Vignette
    const v = c.createRadialGradient(W/2, H/2, Math.min(W,H)*0.2, W/2, H/2, Math.max(W,H)*0.7);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = v; c.fillRect(0, 0, W, H);
    // Beat-reactive bars overlay (uses audioData when available)
    const bpmHz = tune.bpm / 60;
    const beat = (t * bpmHz) % 1;
    const bars = 64;
    const baseAlpha = brandFlash ? 0.55 : 0.18;
    c.globalAlpha = baseAlpha;
    for (let i = 0; i < bars; i++) {
      const energy = audioData
        ? (audioData[Math.floor((i / bars) * audioData.length)] / 255)
        : (0.4 + 0.5 * Math.abs(Math.sin((i * 0.12) + t * 2)));
      const bw = W / bars;
      const bh = H * (0.18 + energy * 0.52);
      c.fillStyle = '#ffffff';
      c.fillRect(i * bw, H - bh, bw - 1, bh);
    }
    c.globalAlpha = 1;
    // Brand flash bars (vertical strobe on big beats)
    if (brandFlash) {
      c.globalCompositeOperation = 'screen';
      c.fillStyle = tune.palette[0];
      c.fillRect(0, 0, W, H);
      c.globalCompositeOperation = 'source-over';
    }
    // Title row
    c.font = 'bold 36px sans-serif';
    c.textBaseline = 'top';
    c.textAlign = 'left';
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.fillText(tune.brand.toUpperCase(), 36 + 2, 36 + 2);
    c.fillStyle = '#ffffff';
    c.fillText(tune.brand.toUpperCase(), 36, 36);
    c.font = '600 18px sans-serif';
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.fillText(tune.title, 36, 78);
    // Karaoke line
    const idx = lyricLineIdx == null ? 0 : Math.max(0, Math.min(tune.lyrics.length - 1, lyricLineIdx));
    const line = tune.lyrics[idx] || '';
    const next = tune.lyrics[idx + 1] || '';
    c.textAlign = 'center';
    c.font = 'bold 56px sans-serif';
    const titleY = H - 130;
    c.fillStyle = 'rgba(0,0,0,0.65)';
    c.fillText(line, W/2 + 2, titleY + 2);
    c.fillStyle = '#ffffff';
    c.fillText(line, W/2, titleY);
    if (next) {
      c.font = '500 26px sans-serif';
      c.fillStyle = 'rgba(255,255,255,0.55)';
      c.fillText(next, W/2, titleY + 70);
    }
    // Tagline + watermark bottom
    c.textAlign = 'right';
    c.font = '500 16px monospace';
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.fillText('admira xp · tunes studio', W - 28, H - 28);
    c.textAlign = 'left';
    c.font = 'bold 14px monospace';
    c.fillStyle = tune.palette[0];
    c.fillText('▌ ' + (tune.tagline || '').toUpperCase(), 28, H - 28);
  }

  async function renderVideo() {
    if (!TUNE) return;
    const cv = $('#video-canvas');
    const c = cv.getContext('2d');
    if (!cv.captureStream || typeof MediaRecorder === 'undefined') {
      setRenderStatus('Tu navegador no soporta MediaRecorder + captureStream.');
      return;
    }
    setRenderStatus('🎬 Sincronizando audio…');
    $('#btn-render').disabled = true;
    const handle = playJingle({ recordTo: true });
    if (!handle) { setRenderStatus('No se pudo iniciar el jingle.'); $('#btn-render').disabled = false; return; }
    const { startAt, endAt, recDestination, analyser } = handle;

    const videoStream = cv.captureStream(30);
    const audioTrack = recDestination.stream.getAudioTracks()[0];
    if (audioTrack) videoStream.addTrack(audioTrack);
    const types = ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
    const mt = types.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';
    RECORDER = new MediaRecorder(videoStream, { mimeType: mt, videoBitsPerSecond: 2_500_000 });
    const chunks = [];
    RECORDER.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    RECORDER.start();
    setRenderStatus('🔴 Grabando ' + Math.round(endAt - startAt) + 's…');

    const data = new Uint8Array(analyser.frequencyBinCount);
    const t0 = performance.now();
    const totalSec = endAt - startAt;
    function tick() {
      analyser.getByteFrequencyData(data);
      const elapsed = (performance.now() - t0) / 1000;
      const t = elapsed;
      const beat = (t * TUNE.bpm / 60) % 1;
      const flash = beat < 0.06;
      const lyricIdx = Math.floor(elapsed / (totalSec / Math.max(1, TUNE.lyrics.length)));
      drawVideoFrame(c, cv.width, cv.height, TUNE, t, data, lyricIdx, flash);
      if (elapsed < totalSec + 0.15 && PLAYING) {
        VIDEO_RAF = requestAnimationFrame(tick);
      }
    }
    VIDEO_RAF = requestAnimationFrame(tick);

    setTimeout(() => {
      try { RECORDER.stop(); } catch {}
      const blob = new Blob(chunks, { type: mt });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (TUNE.brand + '-' + TUNE.title).replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.webm';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setRenderStatus('✅ Vídeo descargado: ' + a.download);
      $('#btn-render').disabled = false;
    }, (totalSec + 0.4) * 1000);
  }

  // ── Engine selector ──────────────────────────────────────────
  function setEngine(name) {
    ENGINE = name;
    $$('.engine-pill').forEach(p => {
      const on = p.dataset.engine === name;
      p.classList.toggle('is-on', on);
      p.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    // If we already have a Suno track loaded, keep the audio element visible
    // when we're back on Suno; otherwise hide it.
    const audio = $('#suno-audio');
    if (audio) audio.hidden = !(name === 'suno' && SUNO_AUDIO_URL);
    if (name === 'suno' && PLAYING) stopJingle();
  }

  function onPlayClick() {
    if (!TUNE) return;
    if (ENGINE === 'suno') {
      if (SUNO_AUDIO_URL) { playSunoAudio(); return; }
      openSunoConfirm();
      return;
    }
    playJingle();
  }

  // ── Suno flow ────────────────────────────────────────────────
  async function openSunoConfirm() {
    $('#suno-error').hidden = true;
    const cfg = $('#suno-cfg');
    cfg.className = '';
    cfg.textContent = '⏳ Comprobando configuración del worker…';
    $('#suno-confirm').hidden = false;
    $('#suno-confirm-go').disabled = true;
    try {
      const r = await fetch(TUNES_API + '/health', { cache: 'no-store' });
      const data = await r.json().catch(() => ({}));
      if (data && data.configured) {
        cfg.classList.add('ok');
        cfg.textContent = '✅ Suno configurado · modelo ' + (data.model || 'V4_5');
        $('#suno-confirm-go').disabled = false;
      } else {
        cfg.classList.add('ko');
        cfg.textContent = '⚠ Suno NO está configurado en el worker. Pídele al admin que ejecute `wrangler secret put SUNO_API_KEY`.';
      }
    } catch (err) {
      cfg.classList.add('ko');
      cfg.textContent = '❌ No se pudo contactar con admira-tunes: ' + (err && err.message || err);
    }
  }
  function closeSunoConfirm() { $('#suno-confirm').hidden = true; }

  async function startSunoGeneration() {
    if (!TUNE) return;
    closeSunoConfirm();
    setPlayerStatus('🎤 Suno está componiendo… 30-60s');
    $('#btn-play').disabled = true;
    SUNO_AUDIO_URL = null;
    const audio = $('#suno-audio');
    audio.hidden = true;
    audio.removeAttribute('src');

    const styleHints = [TUNE.vibe, TUNE.bpm + ' bpm', TUNE.root + ' ' + TUNE.scale, ...(TUNE.moodWords || [])].filter(Boolean).join(', ');
    let payload;
    try {
      const r = await fetch(TUNES_API + '/suno/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand: TUNE.brand,
          title: TUNE.title,
          lyrics: TUNE.lyrics,
          style: styleHints,
          instrumental: false,
          length: TUNE.length,
        }),
      });
      payload = await r.json().catch(() => ({}));
      if (!r.ok || !payload.taskId) {
        const msg = payload.error === 'not_configured'
          ? 'Suno no está configurado en el worker. Avisa al admin para añadir SUNO_API_KEY.'
          : (payload.message || payload.error || ('http_' + r.status));
        setPlayerStatus('❌ ' + msg);
        $('#btn-play').disabled = false;
        return;
      }
    } catch (err) {
      setPlayerStatus('❌ Error de red: ' + (err && err.message || err));
      $('#btn-play').disabled = false;
      return;
    }

    SUNO_TASK_ID = payload.taskId;
    const startedAt = Date.now();
    if (SUNO_POLL) clearInterval(SUNO_POLL);
    const poll = async () => {
      try {
        const r = await fetch(TUNES_API + '/suno/status?id=' + encodeURIComponent(SUNO_TASK_ID), { cache: 'no-store' });
        const data = await r.json().catch(() => ({}));
        if (data.status === 'ready' && data.audioUrl) {
          clearInterval(SUNO_POLL); SUNO_POLL = null;
          SUNO_AUDIO_URL = data.audioUrl;
          audio.src = SUNO_AUDIO_URL;
          audio.hidden = false;
          audio.play().catch(() => {});
          setPlayerStatus('✅ Suno listo · ' + (TUNE.bpm + ' BPM · ' + (data.duration || TUNE.length) + 's'));
          $('#btn-play').disabled = false;
          $('#btn-play').textContent = '▶ Reproducir Suno';
        } else if (data.status === 'error') {
          clearInterval(SUNO_POLL); SUNO_POLL = null;
          setPlayerStatus('❌ Suno falló: ' + (data.error || 'desconocido'));
          $('#btn-play').disabled = false;
        } else {
          const secs = Math.round((Date.now() - startedAt) / 1000);
          setPlayerStatus('🎤 Suno ' + (data.providerStatus || 'PENDING').toLowerCase() + ' · ' + secs + 's');
          if (Date.now() - startedAt > SUNO_MAX_WAIT_MS) {
            clearInterval(SUNO_POLL); SUNO_POLL = null;
            setPlayerStatus('⏱ Timeout esperando a Suno · reintenta');
            $('#btn-play').disabled = false;
          }
        }
      } catch (err) {
        // Soft fail: keep polling
        console.warn('suno poll error', err);
      }
    };
    SUNO_POLL = setInterval(poll, SUNO_POLL_MS);
    poll();
  }

  function playSunoAudio() {
    const audio = $('#suno-audio');
    audio.hidden = false;
    try { audio.currentTime = 0; } catch {}
    audio.play().catch(() => {});
    setPlayerStatus('▶ Reproduciendo Suno');
  }

  // ── Draw Things local image generation ───────────────────────
  function buildDrawThingsPrompt() {
    if (!TUNE) return '';
    const mood = (TUNE.moodWords || []).join(', ');
    return [
      '16:9 digital signage campaign key visual',
      'premium retail media aesthetic',
      'brand: ' + TUNE.brand,
      'message: ' + TUNE.hookLine,
      'values: ' + TUNE.values,
      'mood: ' + [TUNE.vibe, mood].filter(Boolean).join(', '),
      'color palette: ' + (TUNE.palette || []).slice(0, 4).join(', '),
      'clean composition, cinematic lighting, readable empty space for typography, no logos, no small text',
    ].join('. ');
  }

  async function generateDrawThingsImage() {
    if (!TUNE) return;
    const btn = $('#btn-drawthings');
    const preview = $('#drawthings-preview');
    const img = $('#drawthings-img');
    const link = $('#drawthings-download');
    btn.disabled = true;
    setDrawThingsStatus('Conectando con Draw Things local...');
    try {
      const r = await fetch(DRAWTHINGS_API + '/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: buildDrawThingsPrompt(),
          negativePrompt: 'low quality, blurry, watermark, logo, text artifacts, distorted products, cluttered layout',
          width: 1344,
          height: 768,
          steps: 24,
          seed: TUNE.seed,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok || !data.url) {
        const msg = data.error || data.message || ('http_' + r.status);
        throw new Error(msg);
      }
      img.src = data.url + (data.url.includes('?') ? '&' : '?') + 't=' + Date.now();
      link.href = data.url;
      link.download = data.filename || (TUNE.brand + '-drawthings.png').replace(/[^a-z0-9.-]+/gi, '-').toLowerCase();
      preview.hidden = false;
      setDrawThingsStatus('Imagen lista desde Draw Things.');
    } catch (err) {
      setDrawThingsStatus('No conecta con el bridge local: ' + (err && err.message || err), 'err');
    } finally {
      btn.disabled = false;
    }
  }

  // ── Wire up ──────────────────────────────────────────────────
  $('#btn-generate').addEventListener('click', generate);
  $('#btn-play').addEventListener('click', onPlayClick);
  $('#btn-stop').addEventListener('click', stopJingle);
  $('#btn-unlock').addEventListener('click', unlockVideo);
  $('#btn-render').addEventListener('click', renderVideo);
  $('#btn-drawthings').addEventListener('click', generateDrawThingsImage);
  $$('.engine-pill').forEach(p => p.addEventListener('click', () => setEngine(p.dataset.engine)));
  $('#suno-cancel').addEventListener('click', closeSunoConfirm);
  $('#suno-close').addEventListener('click', closeSunoConfirm);
  $('#suno-backdrop').addEventListener('click', closeSunoConfirm);
  $('#suno-confirm-go').addEventListener('click', startSunoGeneration);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#suno-confirm').hidden) closeSunoConfirm(); });

  // Pre-fill from URL ?brand=...&values=...&color=...
  const params = new URLSearchParams(location.search);
  if (params.get('brand'))  $('#f-brand').value  = params.get('brand');
  if (params.get('values')) $('#f-values').value = params.get('values');
  if (params.get('color'))  $('#f-color').value  = params.get('color');
  if (params.get('vibe'))   $('#f-vibe').value   = params.get('vibe');
})();
