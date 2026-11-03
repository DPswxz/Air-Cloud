const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const text=fs.readFileSync(__dirname+'/../storage/overlay/static/air-page-preload.js','utf8');
const code=text.slice(text.indexOf('async function checkActiveData()'),text.indexOf('\nsetInterval(checkActiveData'));
test('activating a cached inner folder replaces stale rows with verified data',async()=>{
 let displayed=[{name:'old'}],resolve;const table={settings:()=>[{_bInitComplete:true}],ajax:{url:()=>'/web/client/dirs?path=%2Finner'},page:Object.assign(()=>0,{info:()=>({pages:1})}),clear(){displayed=[];return this},rows:{add(rows){displayed=rows;return {draw(){}}}}};
 const $=()=>({DataTable:()=>table});$.fn={dataTable:{isDataTable:()=>true}};
 const frame={contentWindow:{document:{querySelector:()=>null},location:{href:'http://nas/web/client/files?path=%2Finner'},jQuery:$}};
 const ctx={URL,Array,active:frame,leavingShell:false,pendingNavigation:null,document:{hidden:false},window:{AirNavigation:{cache:{verify:()=>new Promise(r=>resolve=r)}}}};
 vm.runInNewContext(code,ctx);const pending=ctx.checkActiveData();resolve([{name:'moved-file'}]);await pending;assert.equal(displayed[0].name,'moved-file');
 const late=ctx.checkActiveData();ctx.active={};resolve([{name:'late'}]);await late;assert.equal(displayed[0].name,'moved-file');
});
test('cache notification cannot duplicate an initializing or pending Ajax list',()=>{
 const source=fs.readFileSync(__dirname+'/../storage/overlay/static/air-navigation.js','utf8');
 const start=source.indexOf('cache.onChange((url,data)=>'),end=source.indexOf('\ndocument.addEventListener',start);
 const snippet=source.slice(start,end).trim().slice(0,-1);
 let rows=[],listener;const state={_bInitComplete:false};
 const table={settings:()=>[state],ajax:{url:()=>'/list'},page:Object.assign(()=>0,{info:()=>({pages:1})}),clear(){rows=[];return this},rows:{add(data){rows.push(...data);return {draw(){}}}}};
 const $=()=>({hasClass:()=>false,DataTable:()=>table});$.fn={dataTable:{isDataTable:()=>true}};
 vm.runInNewContext(snippet,{$,cache:{key:x=>x,onChange(fn){listener=fn}}});
 listener('/list',[{name:'A'},{name:'B'}]);rows.push({name:'A'},{name:'B'});assert.equal(rows.length,2);
 state._bInitComplete=true;state.jqXHR={readyState:1};listener('/list',[{name:'C'}]);assert.equal(rows.length,2);
 state.jqXHR.readyState=4;listener('/list',[{name:'C'}]);assert.equal(rows.length,1);assert.equal(rows[0].name,'C');
});
