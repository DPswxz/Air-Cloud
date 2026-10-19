const {test}=require('node:test'),assert=require('node:assert/strict');
const {createCache}=require('../storage/overlay/static/air-share-navigation.js');
const row=name=>({name,type:'1',size:'',last_modified:1});
test('share directory reads deduplicate, use preloaded data, and revalidate stale entries',async()=>{
 let time=0,calls=0,resolve,updates=[];const cache=createCache({now:()=>time,load:()=>{calls++;return new Promise(r=>{resolve=r})},onUpdate:(path,rows)=>updates.push([path,rows])});
 const a=cache.read('/照片'),b=cache.read('/照片');assert.equal(calls,1);resolve([row('one')]);assert.deepEqual(await a,await b);await cache.read('/照片');assert.equal(calls,1);
 time=4000;assert.deepEqual(await cache.read('/照片'),[row('one')]);assert.equal(calls,2);resolve([row('two')]);await new Promise(r=>setImmediate(r));assert.deepEqual(updates,[['/照片',[row('two')]]]);assert.deepEqual(await cache.read('/照片'),[row('two')]);
});
test('share cache stays isolated and bounded; clearing rejects late cache writes',async()=>{
 let resolve;const first=createCache({load:()=>new Promise(r=>{resolve=r})}),other=createCache({load:async()=>[row('other')],limit:2});
 const pending=first.read('/');first.clear();resolve([row('old')]);await pending;assert.equal(first.stats().directories,0);assert.deepEqual(await other.read('/'),[row('other')]);for(const path of ['/a','/b','/c'])await other.read(path);assert.equal(other.stats().directories,2);
});
test('revoked shares discard cached directories instead of serving them indefinitely',async()=>{
 let revoked=false,time=0,failures=[];const cache=createCache({now:()=>time,load:async()=>{if(revoked)throw Object.assign(Error('revoked'),{status:403});return [row('private')]},onFailure:(path,error)=>failures.push(error.status)});
 await cache.read('/');revoked=true;time=31000;await assert.rejects(cache.read('/'),{status:403});assert.equal(cache.stats().directories,0);assert.deepEqual(failures,[403]);
});
test('directory prefetch allows only two concurrent requests',async()=>{
 const waiting=[],cache=createCache({load:path=>new Promise(resolve=>waiting.push({path,resolve}))});cache.prefetch('/a');cache.prefetch('/b');cache.prefetch('/c');cache.prefetch('/a');assert.equal(waiting.length,2);assert.equal(cache.stats().queued,1);waiting[0].resolve([]);await new Promise(r=>setImmediate(r));assert.equal(waiting.length,3);waiting[1].resolve([]);waiting[2].resolve([]);
});
