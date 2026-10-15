// Run against the real CI containers, not the mock upstream.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const base = 'http://127.0.0.1:8088';
const password = 'Integration-Only-User-9w!t';
async function main() {
  const tokenResponse = await fetch(base+'/api/v2/token', {headers:{Authorization:'Basic '+Buffer.from('integration-admin:Integration-Only-Admin-7x!r').toString('base64')}});
  assert.equal(tokenResponse.status,200);
  const {access_token} = await tokenResponse.json();
  const create = await fetch(base+'/api/v2/users', {method:'POST',headers:{Authorization:'Bearer '+access_token,'Content-Type':'application/json'},body:JSON.stringify({username:'session-test',password,status:1,permissions:{'/':['*']}})});
  assert.equal(create.status,201,await create.text());
  const login = await fetch(base+'/web/client/login');
  const html = await login.text();
  const csrf = html.match(/name="_form_token" value="([^"]+)"/)?.[1];
  assert.ok(csrf,'native CSRF form token');
  const jar = login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const result = await fetch(base+'/web/client/login',{method:'POST',redirect:'manual',headers:{Cookie:jar,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:'session-test',password,_form_token:csrf})});
  assert.equal(result.status,302);
  const cookies = result.headers.getSetCookie();
  const session = cookies.find(c=>/Max-Age=2592000(?:;|$)/i.test(c));
  assert.ok(session,'persistent cookie has exactly 30 days Max-Age');
  assert.match(session,/HttpOnly/i);
  const cookie = session.split(';')[0];
  const claims = JSON.parse(Buffer.from(cookie.split('=')[1].split('.')[1],'base64url'));
  assert.equal(claims.exp-claims.iat,30*24*60*60,'signed token also lasts 30 days');
  const target = result.headers.get('location');
  const visit = ()=>fetch(base+target,{headers:{Cookie:cookie},redirect:'manual'});
  assert.equal((await visit()).status,200,'valid session opens files without login');
  execFileSync('docker',['compose','restart','storage'],{stdio:'inherit'});
  const deadline=Date.now()+60000;
  while(true) {
    try {if((await fetch(base+'/healthz')).ok)break;}catch{}
    assert.ok(Date.now()<deadline,'backend restarts');
    await new Promise(r=>setTimeout(r,1000));
  }
  assert.equal((await visit()).status,200,'same browser session survives service restart');
  const logout = await fetch(base+'/web/client/logout',{headers:{Cookie:cookie},redirect:'manual'});
  assert.ok(logout.headers.getSetCookie().some(c=>/Max-Age=0|Max-Age=-1/.test(c)),'logout clears browser credential');
  assert.notEqual((await visit()).status,200,'logged-out credential rejected');
  console.log('PASS: 30-day cookie + signed expiry, authenticated access, restart persistence and logout');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
