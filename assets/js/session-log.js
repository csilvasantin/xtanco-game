// session-log.js — log de partida + resumen al cerrar.
//
// Acumula durante toda la vida de la pestaña:
//   - startedAt (timestamp)
//   - commands[] (cmds /telegram ejecutados, max 100)
//   - clicks (count de clicks sobre canvas)
//   - actions (count de selecciones de wall/floor/item, etc.)
//   - states[] (transiciones de estado del juego, max 30)
//   - lastActivityAt
//
// Cuando el navegador dispara beforeunload / pagehide / visibilitychange
// (hidden), envia un resumen a Telegram via sendBeacon (no bloquea cierre)
// y deja constancia de la sesion finalizada.
//
// Se complementa con session-ping.js (que envia el inicio).

(function(){
  if(typeof window==='undefined') return;
  try {
    const url=new URL(window.location.href);
    if(url.searchParams.get('nolog')==='1') return;
  } catch(_){}
  const host=window.location.hostname;
  if(host==='localhost' || host==='127.0.0.1' || host.endsWith('.local')) return;

  const log={
    sessionId: Math.random().toString(36).slice(2,10).toUpperCase(),
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    commands: [],     // last 100 cmd strings
    clicks: 0,
    actions: {},      // counter per action key
    states: [],       // last 30 state transitions
    sentEnd: false,   // dedup unload
  };

  // Hooks publicos para que game.html los llame
  log.logCommand=function(cmd){
    log.lastActivityAt=Date.now();
    const s=String(cmd||'').slice(0,80);
    if(s) log.commands.push(s);
    if(log.commands.length>100) log.commands.shift();
  };
  log.logState=function(toState){
    log.lastActivityAt=Date.now();
    const prev=log.states[log.states.length-1];
    if(prev===toState) return;
    log.states.push(String(toState||''));
    if(log.states.length>30) log.states.shift();
  };
  log.logAction=function(key){
    log.lastActivityAt=Date.now();
    const k=String(key||'').slice(0,40); if(!k) return;
    log.actions[k]=(log.actions[k]|0)+1;
  };

  // Click counter — todos los clicks sobre el documento cuentan como
  // actividad, los del canvas se contabilizan aparte.
  document.addEventListener('click',(e)=>{
    log.lastActivityAt=Date.now();
    if(e.target && e.target.id==='c') log.clicks++;
  },{capture:true});

  // CF trace (reusa si session-ping ya lo cacheo en sessionStorage)
  let cfCache=null;
  function getCfFromStorage(){
    try {
      const raw=sessionStorage.getItem('xtanco_cf_trace');
      if(raw) return JSON.parse(raw);
    } catch(_){}
    return null;
  }
  async function fetchCf(){
    cfCache=getCfFromStorage();
    if(cfCache) return cfCache;
    try {
      const r=await fetch('https://www.cloudflare.com/cdn-cgi/trace',{cache:'no-store'});
      if(!r.ok) return null;
      const t=await r.text();
      const map={};
      t.split(/\r?\n/).forEach(line=>{
        const i=line.indexOf('=');
        if(i>0) map[line.slice(0,i)]=line.slice(i+1);
      });
      try { sessionStorage.setItem('xtanco_cf_trace',JSON.stringify(map)); } catch(_){}
      cfCache=map;
      return map;
    } catch(e){ return null; }
  }

  function fmtDuration(ms){
    const s=Math.max(0,Math.floor(ms/1000));
    const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=s%60;
    if(h>0) return h+'h '+m+'m '+sec+'s';
    if(m>0) return m+'m '+sec+'s';
    return sec+'s';
  }

  function buildSummary(){
    const durationMs=Date.now()-log.startedAt;
    const cf=cfCache||getCfFromStorage()||{};
    const ip=cf.ip||'?';
    const loc=cf.loc||'?';
    const colo=cf.colo||'?';
    // top 5 acciones
    const actionsTop=Object.entries(log.actions)
      .sort((a,b)=>b[1]-a[1]).slice(0,5)
      .map(([k,v])=>k+':'+v).join(' ');
    // ultimos 8 estados unicos
    const statesView=log.states.slice(-8).join(' → ')||'-';
    // ultimos 8 comandos
    const cmdsView=log.commands.slice(-8).join(', ')||'-';
    const lines=[
      '📊 SESIÓN FINALIZADA AdmiraXP',
      '⏱️ Tiempo: '+fmtDuration(durationMs),
      '🎯 Comandos ('+log.commands.length+'): '+cmdsView,
      '🖱️ Clicks canvas: '+log.clicks,
      actionsTop ? '⚡ Acciones: '+actionsTop : null,
      '🗂️ Estados: '+statesView,
      '🌐 IP: '+ip+' ('+loc+' · '+colo+')',
      '🔗 '+location.pathname+location.search+' · sid '+log.sessionId,
    ].filter(Boolean);
    return lines.join('\n');
  }

  function flush(reason){
    if(log.sentEnd) return; log.sentEnd=true;
    const text=buildSummary();
    const payload=JSON.stringify({text});
    // sendBeacon es lo unico fiable en beforeunload: el navegador NO
    // espera a un fetch pero SI a sendBeacon (queue + send con prioridad).
    const blob=new Blob([payload],{type:'application/json'});
    try {
      // Primero worker, despues fallback Mac Mini
      const endpoints=[
        'https://bridge.admira.store/telegram/send',
        'https://macmini.tail48b61c.ts.net/admira/telegram/send',
      ];
      let sent=false;
      for(const ep of endpoints){
        try { if(navigator.sendBeacon(ep, blob)) { sent=true; break; } } catch(_){}
      }
      if(!sent){
        // Ultima opcion: fetch con keepalive (mejor que nada)
        fetch(endpoints[0],{method:'POST',headers:{'Content-Type':'application/json'},body:payload,keepalive:true}).catch(()=>{});
      }
    } catch(_){}
  }

  // Triggers de fin de sesion
  window.addEventListener('pagehide',()=>flush('pagehide'));
  window.addEventListener('beforeunload',()=>flush('beforeunload'));
  document.addEventListener('visibilitychange',()=>{
    // En mobile la pestaña pasa a hidden cuando el user cambia de app
    // pero podria volver. Disparamos solo si quedo hidden mas de 60s.
    if(document.visibilityState!=='hidden') return;
    setTimeout(()=>{
      if(document.visibilityState==='hidden' && !log.sentEnd) flush('visibilityHidden60s');
    },60000);
  });

  // Pre-cache del CF trace al arrancar para que el flush no se vea
  // limitado por la red durante el unload.
  fetchCf();

  // API publica
  window.AdmiraXP_SessionLog=log;
})();
