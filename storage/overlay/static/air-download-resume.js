(function(root){
'use strict';
const CHUNK=8*1024*1024;
function store(mode,operation){return new Promise((resolve,reject)=>{const request=indexedDB.open('air-cloud-download-resume',1);request.onupgradeneeded=()=>request.result.createObjectStore('tasks',{keyPath:'key'});request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('tasks',mode),op=operation(tx.objectStore('tasks'));let value;op.onsuccess=()=>value=op.result;tx.oncomplete=()=>{db.close();resolve(value)};tx.onerror=()=>{db.close();reject(tx.error)};tx.onabort=()=>{db.close();reject(tx.error||Error('Storage transaction aborted'))}}})}
const repository={put:record=>store('readwrite',s=>s.put(record)),remove:key=>store('readwrite',s=>s.delete(key)),list:()=>store('readonly',s=>s.getAll())};
function create({repo=repository,fetchFile=(...args)=>fetch(...args),translate=s=>s,verificationTimeout=30000}={}){
 const error=message=>Error(translate(message));
 const digest=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),v=>v.toString(16).padStart(2,'0')).join('');
 async function save(task){const record={key:task.resumeKey,owner:task.owner,destinationKey:task.destinationKey,name:task.name,relative:task.relative,url:task.url,total:task.total,offset:task.committed||0,sink:task.sink,publicShare:!!task.publicShare,created:task.created,validator:task.validator||'',localSize:task.localSize,localModified:task.localModified,checks:task.checks||[]};await repo.put(record)}
 async function prepare(task){if(!task.resumeKey)task.resumeKey=crypto.randomUUID();await save(task)}
 async function run(task,{directoryAt,render=()=>{},signal:callerSignal}){
  const transferController=new AbortController(),abortTransfer=()=>transferController.abort();callerSignal.addEventListener('abort',abortTransfer,{once:true});if(callerSignal.aborted)abortTransfer();const signal=transferController.signal;
  try{
  const parts=task.relative.split('/'),leaf=parts.pop();if(!leaf||leaf==='.'||leaf==='..'||leaf.includes('\\'))throw error('文件路径无效');
  const handle=await (await directoryAt(task.sink,parts)).getFileHandle(leaf,{create:!task.committed});
  const file=await handle.getFile();
  if(task.committed&&file.size<task.committed)throw error('本地文件已变化，请重新下载。');
  let offset=task.committed||0;task.bytes=offset;task.networkBytes=0;task.rateState=null;task.verifying=offset>0;render();
  const url=new URL(task.url);url.searchParams.set('air_raw','1');
  // Verify committed content rather than timestamps. A close can finish before
  // IndexedDB records its checkpoint; an unrecorded tail is safely overwritten.
  task.verificationProgress={bytes:0,total:offset,status:'downloading',started:Date.now()};
  const progress=bytes=>{task.verificationProgress.bytes=bytes;render()};
  let checked=0;for(const check of task.checks||[]){if(check.start!==checked||check.length<=0||checked+check.length>offset)throw error('本地文件已变化，请重新下载。');if(signal.aborted)throw new DOMException('Aborted','AbortError');if(await digest(await file.slice(check.start,check.start+check.length).arrayBuffer())!==check.hash)throw error('本地文件已变化，请重新下载。');checked+=check.length;progress(checked)}
  while(checked<offset){const bytes=await rangeBlock(checked,Math.min(offset-1,checked+CHUNK-1)),hash=await digest(bytes);if(!bytes.length)throw error('源文件已变化或不支持续传，请重新下载。');if(await digest(await file.slice(checked,checked+bytes.length).arrayBuffer())!==hash)throw error('本地文件已变化，请重新下载。');(task.checks||= []).push({start:checked,length:bytes.length,hash});checked+=bytes.length;await save(task);progress(checked)}
  task.verifying=false;task.etaEstimate=null;task.rateSamples=[];task.rateState=null;task.currentRate=0;render();

  async function commit(data){task.writing=true;render();try{if(signal.aborted)throw new DOMException('Aborted','AbortError');const hash=await digest(data);let writer;try{writer=await handle.createWritable({keepExistingData:offset>0});await writer.seek(offset);await writer.write(data);await writer.truncate(offset+data.length);await writer.close();writer=null}catch(e){if(writer)try{await writer.abort()}catch{}throw e}(task.checks||= []).push({start:offset,length:data.length,hash});offset+=data.length;const local=await handle.getFile();task.committed=offset;task.localSize=local.size;task.localModified=local.lastModified;await save(task);task.bytes=Math.max(task.bytes||0,offset);render()}finally{task.writing=false;render()}}
  async function rangeBlock(start,end){
   for(let attempt=0;attempt<3;attempt++){
    if(signal.aborted)throw new DOMException('Aborted','AbortError');
    const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});let reader,timer;
    const wait=async operation=>{try{return await Promise.race([operation,new Promise((resolve,reject)=>{timer=setTimeout(()=>{reject(error(task.verifying?'校验长时间无响应，请点击继续重试。':'下载连接中断，已保存进度，可继续。'));controller.abort()},task.verifying?verificationTimeout:30000)})])}finally{clearTimeout(timer)}};
    try{
     const response=await wait(fetchFile(url,{signal:controller.signal,cache:'no-store',headers:{Range:'bytes='+start+'-'+end}}));
     if(response.status===416&&start===0&&(!task.total||task.total===0)){
      await response.body?.cancel();const empty=await wait(fetchFile(url,{signal:controller.signal,cache:'no-store',headers:{}}));
      if(empty.ok&&empty.headers.get('content-length')==='0'&&empty.headers.get('content-disposition')?.includes('attachment')){await empty.body?.cancel();task.total=0;return new Uint8Array(0)}throw Object.assign(error('源文件已变化或不支持续传，请重新下载。'),{permanent:true})
     }
     const match=response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/),validator=response.headers.get('etag')||'';
     if(response.status===401||response.status===403||response.redirected&&response.headers.get('content-type')?.includes('text/html'))throw Object.assign(error('登录状态已失效，请重新登录后继续。'),{permanent:true});
     if(response.status!==206)throw error('服务器未返回分段数据，进度已保留，请继续。');
     if(!response.headers.get('content-disposition')?.includes('attachment')||!match||Number(match[1])!==start||Number(match[2])!==Math.min(end,Number(match[3])-1)||(task.validator&&!validator))throw error('分段响应异常，进度已保留，请继续。');
     if((task.validator&&validator!==task.validator)||(offset>0&&Number(match[3])!==task.total))throw Object.assign(error('源文件已变化，请重新下载。'),{permanent:true});
     task.total=Number(match[3]);task.validator=validator;await save(task);
     const length=Number(match[2])-start+1;if(length<0||length>CHUNK)throw Object.assign(error('服务器未提供分段数据'),{permanent:true});
     const bytes=new Uint8Array(length);let received=0;reader=response.body.getReader();
     for(;;){const next=await wait(reader.read());if(next.done)break;if(received+next.value.length>length)throw Object.assign(error('服务器未提供分段数据'),{permanent:true});bytes.set(next.value,received);received+=next.value.length;if(!task.verifying)task.networkBytes=(task.networkBytes||0)+next.value.length;if(task.verifying)progress(start+received);else{task.bytes=Math.max(task.bytes||0,start+received);render()}}
     if(received!==length)throw error('下载连接中断，已保存进度，可继续。');return bytes;
    }catch(e){task.bytes=offset;render();if(signal.aborted)throw new DOMException('Aborted','AbortError');if(e.permanent||attempt===2)throw e;await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)))}
    finally{clearTimeout(timer);signal.removeEventListener('abort',abort);controller.abort();if(reader)try{await reader.cancel()}catch{}}
   }
  }
  try{
   if(offset>0&&offset===task.total){await rangeBlock(0,0);await repo.remove(task.resumeKey);task.bytes=task.total;return}
   let pending=rangeBlock(offset,offset+CHUNK-1);pending.catch(()=>{});
   do{const bytes=await pending;if(!bytes.length){const writer=await handle.createWritable();await writer.close();break}const next=offset+bytes.length;pending=next<task.total?rangeBlock(next,next+CHUNK-1):null;pending?.catch(()=>{});await commit(bytes)}while(offset<task.total);
   if(offset!==task.total)throw error('下载连接中断，已保存进度，可继续。');await repo.remove(task.resumeKey);task.bytes=task.total;
  }catch(e){task.bytes=task.committed||0;if(task.removed&&!task.preserveResume)await repo.remove(task.resumeKey);throw e}

  }catch(e){task.bytes=task.committed||0;if(/Name is not allowed|not a valid name|invalid.*name/i.test(e.message||''))throw Error(translate('浏览器不允许保存此名称，请检查文件或文件夹名称：')+task.relative);throw e}finally{callerSignal.removeEventListener('abort',abortTransfer);transferController.abort()}
 }
 return {prepare,save,run,remove:task=>repo.remove(task.resumeKey),async list(owner){return (await repo.list()).filter(record=>record.owner===owner)}};
}
if(typeof module!=='undefined'&&module.exports)module.exports={create,CHUNK};else root.AirDownloadResume={create};
})(typeof window==='undefined'?globalThis:window);
