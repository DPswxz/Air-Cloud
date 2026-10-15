const assert=require('node:assert/strict');
const base=process.env.NAS_TEST_URL||'http://127.0.0.1:8088';
const username=process.env.NAS_TEST_USER||'session-test',password=process.env.NAS_TEST_PASSWORD||'Integration-Only-User-9w!t';
const csrf=html=>{const value=html.match(/name="_form_token" value="([^"]+)"/)?.[1];assert.ok(value,'native CSRF token');return value};
async function main(){
 const auth=await fetch(base+'/api/v2/user/token',{headers:{Authorization:'Basic '+Buffer.from(username+':'+password).toString('base64')}});assert.equal(auth.status,200);
 const token=(await auth.json()).access_token;
 const api=(url,method='GET',body)=>fetch(base+'/api/v2/user/'+url,{method,headers:{Authorization:'Bearer '+token},body});
 const upload=async(file,body)=>{const r=await api('files/upload?mkdir_parents=true&path='+encodeURIComponent(file),'POST',body);assert.ok(r.ok,await r.text())};
 await upload('/share-live/first.txt','first version');await upload('/share-live/sub/second.txt','nested');await upload('/private.txt','private');
 const first=await fetch(base+'/web/client/login');
 const login=await fetch(base+'/web/client/login',{method:'POST',redirect:'manual',headers:{Cookie:first.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username,password,_form_token:csrf(await first.text())})});assert.ok([302,303].includes(login.status));
 const cookie=login.headers.getSetCookie().filter(c=>c.startsWith('jwt=')).map(c=>c.split(';')[0]).join('; ');
 async function create(id,sharedPath='/share-live',sharePassword=''){
   const form=await fetch(base+'/web/client/share?path=/&files='+encodeURIComponent(JSON.stringify([sharedPath.slice(1)])),{headers:{Cookie:cookie}});
   return fetch(base+'/web/client/share',{method:'POST',redirect:'manual',headers:{Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_form_token:csrf(await form.text()),custom_id:id,name:'Shared folder',paths:sharedPath,scope:'1',max_tokens:'0',expiration_date:'',password:sharePassword})});
 }
 let r=await create('1');assert.equal(r.status,303,'custom one-character suffix accepted');assert.ok(r.headers.get('location').includes('created=1')||r.headers.get('location').endsWith('/shares'));
 r=await create('1');assert.notEqual(r.status,303);assert.ok((await r.text()).includes('这个分享后缀已被占用，请换一个'),'duplicate suffix shows useful error');
 r=await create('bad/slash');assert.notEqual(r.status,303);assert.ok((await r.text()).includes('分享后缀只能使用'));
 r=await create('web');assert.notEqual(r.status,303);
 r=await fetch(base+'/1');assert.equal(r.status,200);let page=await r.text();assert.ok(page.includes('file_manager_list'),'folder opens browsable share page');
 if(page.includes('AirTransfers.configure'))assert.ok(page.includes('enabled:false'),'public downloads do not call private transfer endpoints');
 const list=async()=>{const r=await fetch(base+'/web/client/pubshares/1/dirs?path=/');assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);return JSON.stringify(await r.json())};
 assert.ok((await list()).includes('first.txt'));assert.ok((await list()).includes('sub'));
 r=await fetch(base+'/web/client/pubshares/1/browse?path=/sub');assert.equal(r.status,200);
 await upload('/share-live/first.txt','updated version');
 r=await fetch(base+'/web/client/pubshares/1/browse?path=/first.txt');assert.equal(await r.text(),'updated version','updates appear without recreating share');
 await upload('/share-live/new.txt','new file');assert.ok((await list()).includes('new.txt'));
 r=await api('files?path='+encodeURIComponent('/share-live/new.txt'),'DELETE');assert.ok(r.ok);assert.ok(!(await list()).includes('new.txt'),'removed files disappear');
 r=await fetch(base+'/web/client/pubshares/1/partial?path=/',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({files:JSON.stringify(['first.txt'])})});assert.equal(r.status,200);const archive=Buffer.from(await r.arrayBuffer());assert.equal(archive.subarray(0,2).toString(),'PK');assert.ok(archive.includes(Buffer.from('first.txt')));assert.ok(!archive.includes(Buffer.from('second.txt')),'only selected files downloaded');
 r=await fetch(base+'/web/client/pubshares/1/browse?path='+encodeURIComponent('/../private.txt'));assert.notEqual(r.status,200,'cannot escape share root');
 r=await create('protected','/share-live','Share-Password-7r!q');assert.equal(r.status,303);
 r=await fetch(base+'/protected');assert.ok(r.url.includes('/login'),'short share respects password protection');
 r=await fetch(base+'/web/client/pubshares/1/download?compress=false');assert.equal(r.status,200,'old share-page endpoint remains compatible');
 console.log('PASS: custom short IDs, duplicate/invalid IDs, protected folder browsing, selected download, live add/edit/delete, traversal isolation and old links');
}
main().catch(e=>{console.error(e);process.exitCode=1});
