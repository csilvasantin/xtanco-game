// session-ping.js — anuncia por Telegram cada nueva sesion del juego.
//
// Cuando game.html carga:
//   1. Comprueba sessionStorage('xtanco_session_pinged') → si ya envió, sale
//   2. Salta si URL tiene ?nolog=1 (para el propio usuario)
//   3. Salta si origin es localhost (entorno de desarrollo)
//   4. Captura UA, browser/OS, resolución, viewport, timezone, idioma
//   5. Fetcha https://www.cloudflare.com/cdn-cgi/trace para IP + país + colo
//   6. POSTea a /telegram/send (admira-telegram-bridge worker o Mac Mini fallback)
//   7. Marca sessionStorage para no repetir
//
// No incluye datos PII más allá de IP pública (que Cloudflare ya ve igualmente).

(function(){
  if(typeof window==='undefined') return;
  try {
    // 1. Sessionstorage flag — solo 1 ping por sesión
    if(sessionStorage.getItem('xtanco_session_pinged')==='1') return;
    // 2. Opt-out
    const url=new URL(window.location.href);
    if(url.searchParams.get('nolog')==='1') return;
    // 3. Skip localhost / dev
    const host=window.location.hostname;
    if(host==='localhost' || host==='127.0.0.1' || host.endsWith('.local')) return;
    // 4. Rastreadores y navegadores automatizados (FLT-1779, 5-sep-2026): Googlebot renderiza la
    //    página y disparaba «NUEVA SESIÓN» en Telegram por cada rastreo (IP 66.249.x). No son
    //    visitas: no se avisa.
    if(navigator.webdriver) return;
    if(/bot|crawl|spider|slurp|bingpreview|headless|lighthouse|pagespeed|facebookexternalhit|whatsapp|telegrambot|linkedinbot|twitterbot|applebot|petalbot|semrush|ahrefs|mj12|dataforseo|python-requests|curl\//i.test(navigator.userAgent||'')) return;
  } catch(_){ return; }

  // Parse simple UA → {browser, os}
  function parseUA(ua){
    ua=String(ua||'');
    let os='Desconocido', browser='Desconocido';
    // OS
    if(/iPhone|iPad|iPod/.test(ua)) os='iOS';
    else if(/Android/.test(ua)) os='Android';
    else if(/Mac OS X|Macintosh/.test(ua)) os='macOS';
    else if(/Windows NT/.test(ua)) os='Windows';
    else if(/Linux/.test(ua)) os='Linux';
    // Browser (orden importa)
    if(/Edg\//.test(ua)) browser='Edge';
    else if(/OPR\/|Opera/.test(ua)) browser='Opera';
    else if(/Firefox\//.test(ua)) browser='Firefox';
    else if(/Chrome\//.test(ua) && !/Edg\//.test(ua)) browser='Chrome';
    else if(/Safari\//.test(ua) && /Version\//.test(ua)) browser='Safari';
    // Version mejor que UA completo
    const m=ua.match(/(Chrome|Firefox|Safari|Edg|OPR|Opera)\/([\d.]+)/);
    const ver=m ? ' '+m[2].split('.').slice(0,2).join('.') : '';
    return { os, browser:browser+ver };
  }

  async function getCloudflareTrace(){
    try {
      const r=await fetch('https://www.cloudflare.com/cdn-cgi/trace',{cache:'no-store'});
      if(!r.ok) return null;
      const t=await r.text();
      const map={};
      t.split(/\r?\n/).forEach(line=>{
        const i=line.indexOf('=');
        if(i>0) map[line.slice(0,i)]=line.slice(i+1);
      });
      // Cache en sessionStorage para que session-log lo reuse al cerrar
      // (sendBeacon no espera fetches, asi que pre-cachear es clave).
      try { sessionStorage.setItem('xtanco_cf_trace',JSON.stringify(map)); } catch(_){}
      return map; // ip, loc, colo, uag, etc.
    } catch(e){ return null; }
  }

  async function sendTelegram(text){
    const endpoints=[
      'https://bridge.admira.store/telegram/send',
      'https://macmini.tail48b61c.ts.net/admira/telegram/send',
    ];
    for(const url of endpoints){
      try {
        const r=await fetch(url,{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({text}),
        });
        if(r.ok) return true;
      } catch(_){}
    }
    return false;
  }

  async function ping(){
    const ua=navigator.userAgent;
    const {os,browser}=parseUA(ua);
    const screenWH=screen.width+'x'+screen.height;
    const viewport=window.innerWidth+'x'+window.innerHeight;
    let tz='?', lang='?';
    try { tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'?'; } catch(_){}
    try { lang=navigator.language||'?'; } catch(_){}
    const path=(window.location.pathname||'/')+(window.location.search||'');

    const cf=await getCloudflareTrace();
    const ip=cf?.ip||'?';
    const loc=cf?.loc||'?';
    const colo=cf?.colo||'?';

    const lines=[
      '👤 NUEVA SESIÓN AdmiraXP',
      '🌐 IP: '+ip+' ('+loc+' · '+colo+')',
      '🖥️ '+os+' · '+browser,
      '📱 Pantalla '+screenWH+' · viewport '+viewport,
      '🕐 '+tz+' · '+lang,
      '🔗 '+path,
    ];
    const ok=await sendTelegram(lines.join('\n'));
    if(ok){
      try { sessionStorage.setItem('xtanco_session_pinged','1'); } catch(_){}
    }
  }

  // Espera ~2s tras DOMContentLoaded para no competir con la carga inicial
  function schedule(){ setTimeout(()=>{ ping().catch(()=>{}); }, 2000); }
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', schedule, {once:true});
  } else {
    schedule();
  }
})();
