const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../storage/overlay/static/air-transfers.js'),'utf8');
function setup(options={}){
 const calls=[],engine={connect(){},enqueueDownloads:request=>calls.push(request)};
 const window={AirI18n:{t:s=>s},addEventListener(){},...options};
 window.parent=options.parent||window;
 const context={window,sessionStorage:{getItem:()=>null}};
 vm.runInNewContext(source,context);
 return {api:window.AirTransfers,window,engine,calls};
}
test('batch downloads route to the share engine or enabled parent engine',async()=>{
 for(const share of [true,false]){
  const f=setup();if(share)f.window.AirCloudTransfers=f.engine;else f.window.parent={AirCloudTransfers:f.engine};
  f.api.configure({share,enabled:true,owner:'user'});
  await f.api.downloadBatch('/download',['a','b'],'token');
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].owner,'user');assert.equal(f.calls[0].csrf,'token');
 }
});
test('share downloads fall back to the parent when their local engine is unavailable',async()=>{
 const f=setup();f.window.parent={AirCloudTransfers:f.engine};f.api.configure({share:true,enabled:true});
 await f.api.downloadBatch('/download',['a','b'],'token');assert.equal(f.calls.length,1);
});
