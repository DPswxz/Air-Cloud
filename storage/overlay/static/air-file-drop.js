(()=>{'use strict';
async function collectFiles(transfer){
 const files=[];
 async function walk(entry,prefix=''){if(entry.isFile){const file=await new Promise((resolve,reject)=>entry.file(resolve,reject));if(prefix)file.fullPath=prefix+file.name;files.push(file)}else if(entry.isDirectory){const reader=entry.createReader();for(;;){const batch=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));if(!batch.length)break;for(const child of batch)await walk(child,prefix+entry.name+'/')}}}
 const items=Array.from(transfer.items||[]).filter(item=>item.kind==='file');
 // Capture browser entries before leaving the synchronous drop event.
 const sources=items.map(item=>({entry:item.webkitGetAsEntry?.(),file:item.getAsFile?.()}));
 if(sources.length){for(const source of sources){if(source.entry)await walk(source.entry);else if(source.file)files.push(source.file)}}else files.push(...Array.from(transfer.files||[]));
 return files;
}
function install(target,{upload,getDirectory=()=>'',onError=()=>{},translate=value=>value}){if(!target||target.dataset.airFileDrop)return;target.dataset.airFileDrop='true';let depth=0,busy=false;
 const isFiles=event=>Array.from(event.dataTransfer?.types||[]).includes('Files');
 function reset(){depth=0;target.classList.remove('air-file-drop-active')}
 function enter(event){if(!isFiles(event))return;event.preventDefault();event.stopPropagation();depth++;target.dataset.dropLabel=translate('松开即可上传到当前文件夹');target.classList.add('air-file-drop-active')}
 target.addEventListener('dragenter',enter,true);
 target.addEventListener('dragover',event=>{if(!isFiles(event))return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy'},true);
 target.addEventListener('dragleave',event=>{if(!depth)return;event.stopPropagation();if(--depth<=0)reset()},true);
 target.addEventListener('drop',async event=>{if(!isFiles(event))return;event.preventDefault();event.stopPropagation();reset();if(busy)return;busy=true;const directory=getDirectory();try{const files=await collectFiles(event.dataTransfer);if(directory!==getDirectory())throw Error(translate('目录已变化，请重新拖入文件。'));if(files.length)await upload(files)}catch(error){onError(error)}finally{busy=false}},true);
 target.ownerDocument.defaultView.addEventListener('blur',reset);
}
const api={collectFiles,install};if(typeof module!=='undefined')module.exports=api;else window.AirFileDrop=api;
})();
