const {test}=require('node:test'),assert=require('node:assert/strict');
const {create,CHUNK}=require('../storage/overlay/static/air-download-resume.js');
test('a browser-rejected filename identifies the destination and retains its checkpoint',async()=>{
 const records=new Map(),repo={put:async r=>records.set(r.key,r),remove:async k=>records.delete(k)},engine=create({repo});
 const task={owner:'a',name:'blocked.file',relative:'folder/blocked.file',committed:42,bytes:50};
 await engine.prepare(task);
 await assert.rejects(engine.run(task,{directoryAt:async()=>({getFileHandle:async()=>{throw TypeError("Failed to execute 'getFileHandle': Name is not allowed.")}}),signal:new AbortController().signal}),/folder\/blocked.file/);
 assert.equal(task.bytes,42);assert.equal(records.size,1);
});
function fixture(payload,{fail=false,tag='"source-1"'}={}){
 const records=new Map(),requests=[];let disk=Buffer.alloc(0),modified=1,stall=false,shortOnce=false,statusOnce=0,overlapped=false;
 const handle={async getFile(){return {size:disk.length,lastModified:modified,slice(start,end){return new Blob([disk.subarray(start,end)])}}},async createWritable({keepExistingData=false}={}){if(!disk.length&&requests.includes(CHUNK))overlapped=true;let pending=keepExistingData?Buffer.from(disk):Buffer.alloc(0),position=0;return {async seek(n){position=n},async write(data){const next=Buffer.alloc(Math.max(pending.length,position+data.length));pending.copy(next);Buffer.from(data).copy(next,position);pending=next;position+=data.length},async truncate(size){pending=pending.subarray(0,size)},async close(){disk=pending;modified++},async abort(){}}}};
 const sink={async getFileHandle(){return handle}},repo={async put(value){records.set(value.key,{...value,checks:(value.checks||[]).map(c=>({...c}))})},async remove(key){records.delete(key)},async list(){return [...records.values()]}};
 const engine=create({repo,verificationTimeout:20,async fetchFile(url,options){assert.equal(options.cache,'no-store');const forcedStatus=statusOnce;statusOnce=0;if(stall)return new Promise(()=>{});const offset=options.headers.Range?Number(options.headers.Range.match(/\d+/)[0]):0,end=options.headers.Range?.split('-')[1]?Math.min(payload.length,Number(options.headers.Range.split('-')[1])+1):payload.length;requests.push(offset);let cursor=offset;const headers=new Map([['content-disposition','attachment'],['content-length',String(end-offset)],['etag',tag]]);if(options.headers.Range&&payload.length)headers.set('content-range',`bytes ${offset}-${end-1}/${payload.length}`);return {ok:true,status:forcedStatus||(options.headers.Range?(payload.length?206:416):200),headers,body:{async cancel(){},getReader(){return {async read(){if(shortOnce&&offset>=CHUNK){shortOnce=false;return {done:true}}if(fail&&offset>=CHUNK)throw Error('network lost');if(cursor===end)return {done:true};const value=payload.subarray(cursor,Math.min(end,cursor+CHUNK));cursor+=value.length;return {done:false,value}},async cancel(){}}}}}}});
 const task={owner:'a',name:'file.bin',relative:'file.bin',url:'https://nas.test/file',total:payload.length,bytes:0,sink,created:1};
 const run=(task,render=()=>{})=>engine.run(task,{directoryAt:async()=>sink,signal:new AbortController().signal,render});
 return {task,engine,run,records,requests,get overlap(){return overlapped},get disk(){return disk},setStatusOnce(value){statusOnce=value},setShortOnce(value){shortOnce=value},setStall(value){stall=value},setFail(value){fail=value},setTag(value){tag=value},changeLocal(){modified++;disk[0]^=255},touch(){modified++},addTail(){disk=Buffer.concat([disk,Buffer.alloc(123)]);modified++}};
}
test('network interruption persists committed bytes and a restored task requests only the remainder',async()=>{
 const payload=Buffer.alloc(CHUNK+321,67),f=fixture(payload,{fail:true});await f.engine.prepare(f.task);await assert.rejects(f.run(f.task),/network lost/);
 assert.equal(f.disk.length,CHUNK);assert.equal(f.task.bytes,CHUNK);
 const saved=(await f.engine.list('a'))[0];assert.equal(saved.offset,CHUNK);assert.equal((await f.engine.list('b')).length,0);
 const restored={...saved,resumeKey:saved.key,committed:saved.offset};f.setFail(false);await f.run(restored);
 assert.equal(f.requests.at(-1),CHUNK);assert.deepEqual(f.disk,payload);assert.equal(f.records.size,0);
});
test('changed source or local file cannot be appended to an existing download',async()=>{
 for(const change of ['source','local']){const f=fixture(Buffer.alloc(CHUNK+10,5),{fail:true});await f.engine.prepare(f.task);await assert.rejects(f.run(f.task));f.setFail(false);if(change==='source')f.setTag('"changed"');else f.changeLocal();const before=Buffer.from(f.disk);await assert.rejects(f.run(f.task),change==='source'?/源文件已变化/:/本地文件已变化/);assert.deepEqual(f.disk,before);assert.equal(f.records.size,1)}
});
test('empty downloads commit an empty file and remove their recovery record',async()=>{
 const f=fixture(Buffer.alloc(0));await f.engine.prepare(f.task);await f.run(f.task);assert.equal(f.disk.length,0);assert.equal(f.records.size,0);
});
test('the next range starts before the current disk checkpoint without changing file contents',async()=>{
 const payload=Buffer.alloc(CHUNK+321,31),f=fixture(payload);await f.engine.prepare(f.task);await f.run(f.task);assert.equal(f.overlap,true);assert.deepEqual(f.disk,payload);
});
test('a prematurely ended range retries from its committed start without corrupting the file',async()=>{
 const payload=Buffer.alloc(CHUNK*2+321,75),f=fixture(payload);f.setShortOnce(true);await f.engine.prepare(f.task);await f.run(f.task);assert.deepEqual(f.disk,payload);assert.equal(f.requests.filter(start=>start===CHUNK).length,2);assert.equal(f.records.size,0);
});
test('unexpected full responses retry, while expired sessions preserve the task for login',async()=>{
 const payload=Buffer.alloc(321,51),f=fixture(payload);await f.engine.prepare(f.task);f.setStatusOnce(200);await f.run(f.task);assert.deepEqual(f.disk,payload);assert.equal(f.requests.length,2);
 const expired=fixture(payload);await expired.engine.prepare(expired.task);expired.setStatusOnce(403);await assert.rejects(expired.run(expired.task),/登录状态已失效/);assert.equal(expired.records.size,1);await expired.run(expired.task);assert.deepEqual(expired.disk,payload);
});
test('timestamp drift and an unrecorded tail after closing do not invalidate committed content',async()=>{
 for(const change of ['touch','addTail']){const payload=Buffer.alloc(CHUNK+321,41),f=fixture(payload,{fail:true});await f.engine.prepare(f.task);await assert.rejects(f.run(f.task));const saved=(await f.engine.list('a'))[0];f[change]();f.setFail(false);await f.run({...saved,resumeKey:saved.key,committed:saved.offset});assert.deepEqual(f.disk,payload)}
});
test('legacy checkpoints are verified against the source and upgraded without restarting',async()=>{
 const payload=Buffer.alloc(CHUNK+321,21),f=fixture(payload,{fail:true});await f.engine.prepare(f.task);await assert.rejects(f.run(f.task));const saved=(await f.engine.list('a'))[0];delete saved.checks;f.touch();f.setFail(false);await f.run({...saved,resumeKey:saved.key,committed:saved.offset});assert.deepEqual(f.disk,payload);assert.ok(f.requests.filter(n=>n===0).length>=2);assert.equal(f.requests.at(-1),CHUNK);
});
test('verification reports progress and a stalled legacy check times out without losing its checkpoint',async()=>{
 const f=fixture(Buffer.alloc(CHUNK+321,14),{fail:true});await f.engine.prepare(f.task);await assert.rejects(f.run(f.task));const saved=(await f.engine.list('a'))[0];delete saved.checks;f.setFail(false);f.setStall(true);
 await assert.rejects(f.run({...saved,resumeKey:saved.key,committed:saved.offset}),/校验长时间无响应/);assert.equal((await f.engine.list('a'))[0].offset,CHUNK);
 f.setStall(false);const progress=[];await f.run({...saved,resumeKey:saved.key,committed:saved.offset},()=>{if(saved.sink)progress.push(true)});assert.ok(progress.length>2);assert.equal(f.records.size,0);
});
