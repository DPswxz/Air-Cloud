const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../storage/overlay/static/air-background.js'),'utf8'),context={window:{AirI18n:{t:s=>s}}};vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function downloadETA('),source.indexOf('function appendTransferFile(')),context);
test('download ETA handles unknown size, stalled speed and disk finalization',()=>{
 const eta=context.downloadETA;
 assert.equal(eta({status:'downloading',total:100,bytes:0},0),'计算中…');assert.equal(eta({status:'downloading',total:0,bytes:10},10),'计算中…');
 assert.equal(eta({status:'downloading',total:100,bytes:100},10),'确认保存中');assert.equal(eta({status:'done',total:100,bytes:100},10),'');
 assert.equal(eta({status:'downloading',total:700,bytes:50},10),'预计剩余 1 分 5 秒');
 assert.equal(eta({status:'downloading',total:36610,bytes:0},10),'预计剩余 1 小时 1 分 1 秒');
});
test('ETA holds its display between updates and smooths short speed spikes',()=>{
 const task={status:'downloading',total:10000,bytes:0},eta=context.downloadETA;
 const initial=eta(task,100,1000);task.bytes=1000;
 assert.equal(eta(task,10000,1500),initial,'A sub-second spike must not replace the displayed estimate');
 task.bytes=1100;eta(task,400,2000);assert.equal(task.etaEstimate.displayAt,2000,'ETA refreshes after one second');task.bytes=1200;eta(task,400,4000);assert.ok(task.etaEstimate.seconds>=80&&task.etaEstimate.seconds<=120);
 const held=eta(task,1,5000);assert.equal(held,eta(task,10000,5500),'Rate swings between display updates are ignored');
 assert.equal(eta(task,0,14000),'计算中…','A stalled transfer must not show a misleading finite estimate');
});
