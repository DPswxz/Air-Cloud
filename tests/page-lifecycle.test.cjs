const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../storage/overlay/static/air-page-preload.js'),'utf8');
function fixture(url,owner){
 const removed=[],classes=[],destinations=[];
 const active={contentWindow:{location:{href:url}},contentDocument:{body:{dataset:{airOwner:owner}},documentElement:{classList:{remove:v=>classes.push(v)}}},style:{}};
 const context={URL,active,location:{origin:'https://nas.example',replace:v=>destinations.push(v)},generation:0,navigationTimer:null,pendingNavigation:{},queue:['pending'],records:new Map([['old',{frame:{remove:()=>removed.push('old')}}],['active',{frame:active}]]),sidebarShade:{hidden:false},clearTimeout(){},hideNavigation(){},key(value){const u=new URL(value);return /^\/web\/client\/(files|shares|profile)$/.test(u.pathname)?u.pathname:null}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('let leavingShell='),source.indexOf('function syncPageTitle(){')),context);
 return {context,active,removed,classes,destinations};
}
test('logout discards cached sidebar and promotes login to the full window',()=>{const f=fixture('https://nas.example/web/client/login?air_frame=1','');assert.equal(f.context.ensureClientView(f.active),false);assert.deepEqual(f.destinations,['https://nas.example/web/client/login']);assert.deepEqual(f.removed,['old']);assert.equal(f.context.records.size,0);assert.equal(f.context.sidebarShade.hidden,true);assert.equal(f.active.style.clipPath,'none')});
test('admin navigation exits file clipping and strips internal frame flags',()=>{const f=fixture('https://nas.example/web/admin/users?air_frame=1&air_raw=1','admin');assert.equal(f.context.ensureClientView(f.active),false);assert.deepEqual(f.destinations,['https://nas.example/web/admin/users']);assert.deepEqual(f.classes,['air-content-only'])});
test('authenticated client pages and background loads do not leave the shell',()=>{const f=fixture('https://nas.example/web/client/shares?air_frame=1','user');assert.equal(f.context.ensureClientView(f.active),true);assert.equal(f.context.ensureClientView({}),true);assert.equal(f.context.records.size,2);assert.deepEqual(f.destinations,[])});
