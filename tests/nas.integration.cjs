const assert=require('node:assert/strict');
const base=process.env.NAS_TEST_URL||'http://127.0.0.1:8088';
const password='Integration-Only-User-9w!t';
async function main(){
 const auth=await fetch(base+'/api/v2/token',{headers:{Authorization:'Basic '+Buffer.from('integration-admin:Integration-Only-Admin-7x!r').toString('base64')}});assert.equal(auth.status,200);const admin=(await auth.json()).access_token;
 const suffix=Date.now().toString(36),names=['nas-a-'+suffix,'nas-b-'+suffix];
 const adminApi=(url,method='GET',body)=>fetch(base+'/api/v2/'+url,{method,headers:{Authorization:'Bearer '+admin,'Content-Type':'application/json'},body:body&&JSON.stringify(body)});
 async function session(username){
  let r=await adminApi('users','POST',{username,password,status:1,quota_size:1048576,permissions:{'/':['*']}});assert.equal(r.status,201,await r.text());
  r=await fetch(base+'/web/client/login');const csrf=(await r.text()).match(/name="_form_token" value="([^"]+)"/)[1];
  r=await fetch(base+'/web/client/login',{method:'POST',redirect:'manual',headers:{Cookie:r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; '),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username,password,_form_token:csrf})});assert.equal(r.status,302);const cookie=r.headers.getSetCookie().find(v=>v.startsWith('jwt=')).split(';')[0];
  const call=(url,method='GET',body,headers={})=>fetch(base+url,{method,redirect:'manual',headers:{Cookie:cookie,...headers},body});
  r=await call('/web/client/files?air_frame=1');assert.equal(r.status,200);const html=await r.text();const token=html.match(/AirRecycleConfig=\{csrf:'([^']+)'/)[1];
  const recycle=(body,csrf=token)=>call('/web/client/recycle','POST',JSON.stringify(body),{'Content-Type':'application/json','X-CSRF-TOKEN':csrf});
  const upload=(file,body)=>call('/web/client/file?path='+encodeURIComponent(file),'POST',body,{'X-CSRF-TOKEN':token});
  return {call,recycle,upload,token,cookie};
 }
 try{
 const a=await session(names[0]),b=await session(names[1]);
 let r=await a.upload('/sample.txt','original');assert.ok(r.ok,await r.text());
 r=await a.call('/web/client/files?path=%2Fsample.txt','DELETE',undefined,{'X-CSRF-TOKEN':a.token});assert.ok(r.ok,await r.text());
 const list=async s=>{const r=await s.call('/web/client/recycle');assert.equal(r.status,200);return r.json()};
 let items=(await list(a)).items;assert.equal(items.length,1);assert.equal(items[0].original,'/sample.txt');const id=items[0].id;
 assert.equal((await list(b)).items.length,0);assert.notEqual((await b.recycle({action:'restore',id})).status,200,'cross-account restore blocked');assert.notEqual((await a.recycle({action:'restore',id},'invalid')).status,200,'CSRF required');
 r=await a.call('/web/client/capacity');const capacity=await r.json();assert.equal(capacity.used,0);assert.equal(capacity.recycle,8);assert.equal(capacity.capacity,1048576);
 r=await a.upload('/sample.txt','new');assert.ok(r.ok);assert.equal((await a.recycle({action:'restore',id})).status,409,'restore never overwrites');
 r=await a.call('/web/client/files?path=%2Fsample.txt','DELETE',undefined,{'X-CSRF-TOKEN':a.token});assert.ok(r.ok);r=await a.recycle({action:'restore',id});assert.ok(r.ok,await r.text());
 r=await a.call('/web/client/files?air_raw=1&path=%2Fsample.txt');assert.equal(await r.text(),'original');
 r=await a.call('/web/client/dirs?search=sample');assert.ok((await r.json()).results.some(v=>v.name==='sample.txt'));
 r=await a.recycle({action:'settings',days:7});assert.ok(r.ok);assert.equal((await list(a)).days,7);r=await a.recycle({action:'empty'});assert.ok(r.ok);assert.equal((await list(a)).items.length,0);
 r=await a.call('/web/client/download-manifest?path=/','POST',new URLSearchParams({files:JSON.stringify(['sample.txt'])}),{'X-CSRF-TOKEN':a.token,'Content-Type':'application/x-www-form-urlencoded'});
 // Manifest validates the native form token rather than only the header.
 assert.equal(r.status,403);
 r=await a.call('/web/client/download-manifest?path=/','POST',new URLSearchParams({files:JSON.stringify(['sample.txt']),_form_token:a.token}),{'Content-Type':'application/x-www-form-urlencoded'});assert.equal(r.status,200);assert.equal((await r.json()).files[0].size,8);

 // An interrupted overwrite must preserve the old file and clean its temporary data.
 await new Promise(resolve=>{const http=require('node:http');const req=http.request(new URL('/web/client/file?path=%2Fsample.txt',base),{method:'POST',headers:{Cookie:a.cookie,'X-CSRF-TOKEN':a.token,'Content-Length':'262144'}},res=>res.resume());req.on('error',()=>{});req.write(Buffer.alloc(8192,65));setTimeout(()=>{req.destroy();resolve()},200)});
 await new Promise(resolve=>setTimeout(resolve,300));r=await a.call('/web/client/files?air_raw=1&path=%2Fsample.txt');assert.equal(await r.text(),'original','cancelled overwrite preserves old file');
 r=await a.call('/web/client/dirs?path=%2Ffolder%2Fnested&mkdir_parents=true','POST',undefined,{'X-CSRF-TOKEN':a.token});assert.ok(r.ok,await r.text());r=await a.upload('/folder/nested/deep.txt','nested data');assert.ok(r.ok);
 r=await a.call('/web/client/dirs?path=%2Ffolder','DELETE',undefined,{'X-CSRF-TOKEN':a.token});assert.equal(r.status,202);let folder;
 for(let i=0;i<50;i++){folder=(await list(a)).items.find(v=>v.original==='/folder');if(folder)break;await new Promise(resolve=>setTimeout(resolve,100))}assert.ok(folder,'directory delete moves to recycle');
 r=await a.recycle({action:'restore',id:folder.id});assert.ok(r.ok,await r.text());r=await a.call('/web/client/files?air_raw=1&path=%2Ffolder%2Fnested%2Fdeep.txt');assert.equal(await r.text(),'nested data');
 r=await a.call('/web/client/profile');assert.ok((await r.text()).includes('nas-avatar-options'));
 console.log('PASS: authenticated recycle/restore, conflict protection, account isolation, CSRF, capacity, recursive search, retention, purge, manifests, cancelled overwrite, nested folder restore and avatar profile');
 }finally{for(const name of names)await adminApi('users/'+name+'?remove=true','DELETE')}
}
main().catch(e=>{console.error(e);process.exitCode=1});
