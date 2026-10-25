/**
 * BespaarSlim persoonlijke PSD2-bankconnector op Cloudflare Workers.
 * API: Enable Banking - https://enablebanking.com/docs/api/reference
 * Gevoelige gegevens: uitsluitend Worker secrets, NOOIT GitHub of HTML.
 * De API is uitsluitend geschikt voor privégebruik met een lang willekeurig toegangstoken.
 */
const API = 'https://api.enablebanking.com';
const txt = new TextEncoder();
const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const jsonB64 = data => b64u(txt.encode(JSON.stringify(data)));
function send(value,status=200,origin='') {
  return new Response(JSON.stringify(value), {status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin', ...(origin?{'Access-Control-Allow-Origin':origin}: {})}});
}
function cors(origin){return {'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600','Vary':'Origin'};}
async function constantTimeTokenMatch(provided,expected){
  if(!provided || !expected || expected.length < 32)return false;
  const [a,b] = await Promise.all([crypto.subtle.digest('SHA-256',txt.encode(provided)),crypto.subtle.digest('SHA-256',txt.encode(expected))]);
  const aa=new Uint8Array(a),bb=new Uint8Array(b);let diff=0;
  for(let i=0;i<aa.length;i++)diff|=aa[i]^bb[i];
  return diff===0;
}
async function signedJWT(env){
  const now=Math.floor(Date.now()/1000);
  const header=jsonB64({typ:'JWT',alg:'RS256',kid:env.ENABLE_APP_ID});
  const claims=jsonB64({iss:'enablebanking.com',aud:'api.enablebanking.com',iat:now,exp:now+300});
  const pem=env.ENABLE_PRIVATE_KEY.replace(/\\n/g,'\n').replace(/-----[^-]+-----/g,'').replace(/\s+/g,'');
  const bytes=Uint8Array.from(atob(pem),c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey('pkcs8',bytes,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,txt.encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64u(signature)}`;
}
async function api(env,path,method='GET',body){
  const jwt=await signedJWT(env);
  const res=await fetch(API+path,{method,headers:{Authorization:`Bearer ${jwt}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})}, ...(body?{body:JSON.stringify(body)}:{})});
  if(res.status===204)return {};
  const data=await res.json().catch(()=>({}));
  if(!res.ok){const summary=String(data.message||data.error_description||data.error||data.detail||'Bankprovider niet beschikbaar').slice(0,240);throw new Error(`Enable Banking (${res.status}): ${summary}`);}
  return data;
}
const sessionsKey='sessions-v1';
async function sessions(env){return (await env.BANK_KV.get(sessionsKey,'json'))||[];}
async function saveSessions(env,list){await env.BANK_KV.put(sessionsKey,JSON.stringify(list));}
function allowedOrigin(env){return new URL(env.FRONTEND_URL).origin;}
function frontendRedirect(env,status){const url=new URL(env.FRONTEND_URL);url.searchParams.set('bank_status',status);return Response.redirect(url.toString(),303);}
function required(env){
  if(!env.BANK_KV || !env.ENABLE_PRIVATE_KEY || !env.ENABLE_APP_ID || !env.APP_ACCESS_TOKEN || !env.FRONTEND_URL || !env.WORKER_URL)throw new Error('Workerconfiguratie is niet compleet.');
  const origin=allowedOrigin(env);
  if(!origin.startsWith('https://')&&!origin.startsWith('http://localhost'))throw new Error('Alleen HTTPS of localhost is toegestaan.');
  if(!new URL(env.WORKER_URL).origin.startsWith('https://'))throw new Error('WORKER_URL moet HTTPS gebruiken.');
  return origin;
}
function bankList(result){return (result.aspsps||[]).filter(b=>b.country==='NL'&&b.psu_types?.includes('personal')).map(b=>({name:b.name,country:b.country,maximum_consent_validity:b.maximum_consent_validity})).sort((a,b)=>a.name.localeCompare(b.name,'nl'));}
function pickName(t){const party=t.credit_debit_indicator==='DBIT'?t.creditor:t.debtor;return String(party?.name||t.remittance_information?.join(' ')||t.note||'Banktransactie').slice(0,100);}
function category(name,type){if(type==='income')return 'Inkomsten';const n=name.toLowerCase();if(/albert heijn|jumbo|lidl|aldi|plus |dirk |picnic|boodschappen/.test(n))return 'Boodschappen';if(/huur|hypotheek|woning|waternet|energie|eneco|vattenfall/.test(n))return 'Wonen';if(/ns |ovchip|ov-chip|arriva|shell|esso|q8|tank/.test(n))return 'Vervoer';if(/netflix|spotify|videoland|disney|hbo |ziggo|vodafone|kpn |youfone|apple.com\/bill|google one/.test(n))return 'Abonnementen';if(/restaurant|cafe|café|thuisbezorgd|uber eats|koffie/.test(n))return 'Eten & drinken';if(/bol.com|amazon|hema|primark|h&m|zalando/.test(n))return 'Winkelen';return 'Overig';}
async function transactionId(a,t){
  const fingerprint=[a,t.entry_reference||'',t.booking_date||t.value_date||t.transaction_date||'',t.credit_debit_indicator,t.transaction_amount?.amount||'',t.creditor?.name||'',t.debtor?.name||'',...(t.remittance_information||[])].join('|');
  const hash=await crypto.subtle.digest('SHA-256',txt.encode(fingerprint));return 'bank-'+b64u(hash).slice(0,35);
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);const path=url.pathname;
  // Openbare testpagina om te controleren of de Worker is gepubliceerd.
  // Toont geen geheimen of bankinformatie.
  if(path==='/' || path==='/health'){
    return send({
      app:'BespaarSlim bankserver',
      online:true,
      configured:Boolean(env.BANK_KV && env.ENABLE_APP_ID && env.ENABLE_PRIVATE_KEY && env.APP_ACCESS_TOKEN && env.FRONTEND_URL && env.WORKER_URL),
      message:'De Worker draait. Voor een bankkoppeling zijn nog beveiligde instellingen nodig.'
    });
  }
  let origin='';
  try{origin=required(env);}catch(e){return send({error:e.message},503);}
  // Callback wordt rechtstreeks door de bankprovider bezocht, dus geen CORS of access-token.
  if(path==='/callback' && request.method==='GET'){
   const state=url.searchParams.get('state');if(!state||!/^[\w-]{30,100}$/.test(state))return frontendRedirect(env,'error');
   const cached=await env.BANK_KV.get(`state:${state}`);if(!cached)return frontendRedirect(env,'error');
   await env.BANK_KV.delete(`state:${state}`);
   if(url.searchParams.has('error')||!url.searchParams.has('code'))return frontendRedirect(env,'cancelled');
   try{
    const bankSession=await api(env,'/sessions','POST',{code:url.searchParams.get('code')});
    if(!bankSession.session_id||!Array.isArray(bankSession.accounts))throw new Error('Bank heeft geen accounts teruggegeven');
    const list=await sessions(env);
    list.push({session_id:bankSession.session_id,bank:bankSession.aspsp?.name||'Bank',accounts:bankSession.accounts.map(a=>({uid:a.uid,currency:a.currency,masked_iban:a.account_id?.iban?.slice(-4)||''})).filter(a=>a.uid),valid_until:bankSession.access?.valid_until||null});
    await saveSessions(env,list);
    return frontendRedirect(env,'connected');
   }catch(e){console.error('Bank callback mislukt:',e.message);return frontendRedirect(env,'error');}
  }
  if(!path.startsWith('/api/'))return send({error:'Niet gevonden'},404);
  if(request.method==='OPTIONS'){
   if(request.headers.get('Origin')!==origin)return new Response(null,{status:403});
   return new Response(null,{status:204,headers:cors(origin)});
  }
  const clientOrigin=request.headers.get('Origin');
  if(clientOrigin!==origin)return send({error:'Niet toegestane herkomst'},403);
  const bearer=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
  if(!await constantTimeTokenMatch(bearer,env.APP_ACCESS_TOKEN))return send({error:'Ongeldige toegangscode'},401,origin);
  try{
   if(path==='/api/status' && request.method==='GET'){
    const list=await sessions(env);return send({connected:list.length>0,accounts:list.flatMap(s=>s.accounts.map(a=>({bank:s.bank,currency:a.currency,last4:a.masked_iban,valid_until:s.valid_until})))},200,origin);
   }
   if(path==='/api/banks' && request.method==='GET'){
    return send({banks:bankList(await api(env,'/aspsps?country=NL&psu_type=personal&service=AIS'))},200,origin);
   }
   if(path==='/api/connect' && request.method==='POST'){
    const body=await request.json().catch(()=>({}));const banks=bankList(await api(env,'/aspsps?country=NL&psu_type=personal&service=AIS'));
    const selected=banks.find(b=>b.name===body.bank);if(!selected)return send({error:'Kies een beschikbare Nederlandse bank'},400,origin);
    const seconds=Math.min(90*86400,Math.max(3600,Number(selected.maximum_consent_validity)||3600))-120;
    const state=b64u(crypto.getRandomValues(new Uint8Array(32)));
    const callback=new URL('/callback',env.WORKER_URL).toString();
    await env.BANK_KV.put(`state:${state}`,'pending',{expirationTtl:600});
    const auth=await api(env,'/auth','POST',{access:{valid_until:new Date(Date.now()+seconds*1000).toISOString(),balances:false,transactions:true},aspsp:{name:selected.name,country:'NL'},state,redirect_url:callback,psu_type:'personal',language:'nl'});
    if(typeof auth.url!=='string'||!auth.url.startsWith('https://'))throw new Error('Banklink ontbreekt');
    return send({url:auth.url},200,origin);
   }
   if(path==='/api/sync' && request.method==='POST'){
    const list=await sessions(env);if(!list.length)return send({error:'Er is nog geen bank gekoppeld.'},400,origin);
    const transactions=[];const warnings=[];
    const from=new Date();from.setUTCMonth(from.getUTCMonth()-3);
    for(const s of list){for(const account of s.accounts){
     if(!account.uid)continue;
     try{
      let next='';let page=0;
      do{
       const q=new URLSearchParams({date_from:from.toISOString().slice(0,10),transaction_status:'BOOK'});
       if(next)q.set('continuation_key',next);
       const result=await api(env,`/accounts/${encodeURIComponent(account.uid)}/transactions?${q.toString()}`);
       for(const t of result.transactions||[]){
        if(t.status!=='BOOK'||t.transaction_amount?.currency!=='EUR')continue;
        const amount=Math.abs(Number(t.transaction_amount.amount));if(!Number.isFinite(amount)||amount<=0||amount>100000000)continue;
        const type=t.credit_debit_indicator==='CRDT'?'income':'expense';
        const date=t.booking_date||t.value_date||t.transaction_date;if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))continue;
        const name=pickName(t);
        transactions.push({id:await transactionId(account.uid,t),date,name,amount,type,category:category(name,type)});
       }
       next=result.continuation_key||'';page++;
      }while(next && page<8 && transactions.length<1200);
      if(next)warnings.push('Niet alle transactiepagina’s zijn opgehaald; probeer later opnieuw.');
     }catch(e){warnings.push(`${s.bank}: ${e.message}`.slice(0,230));}
    }}
    return send({transactions,warnings,accounts:list.reduce((n,s)=>n+s.accounts.length,0)},200,origin);
   }
   if(path==='/api/disconnect' && request.method==='POST'){
    const list=await sessions(env);const warnings=[];
    for(const s of list){try{await api(env,`/sessions/${encodeURIComponent(s.session_id)}`,'DELETE');}catch(e){warnings.push(s.bank+': toestemming kon niet bij de provider worden ingetrokken. Trek deze ook in via je bank.');}}
    await env.BANK_KV.delete(sessionsKey);
    return send({ok:true,warnings},200,origin);
   }
   return send({error:'Niet gevonden'},404,origin);
  }catch(e){console.error(e);return send({error:String(e.message||'Er is een fout opgetreden').slice(0,220)},502,origin);}
 }
};
