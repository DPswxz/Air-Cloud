const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync(__dirname+'/../storage/overlay/templates/webclient/files.html','utf8');
async function prepare(saved,files,existing=[],pending=[]){
 const control={},stored=[],calls=[],errors=[];
 const context={location:{origin:'http://localhost'},document:{getElementById:()=>control},localStorage:{getItem:()=>saved,setItem:(...v)=>stored.push(v)},airCurrentDir:()=>'%2F',window:{parent:{AirCloudTransfers:{uploadTargets:()=>pending}},AirI18n:{t:s=>s}},URL,CheckExist:{fire:async({files})=>({data:existing.includes(files[0])?{one:{name:files[0]}}:{}})},ModalAlert:{fire:e=>errors.push(e)}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('    const airOverwriteControl='),source.indexOf('    function startUploadFiles('))+'function startUploadFiles(files,keepBoth){calls.push({files,keepBoth})}',Object.assign(context,{calls}));
 context.uploadFiles(files);await vm.runInContext('airUploadPreparation',context);return {control,stored,calls,errors};
}
test('overwrite defaults on and browser choice persists',async()=>{const f=await prepare(null,[{name:'a.txt'}]);assert.equal(f.control.checked,true);assert.equal(f.calls[0].keepBoth,false);f.control.checked=false;f.control.onchange();assert.equal(f.stored[0][1],'false')});
test('keep both skips existing suffixes and queued names, retaining folder layout',async()=>{const files=[{name:'a.txt'},{name:'nested.txt',fullPath:'folder/sub/nested.txt'},{name:'other.txt',fullPath:'folder/other.txt'}];const f=await prepare('false',files,['a.txt','a (1).txt','folder'],['http://localhost/web/client/file?path=/a (2).txt']);assert.equal(f.errors.length,0);assert.equal(files[0].fullPath,'a (3).txt');assert.equal(files[1].fullPath,'folder (1)/sub/nested.txt');assert.equal(files[2].fullPath,'folder (1)/other.txt');assert.equal(f.calls[0].keepBoth,true)});
