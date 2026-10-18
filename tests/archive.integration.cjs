// Run only against an isolated test backend with integration-admin provisioned.
const assert=require('node:assert/strict');
const base=process.env.NAS_TEST_URL||'http://127.0.0.1:8088';

async function main() {
  const auth=await fetch(base+'/api/v2/token',{headers:{Authorization:'Basic '+Buffer.from('integration-admin:Integration-Only-Admin-7x!r').toString('base64')}});
  assert.equal(auth.status,200);
  const admin=(await auth.json()).access_token;
  const username='archive-'+Date.now().toString(36),password='Archive-Test-Only-8p!r';
  const adminRequest=(url,method,body)=>fetch(base+'/api/v2/'+url,{method,headers:{Authorization:'Bearer '+admin,'Content-Type':'application/json'},body:body&&JSON.stringify(body)});
  const created=await adminRequest('users','POST',{username,password,status:1,permissions:{'/':['*']}});
  assert.equal(created.status,201,await created.text());
  try {
    let response=await fetch(base+'/web/client/login');
    const csrf=(await response.text()).match(/name="_form_token" value="([^"]+)"/)[1];
    response=await fetch(base+'/web/client/login',{method:'POST',redirect:'manual',headers:{Cookie:response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username,password,_form_token:csrf})});
    assert.equal(response.status,302);
    const cookie=response.headers.getSetCookie().find(c=>c.startsWith('jwt=')).split(';')[0];
    const request=(url,options={})=>fetch(new URL(url,base),{...options,headers:{Cookie:cookie,...options.headers}});
    response=await request('/web/client/files?air_frame=1');
    const token=(await response.text()).match(/AirRecycleConfig=\{csrf:'([^']+)'/)[1];
    response=await request('/web/client/file?path=%2Farchive-test.js',{method:'POST',headers:{'X-CSRF-TOKEN':token},body:'console.log("archive integration");'});
    assert.ok(response.ok,await response.text());
    response=await request('/web/client/download-manifest?path=%2F&archive=prepare',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_form_token:token,files:JSON.stringify(['archive-test.js'])})});
    assert.equal(response.status,200,await response.clone().text());
    let state=await response.json();
    const archiveURL=new URL(state.url,base);
    const statusURL=new URL(archiveURL);statusURL.searchParams.set('status','1');
    for(let attempt=0;state.state==='preparing'&&attempt<100;attempt++) {
      await new Promise(resolve=>setTimeout(resolve,100));
      response=await request(statusURL);assert.equal(response.status,200);state=await response.json();
    }
    assert.equal(state.state,'ready',JSON.stringify(state));assert.ok(state.size>0);
    response=await request(archiveURL);
    const bytes=Buffer.from(await response.arrayBuffer());
    assert.equal(response.status,200);assert.equal(bytes.length,state.size);assert.equal(bytes.readUInt32LE(0),0x04034b50);
    const etag=response.headers.get('etag');
    response=await request(archiveURL,{headers:{Range:'bytes=2-9','If-Range':etag}});
    assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes.subarray(2,10));
    response=await fetch(archiveURL,{redirect:'manual'});assert.notEqual(response.status,200);
    console.log('PASS: real ZIP preparation, cache state, ranged download and authentication');
  } finally {
    const removed=await adminRequest('users/'+username,'DELETE');assert.equal(removed.status,200);
  }
}
main().catch(error=>{console.error(error);process.exitCode=1});
