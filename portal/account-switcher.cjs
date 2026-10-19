'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const TTL=30*86400000;
const tokenAge=token=>{try{return Math.max(0,Math.min(TTL/1000,Math.floor(JSON.parse(Buffer.from(token.split('.')[1],'base64url')).exp-Date.now()/1000)))}catch{return 0}};
const readCookie=(req,name)=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';
const decode=s=>s.replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([a-f\d]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function createAccounts({directory,upstream,secure,address=req=>req.socket.remoteAddress}){
 fs.mkdirSync(directory,{recursive:true});const keyFile=path.join(directory,'key');
 if(!fs.existsSync(keyFile))fs.writeFileSync(keyFile,crypto.randomBytes(32),{mode:0o600,flag:'wx'});
 const key=fs.readFileSync(keyFile),file=path.join(directory,'sessions.enc');let browsers={};
 if(fs.existsSync(file)){const data=fs.readFileSync(file),dec=crypto.createDecipheriv('aes-256-gcm',key,data.subarray(0,12));dec.setAuthTag(data.subarray(12,28));browsers=JSON.parse(Buffer.concat([dec.update(data.subarray(28)),dec.final()]).toString())}
 function persist(){for(const [id,b]of Object.entries(browsers))if(Date.now()-b.updated>TTL)delete browsers[id];const iv=crypto.randomBytes(12),enc=crypto.createCipheriv('aes-256-gcm',key,iv),body=Buffer.concat([enc.update(JSON.stringify(browsers)),enc.final()]);fs.writeFileSync(file+'.tmp',Buffer.concat([iv,enc.getAuthTag(),body]),{mode:0o600});fs.renameSync(file+'.tmp',file)}
 let removedInternal=false;for(const b of Object.values(browsers)){const before=b.accounts.length;b.accounts=b.accounts.filter(a=>!a.username.startsWith('__nas_admin_view_'));if(before!==b.accounts.length)removedInternal=true}if(removedInternal)persist();
 function browser(req,res,create=false){let id=readCookie(req,'NAS_ACCOUNTS'),b=browsers[id];if(b&&Date.now()-b.updated>TTL){delete browsers[id];b=null}if(!b&&create){if(Object.keys(browsers).length>=1000)return null;id=crypto.randomBytes(32).toString('hex');b=browsers[id]={updated:Date.now(),accounts:[]};res.setHeader('Set-Cookie','NAS_ACCOUNTS='+id+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000'+(secure(req)?'; Secure':''))}if(b&&create)res.setHeader('Set-Cookie','NAS_ACCOUNTS='+id+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000'+(secure(req)?'; Secure':''));return b}
 async function profile(req,role,token){
  if(!token||token.length>8192)return null;const headers={Cookie:'jwt='+token,'User-Agent':req.headers['user-agent']||'Air Cloud','X-NAS-Client-IP':address(req)||'127.0.0.1','X-Real-IP':address(req)||'127.0.0.1'};
  const r=await fetch(upstream(role)+'/web/'+role+'/profile',{headers,redirect:'manual',signal:AbortSignal.timeout(5000)});if(r.status!==200){await r.arrayBuffer();return null}const html=await r.text(),name=html.match(/data-air-owner="([^"]+)"/)?.[1];if(!name||decode(name).startsWith('__nas_admin_view_'))return null;
  const email=html.match(/<input\b[^>]*\bname="email"[^>]*>/i)?.[0].match(/\bvalue="([^"]*)"/)?.[1]||'';
  const avatar=html.match(/<img\b[^>]*\bsrc="([^"]+)"[^>]*class="nas-avatar-large"/)?.[1]||'/static/nas-avatars/default.svg';
  const refreshed=r.headers.getSetCookie().find(c=>c.startsWith('jwt='))?.split(';')[0].slice(4);
  return {username:decode(name),email:decode(email),avatar:decode(avatar),token:refreshed||token,role};
 }
 function forget(req){const b=browsers[readCookie(req,'NAS_ACCOUNTS')];if(!b)return;const token=readCookie(req,'jwt'),role=req.url.startsWith('/web/admin/')?'admin':'client';b.accounts=b.accounts.filter(a=>!(a.role===role&&a.token===token));b.updated=Date.now();persist()}
 async function handle(req,res){const url=new URL(req.url,'http://nas'),m=/^\/web\/(client|admin)\/accounts\/(list|remember|switch|logout-all)$/.exec(url.pathname);if(!m)return false;
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));return true};
  try{
   if(req.method!==(m[2]==='list'?'GET':'POST'))return send(405,{});
   if(m[2]!=='list'&&(req.headers['x-air-accounts']!=='1'||(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)||req.headers['sec-fetch-site']==='cross-site'))return send(403,{});
   let b=browser(req,res);
   if(m[2]==='remember'){const account=await profile(req,m[1],readCookie(req,'jwt'));if(!account)return send(401,{});b=browser(req,res,true);if(!b)return send(503,{});if(account.token!==readCookie(req,'jwt')){const existing=res.getHeader('Set-Cookie');res.setHeader('Set-Cookie',[...(existing?[existing]:[]),'jwt='+account.token+'; Path=/web/'+m[1]+'; HttpOnly; SameSite=Strict; Max-Age='+tokenAge(account.token)+(secure(req)?'; Secure':'')])}const old=b.accounts.find(a=>a.username===account.username&&a.role===account.role);Object.assign(account,{id:old?.id||crypto.randomBytes(16).toString('hex')});b.accounts=b.accounts.filter(a=>a.id!==account.id);b.accounts.unshift(account);b.accounts=b.accounts.slice(0,10);b.updated=Date.now();persist();return send(200,{})}
   if(m[2]==='list')return send(200,{accounts:(b?.accounts||[]).map(({id,username,email,avatar,role})=>({id,username,email,avatar,role,current:role===m[1]&&b.accounts.find(a=>a.id===id).token===readCookie(req,'jwt')}))});
   if(!b)return send(404,{});

   if(m[2]==='logout-all'){const results=await Promise.allSettled(b.accounts.map(async a=>{const r=await fetch(upstream(a.role)+'/web/'+a.role+'/logout',{headers:{Cookie:'jwt='+a.token,'X-NAS-Client-IP':address(req)||'127.0.0.1','X-Real-IP':address(req)||'127.0.0.1'},redirect:'manual',signal:AbortSignal.timeout(5000)});await r.arrayBuffer();if(r.status>=500)throw Error('Logout unavailable')}));if(results.some(r=>r.status==='rejected'))return send(503,{});b.accounts=[];b.updated=Date.now();persist();res.setHeader('Set-Cookie',['client','admin'].map(role=>'jwt=; Path=/web/'+role+'; HttpOnly; SameSite=Strict; Max-Age=0'+(secure(req)?'; Secure':'')));return send(200,{target:'/web/client/login?accounts=1'})}
   const a=b.accounts.find(a=>a.id===url.searchParams.get('id'));if(!a)return send(404,{});const verified=await profile(req,a.role,a.token);if(!verified||verified.username!==a.username){let reason='session_invalid';try{const claims=JSON.parse(Buffer.from(a.token.split('.')[1],'base64url'));if(claims.exp&&Date.now()>=claims.exp*1000)reason='session_expired';else if(Array.isArray(claims.aud)&&claims.aud.some(ip=>require('node:net').isIP(ip))&&!claims.aud.includes((address(req)||'').replace(/^::ffff:/,'')))reason='source_changed'}catch{}return send(401,{username:a.username,role:a.role,reason})}Object.assign(a,verified);b.updated=Date.now();persist();res.setHeader('Set-Cookie',['jwt='+a.token+'; Path=/web/'+a.role+'; HttpOnly; SameSite=Strict; Max-Age='+tokenAge(a.token)+(secure(req)?'; Secure':''),'NAS_LAST_ROLE='+(a.role==='admin'?'admin':'user')+'; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000'+(secure(req)?'; Secure':'')]);return send(200,{target:a.role==='admin'?'/web/admin/users':'/web/client/files'});
  }catch{return send(503,{})}
 }
 return {handle,forget};
}
module.exports={createAccounts};
