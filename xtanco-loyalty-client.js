// Xtanco Club bridge — connects Admira XP with the admira-loyalty Worker / PWA.
// Exposes a small global `LoyaltyBridge` that the game's spawn + checkout
// hooks consult. Pure browser ES2017+, no deps beyond qrcode.min.js for the QR.
(function(){
  // dominio propio: LaLiga bloquea workers.dev en horas de fútbol, FLT-1633
  const API='https://loyalty.admira.store';
  const JOIN_CODE='XTANCO26';
  const PWA_PATH='loyalty-app/';
  const POLL_MS=12000;

  const lastCheckin=new Map();   // customerId -> last lastCheckin handled (debounce respawn)
  const inSceneIds=new Set();    // customerIds currently embodied in the game
  const pending=[];              // queue of fan dicts ready to be embodied
  const tokensByCustomerId=new Map(); // customerId -> token (so checkout can /visit)

  function pwaUrl(){
    const base=location.href.replace(/[^/]*$/,'');
    return base+PWA_PATH+'?join='+encodeURIComponent(JOIN_CODE);
  }

  let pollHandle=null;
  let pollFailures=0;
  async function poll(){
    try{
      const res=await fetch(API+'/active',{cache:'no-store'});
      if(!res.ok) throw new Error('http_'+res.status);
      const data=await res.json();
      pollFailures=0;
      const now=Math.floor(Date.now()/1000);
      const seenIds=new Set();
      for(const c of (data.customers||[])){
        if(!c||c.id==null) continue;
        seenIds.add(c.id);
        const last=lastCheckin.get(c.id)||0;
        const fresh=c.lastCheckin&&c.lastCheckin>last;
        const inScene=inSceneIds.has(c.id);
        if(fresh && !inScene){
          lastCheckin.set(c.id,c.lastCheckin);
          pending.push(c);
        }
      }
      // Drop stale ids that no longer come back as active (re-eligible to spawn later)
      for(const id of Array.from(lastCheckin.keys())){
        if(!seenIds.has(id)) lastCheckin.delete(id);
      }
    }catch(err){
      pollFailures++;
      if(pollFailures<3) console.warn('LoyaltyBridge.poll failed',err);
    }
  }

  function startPolling(){
    if(pollHandle) return;
    poll();
    pollHandle=setInterval(poll,POLL_MS);
  }

  function takePendingFan(){
    return pending.shift()||null;
  }

  function markInScene(customerId,token){
    if(customerId==null) return;
    inSceneIds.add(customerId);
    if(token) tokensByCustomerId.set(customerId,token);
  }
  function clearFromScene(customerId){
    if(customerId==null) return;
    inSceneIds.delete(customerId);
    tokensByCustomerId.delete(customerId);
  }

  async function notifyShopVisit(customerId,productName,revenue){
    if(customerId==null) return null;
    try{
      const res=await fetch(API+'/shop/visit',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          shopJoinCode:JOIN_CODE,
          customerId,
          product:productName||null,
          revenue:Math.max(0,Math.floor(revenue||0)),
        }),
      });
      if(!res.ok){
        const data=await res.json().catch(()=>null);
        console.warn('LoyaltyBridge.notifyShopVisit',res.status,data);
        return null;
      }
      return await res.json();
    }catch(err){
      console.warn('LoyaltyBridge.notifyShopVisit failed',err);
      return null;
    }
  }

  let qrInstance=null;
  let qrLastUrl='';
  function renderQrInto(el,url){
    if(!el) return;
    const target=url||pwaUrl();
    if(typeof QRCode==='undefined'){
      el.textContent='QR no disponible (qrcode.min.js no cargó)';
      return;
    }
    if(qrInstance && qrLastUrl===target) return;
    el.innerHTML='';
    qrInstance=new QRCode(el,{
      text:target, width:140, height:140,
      colorDark:'#02131a', colorLight:'#dff8ff',
      correctLevel:QRCode.CorrectLevel.M,
    });
    qrLastUrl=target;
  }

  window.LoyaltyBridge={
    api:API, joinCode:JOIN_CODE,
    pwaUrl, startPolling, takePendingFan,
    markInScene, clearFromScene,
    notifyShopVisit, renderQrInto,
    _state:{lastCheckin,inSceneIds,pending,tokensByCustomerId},
  };

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',startPolling,{once:true});
  } else {
    startPolling();
  }
})();
