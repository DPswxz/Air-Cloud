const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../storage/overlay/templates/webclient/files.html','utf8');
const script=source.slice(source.indexOf("    (()=>{\n        const table=document.getElementById('file_manager_list');"),source.indexOf('    var playerKeepAlive;')).replace(/\{\{end\}\}/g,'');
function fixture(directory='/'){
 const events={},rows=[{meta:'2_a #%.txt'},{meta:'1_folder'},{meta:'1_other'}],classes=()=>({add(){},remove(){}});
 const nodes=rows.map(()=>({classList:classes()})),table={classList:classes(),getAttribute(){return 'false'},addEventListener(k,f){events[k]=f}};
 let selected=[],moves=[];
 const api={rows(){return {every(f){nodes.forEach(node=>f.call({node:()=>node}))},data:()=>({toArray:()=>selected})}},row(node){return {data:()=>rows[nodes.indexOf(node)]}}};
 const $=()=>({DataTable:()=>api,on(){}});$.fn={dataTable:{isDataTable:()=>true}};
 vm.runInNewContext(script,{URL,location:{href:'http://nas/web/client/files',origin:'http://nas'},$,document:{getElementById:()=>table,addEventListener(k,f){events[k]=f}},window:{addEventListener(){},AirNavigation:{cache:{clear(){}}}},airCurrentDir:()=>encodeURIComponent(directory),getNameFromMeta:m=>m.slice(2),getTypeFromMeta:m=>m[0],doMove:items=>moves.push(items)});
 function event(index,back=false){return {target:{closest(selector){if(selector==='[data-kt-filemanager-table-nav-bar="base"] a')return typeof back==='string'?{href:'http://nas/web/client/files?path='+encodeURIComponent(back),classList:classes()}:null;if(selector==='button,input,[data-kt-menu]')return null;if(selector==='#air-parent-directory')return back?{getAttribute:()=>null,classList:classes()}:null;return back?null:nodes[index]}},dataTransfer:{setData(){}},preventDefault(){},stopPropagation(){}};}
 return {events,event,moves,select(indices){selected=indices.map(i=>rows[i])}};
}
test('drag files into a folder preserves reserved filename characters',()=>{const f=fixture();f.events.dragstart(f.event(0));f.events.drop(f.event(1));assert.equal(f.moves.length,1);assert.equal(f.moves[0][0].targetDir,'%2Ffolder');assert.equal(f.moves[0][0].sourceName,'a #%.txt')});
test('selected folders cannot be dropped into themselves',()=>{const f=fixture();f.select([0,1]);f.events.dragstart(f.event(0));f.events.drop(f.event(1));assert.equal(f.moves.length,0)});
test('multi-selection can move to parent and root has no parent target',()=>{const f=fixture('/nested');f.select([0,1]);f.events.dragstart(f.event(1));f.events.drop(f.event(0,true));assert.equal(f.moves[0].length,2);assert.equal(f.moves[0][0].targetDir,'%2F')});
test('external desktop drags do not trigger moves',()=>{const f=fixture();f.events.drop(f.event(1));assert.equal(f.moves.length,0)});
const moveSource=source.slice(source.indexOf('    function doMove(dragItems)'),source.indexOf('    function airSetFilesBusy'));
async function overwrite(confirmed,folder=false,same=false){
 const calls=[];let reads=0;
 const context={Array,Set,decodeURIComponent,encodeURIComponent,$:()=>({addClass(){}}),getNameFromMeta:m=>m.slice(2),getTypeFromMeta:m=>m[0],airSetFilesBusy(){},airReloadFilesContent(){calls.push('reload')},checkMoveCopyItems:x=>x,airCurrentDir:()=>'%2Fsource',clearLoading(){},KTApp:{showPageLoading(){},hidePageLoading(){}},CheckExist:{fire:async()=>({data:[{name:'item',type:folder?'1':'2'}]})},ModalAlert:{fire:async()=>({isConfirmed:confirmed})},window:{AirI18n:{t:x=>x}},axios:{get:async url=>({data:url.includes('%2Ftarget')?[{meta:'2_existing-only'}]:(reads++===0?[{meta:'2_child'}]:[])}),delete:async url=>{assert.ok(url.includes('%2Fsource'));calls.push('remove-empty-source');return {data:{message:'task'}}},post:async()=>{calls.push('move');return {data:{message:'task'}}}},taskStatusWaiter:{wait:async()=>({status:200})},location:{reload(){calls.push('reload')}}};
 vm.runInNewContext(moveSource,context);context.doMove([{targetDir:same?'%2Fsource':'%2Ftarget',sourceName:'item',targetName:'item'}]);
 await new Promise(resolve=>setImmediate(resolve));return calls;
}
test('cancelled overwrite leaves target untouched',async()=>assert.deepEqual(await overwrite(false,true),[]));
test('file overwrite uses rename and folder merge preserves destination-only items',async()=>{assert.deepEqual(await overwrite(true),['move','reload']);assert.deepEqual(await overwrite(true,true),['move','remove-empty-source','reload'])});
test('moving into same location never replaces the source',async()=>assert.deepEqual(await overwrite(true,true,true),[]));

