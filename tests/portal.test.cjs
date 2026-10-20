const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
let mock, portal, base, healthy = true;
before(async () => {
  mock = http.createServer((req, res) => {
    if(req.url === '/healthz') {res.writeHead(healthy ? 200 : 503); return res.end('ok');}
    if(req.url === '/web/client/upload') { const chunks=[]; req.on('data', b=>chunks.push(b)); return req.on('end', ()=>res.end(Buffer.concat(chunks))); }
    res.setHeader('Set-Cookie', 'session=test; HttpOnly; Path=/');
    res.end(JSON.stringify({url:req.url,headers:req.headers}));
  });
  await new Promise(r=>mock.listen(0,'127.0.0.1',r));
  process.env.NAS_UPSTREAM = `http://127.0.0.1:${mock.address().port}`;
  process.env.NAS_TRUSTED_PROXIES = '';
  portal = require('../portal/server.cjs');
  await new Promise(r=>portal.listen(0,'127.0.0.1',r));
  base=`http://127.0.0.1:${portal.address().port}`;
});
after(async()=>{await Promise.all([new Promise(r=>portal.close(r)),new Promise(r=>mock.close(r))]);});
test('landing page has setup, client and corresponding source links', async()=>{
  const r=await fetch(base); assert.equal(r.status,200); const body=await r.text();
  for(const link of ['/web/admin/','/web/client/','https://github.com/drakkan/sftpgo','https://github.com/DPswxz/Air-Cloud']) assert.ok(body.includes(link));
});
test('backend health failures are reported',async()=>{
  assert.equal((await fetch(base+'/healthz')).status,200);
  healthy=false; assert.equal((await fetch(base+'/healthz')).status,503); healthy=true;
});
test('proxy preserves paths, cookies and strips spoofed identity',async()=>{
  const r=await fetch(base+'/web/client/files?path=%2Fphotos',{headers:{'x-forwarded-for':'1.2.3.4','x-real-ip':'1.2.3.4','x-forwarded-proto':'https','x-nas-client-ip':'1.2.3.4','cf-connecting-ip':'1.2.3.4',cookie:'session=mine'}});
  assert.ok(r.headers.get('set-cookie').includes('session=test'));
  const data=await r.json(); assert.equal(data.url,'/web/client/files?path=%2Fphotos'); assert.equal(data.headers.cookie,'session=mine');
  assert.equal(data.headers.host,new URL(base).host);
  assert.equal(data.headers['x-real-ip'],'127.0.0.1');
  assert.equal(data.headers['x-forwarded-proto'],'http');
  for(const name of ['x-forwarded-for','x-nas-client-ip','cf-connecting-ip']) assert.equal(data.headers[name],undefined);
});
test('binary uploads stream without corruption',async()=>{
  const body=require('node:crypto').randomBytes(1024*1024);
  const r=await fetch(base+'/web/client/upload',{method:'POST',body});
  assert.deepEqual(Buffer.from(await r.arrayBuffer()),body);
});
test('short shares map to the protected native share page',async()=>{
  const response=await fetch(base+'/1?path=%2F',{redirect:'manual'});
  assert.equal(response.status,302);
  assert.equal(response.headers.get('location'),'/web/client/pubshares/1/view?path=%2F');
  const reserved=await (await fetch(base+'/api')).json();
  assert.equal(reserved.url,'/api');
});
test('unavailable upstream returns 503',async()=>{
  await new Promise(r=>mock.close(r));
  const r=await fetch(base+'/web/client/');assert.equal(r.status,503);
});
