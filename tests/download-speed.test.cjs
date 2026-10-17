const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../storage/overlay/static/air-background.js'),'utf8'),context={};vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function transferRate('),source.indexOf('function render(')),context);
test('short disk checkpoints hold the recent network rate and real stalls eventually show zero',()=>{
 const task={bytes:0,networkBytes:0};const rate=context.transferRate;rate(task,0);task.networkBytes=1024;const moving=rate(task,1000);assert.equal(moving,1024);
 task.writing=true;assert.equal(rate(task,2000),moving);assert.equal(rate(task,5000),moving);
 task.writing=false;assert.ok(rate(task,6000)>0);task.networkBytes=2048;assert.ok(rate(task,7000)>0);assert.equal(rate(task,18000),0);
});
test('network progress is independent of committed-byte rollback during a retry',()=>{
 const task={bytes:0,networkBytes:0};const rate=context.transferRate;rate(task,0);task.bytes=2048;task.networkBytes=2048;rate(task,1000);task.bytes=0;assert.ok(rate(task,1500)>0);task.networkBytes=3072;assert.ok(rate(task,2000)>0);
});
test('displayed speed stays stable through a disk save even with overlapping network reads',()=>{
 const task={bytes:0,networkBytes:0},rate=context.transferRate;rate(task,0);task.networkBytes=2048;const stable=rate(task,1000);
 task.writing=true;task.networkBytes=2304;assert.equal(rate(task,3000),stable);task.networkBytes=2400;assert.equal(rate(task,7000),stable);
 task.writing=false;assert.equal(rate(task,8000),stable);assert.equal(rate(task,9000),stable);
 task.networkBytes=4448;assert.ok(rate(task,10000)>0);assert.equal(rate(task,21000),0);
});