test('breadcrumb accepts root and ancestors but ignores current and unrelated directories',()=>{for(const path of ['/','/中文 # %','/中文 # %/nested','/elsewhere']){const f=fixture('/中文 # %/nested');f.events.dragstart(f.event(0));f.events.drop(f.event(0,path));assert.equal(f.moves.length,path==='/'||path==='/中文 # %'?1:0);if(f.moves.length)assert.equal(decodeURIComponent(f.moves[0][0].targetDir),path)}});
test('move refreshes lists without a full-page loader or navigation',()=>{assert.ok(!moveSource.includes('location.reload('));assert.ok(!moveSource.includes('showPageLoading('));assert.ok(moveSource.includes('airReloadFilesContent()'))});
test('directory listeners receive fresh data after mutation clears cache',async()=>{
 const text=fs.readFileSync(__dirname+'/../storage/overlay/static/air-navigation.js','utf8');
 const code=text.slice(text.indexOf('function createCache()'),text.indexOf('\nlet cache;'));
 let rows=[{name:'before'}];const ctx={URL,location:{origin:'http://nas'},localStorage:{setItem(){},getItem(){return null}},fetch:async()=>({ok:true,status:200,json:async()=>rows}),AbortSignal,setTimeout,navigator:{}};
 vm.runInNewContext(code,ctx);const cache=ctx.createCache(),updates=[];cache.onChange((url,data)=>updates.push(data));await cache.verify('/web/client/dirs?path=%2Ftarget');cache.clear();rows=[{name:'moved'}];await cache.verify('/web/client/dirs?path=%2Ftarget');assert.equal(updates.length,2);assert.equal(updates[1][0].name,'moved');
});
test('moving B into preloaded A updates A before the move finishes',async()=>{
 let destination=[],finished=false;const owner={dataset:{airOwner:'test'}};
 const targetTable={settings:()=>[{_bInitComplete:true}],ajax:{url:()=>'/web/client/dirs?path=%2FA'},clear(){destination=[];return this},rows:{add(rows){destination=rows;return {draw(){}}}}};
 const targetJQuery=()=>({DataTable:()=>targetTable});targetJQuery.fn={dataTable:{isDataTable:()=>true}};
 const parent={document:{body:owner,querySelectorAll:()=>[{contentWindow:{document:{body:owner},jQuery:targetJQuery}}]}};
 const $=()=>({addClass(){}});
 const ctx={Array,Set,URL,encodeURIComponent,decodeURIComponent,$,location:{origin:'http://nas'},document:{body:owner},window:{parent,AirNavigation:{cache:{clear(){}}}},fetch:async()=>({ok:true,json:async()=>[{meta:'2_B'}]}),airCurrentDir:()=>'%2F',checkMoveCopyItems:x=>x,clearLoading(){},airSetFilesBusy(){},airReloadFilesContent(){assert.equal(destination[0].meta,'2_B');finished=true},KTApp:{hidePageLoading(){}},CheckExist:{fire:async()=>({data:[]})},axios:{post:async()=>({data:{message:'task'}})},taskStatusWaiter:{wait:async()=>({status:200})}};
 vm.runInNewContext(moveSource,ctx);ctx.doMove([{targetDir:'%2FA',sourceName:'B',targetName:'B'}]);await new Promise(r=>setImmediate(r));assert.ok(finished);assert.equal(destination.length,1);
});
