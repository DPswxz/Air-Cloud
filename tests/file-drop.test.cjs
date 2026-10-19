const {test}=require('node:test'),assert=require('node:assert/strict');
const {collectFiles,install}=require('../storage/overlay/static/air-file-drop.js');
test('collects desktop files and all directory reader batches with relative paths',async()=>{
 const a={name:'a.txt'},b={name:'b.txt'},entry=file=>({isFile:true,file:done=>done(file)});let batch=0;const directory={isDirectory:true,name:'folder',createReader:()=>({readEntries:done=>done([[entry(a)],[entry(b)],[]][batch++])})};
 const files=await collectFiles({items:[{kind:'file',webkitGetAsEntry:()=>directory}]});assert.deepEqual(files,[a,b]);assert.equal(a.fullPath,'folder/a.txt');assert.equal(b.fullPath,'folder/b.txt');assert.equal(batch,3);
 assert.deepEqual(await collectFiles({files:[a,b]}),[a,b]);
});
function fixture(options={}){const handlers={},classes=new Set();const target={dataset:{},classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)},addEventListener:(name,fn)=>handlers[name]=fn,ownerDocument:{defaultView:{addEventListener(){}}}};let uploaded=[];install(target,{upload:files=>uploaded.push(files),...options});return {handlers,classes,uploaded}}
function event(transfer={types:['Files'],files:[{name:'photo.jpg'}]}){return {dataTransfer:transfer,preventDefault(){this.prevented=true},stopPropagation(){this.stopped=true}}}
test('file-area drop starts upload directly and ignores text drags',async()=>{const f=fixture(),drag=event();f.handlers.dragenter(drag);assert.ok(f.classes.has('air-file-drop-active'));const drop=event();await f.handlers.drop(drop);assert.equal(f.uploaded.length,1);assert.equal(drop.prevented,true);assert.equal(drop.stopped,true);assert.equal(f.classes.size,0);await f.handlers.drop(event({types:['text/plain']}));assert.equal(f.uploaded.length,1)});
test('folder changes during file collection prevent uploading to a different directory',async()=>{let folder='/',error;const f=fixture({getDirectory:()=>folder,onError:e=>error=e});const entry={isFile:true,file:done=>{folder='/other';done({name:'a'})}};await f.handlers.drop(event({types:['Files'],items:[{kind:'file',webkitGetAsEntry:()=>entry}]}));assert.equal(f.uploaded.length,0);assert.ok(error)});
