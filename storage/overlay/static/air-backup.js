(()=>{
const root=document.getElementById('air-backup');
if(!root)return;
// Keep mobile field labels aligned with the translated table headings.
function labelMobileCells(){
 for(const table of root.querySelectorAll('table')){
  const headings=[...table.querySelectorAll('thead th')].map(th=>th.textContent.trim());
  for(const row of table.querySelectorAll('tbody tr'))for(const [index,cell] of [...row.cells].entries()){
   const label=cell.colSpan>1?'':headings[index]||'';
   if(cell.dataset.label!==label)cell.dataset.label=label;
  }
 }
}
new MutationObserver(labelMobileCells).observe(root,{subtree:true,childList:true,characterData:true});
window.addEventListener('air:languagechange',labelMobileCells);
const base=root.dataset.url,csrf=root.dataset.csrf;
const $=id=>document.getElementById(id);
const i18n=window.AirI18n;
const tr=(text,values)=>i18n?(values?i18n.format(text,values):i18n.t(text)):text.replace(/\{(\w+)\}/g,(_,n)=>String(values?.[n]??''));
function setText(el,text,values){
 if(i18n)i18n.bindText(el,text,values||{});else el.textContent=tr(text,values);
 return el;
}
function setMessage(el,message){
 if(i18n)i18n.bindMessage(el,message);else el.textContent=message;
 return el;
}
function user(el,name){el.textContent=name;el.setAttribute('data-air-i18n-skip','');return el}
function el(tag,className,text,values){
 const node=document.createElement(tag);
 if(className)node.className=className;
 if(text!==undefined)setText(node,text,values);
 return node;
}
function size(bytes){
 const units=['B','KB','MB','GB','TB'];let value=Number(bytes)||0,unit=0;
 while(value>=1024&&unit<units.length-1){value/=1024;unit++}
 return (unit===0||value>=100?Math.round(value):value.toFixed(1))+' '+units[unit];
}
function when(ms){return ms?new Date(ms).toLocaleString():''}
async function request(path,options={}){
 const response=await fetch(base+path,{credentials:'same-origin',cache:'no-store',...options,headers:{...(options.headers||{}),'X-CSRF-TOKEN':csrf}});
 let data={};
 try{data=await response.json()}catch{}
 if(!response.ok)throw Error(data.error||('HTTP '+response.status));
 return data;
}
const post=(path,body)=>request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const state={users:[],backups:[],job:{state:'idle'},restoreName:'',poll:0,lastJob:''};

function showError(node,message){
 node.hidden=!message;
 if(message)setMessage(node,message);
}

/* ---------- creating a backup ---------- */
function usersTable(tbody,users,columns){
 tbody.replaceChildren();
 for(const item of users){
  const row=document.createElement('tr');row.dataset.name=item.username;
  const name=el('td');name.append(user(el('strong'),item.username));
  if(item.email){const mail=el('div','text-muted fs-8');user(mail,item.email);name.append(mail)}
  row.append(name);
  for(const cell of columns(item))row.append(cell);
  tbody.append(row);
 }
}
function checkboxCell(name,checked,disabled,label){
 const cell=el('td','text-center');
 const input=document.createElement('input');
 input.type='checkbox';input.className='form-check-input';input.checked=checked;input.disabled=disabled;input.dataset.kind=name;
 input.setAttribute('aria-label',tr(label));
 cell.append(input);
 return cell;
}
function renderUsers(){
 usersTable($('backup-users'),state.users,item=>{
  const status=el('td');status.append(el('span',item.status===1?'badge badge-light-success':'badge badge-light-danger',item.status===1?'已启用':'已禁用'));
  const used=el('td');used.textContent=size(item.usedBytes);
  const files=checkboxCell('files',false,!item.local,'备份用户文件');
  if(!item.local){files.title=tr('非本地存储，无法备份文件')}
  return [status,used,checkboxCell('info',false,false,'备份用户信息'),files];
 });
 updateSelection();
}
function checkedNames(tbody,kind){
 return [...tbody.querySelectorAll('input[data-kind="'+kind+'"]:checked')].map(input=>input.closest('tr').dataset.name);
}
function visibleBoxes(tbody,kind){
 return [...tbody.querySelectorAll('tr')].filter(row=>!row.hidden).map(row=>row.querySelector('input[data-kind="'+kind+'"]')).filter(input=>input&&!input.disabled);
}
function updateSelection(){
 const info=checkedNames($('backup-users'),'info'),files=checkedNames($('backup-users'),'files');
 const bytes=state.users.filter(item=>files.includes(item.username)).reduce((sum,item)=>sum+item.usedBytes,0);
 setText($('backup-selection'),'已选 {info} 位用户信息，{files} 位用户文件（约 {size}）',{info:info.length,files:files.length,size:size(bytes)});
 $('backup-all-info').checked=info.length>0&&visibleBoxes($('backup-users'),'info').every(input=>input.checked);
 $('backup-all-files').checked=files.length>0&&visibleBoxes($('backup-users'),'files').every(input=>input.checked);
 $('backup-start').disabled=running()||(!$('backup-settings').checked&&!info.length&&!files.length);
}
function toggleAll(tbody,kind,checked){
 for(const input of visibleBoxes(tbody,kind))input.checked=checked;
}
$('backup-all-info').addEventListener('change',event=>{toggleAll($('backup-users'),'info',event.target.checked);updateSelection()});
$('backup-all-files').addEventListener('change',event=>{toggleAll($('backup-users'),'files',event.target.checked);updateSelection()});
$('backup-users').addEventListener('change',updateSelection);
$('backup-settings').addEventListener('change',updateSelection);
$('backup-filter').addEventListener('input',event=>{
 const query=event.target.value.trim().toLowerCase();
 for(const row of $('backup-users').querySelectorAll('tr'))row.hidden=Boolean(query)&&!row.textContent.toLowerCase().includes(query);
 updateSelection();
});
$('backup-start').addEventListener('click',async()=>{
 showError($('backup-create-error'),'');
 const body={settings:$('backup-settings').checked,users:checkedNames($('backup-users'),'info'),userFiles:checkedNames($('backup-users'),'files')};
 try{state.job=await post('/create',body);watch()}catch(error){showError($('backup-create-error'),error.message)}
});

/* ---------- backup list ---------- */
function contentChips(manifest){
 const box=el('div');
 if(manifest.settings)box.append(el('span','backup-chip','管理设置'));
 const info=manifest.users.filter(item=>item.info).length,files=manifest.users.filter(item=>item.files);
 if(info)box.append(el('span','backup-chip','{count} 位用户信息',{count:info}));
 if(files.length)box.append(el('span','backup-chip','{count} 位用户文件（{size}）',{count:files.length,size:size(files.reduce((sum,item)=>sum+item.fileBytes,0))}));
 return box;
}
function renderBackups(){
 const body=$('backup-files');body.replaceChildren();
 $('backup-directory').textContent=state.directory||'';
 if(!state.backups.length){
  const row=document.createElement('tr'),cell=el('td','text-muted text-center py-8','还没有备份文件');cell.colSpan=5;row.append(cell);body.append(row);return;
 }
 for(const item of state.backups){
  const row=document.createElement('tr');
  const name=el('td');user(el('span'),item.name);const label=user(el('strong'),item.name);name.append(label);
  const created=el('td');created.textContent=item.valid?when(item.manifest.createdAt):when(item.modified);
  const content=el('td');
  if(item.valid)content.append(contentChips(item.manifest));else{const bad=el('span','backup-invalid');setMessage(bad,item.error||'无法读取');content.append(bad)}
  const length=el('td');length.textContent=size(item.size);
  const actions=el('td');const group=el('div','backup-actions');
  const download=el('a','btn btn-sm btn-light-primary','下载');download.href=base+'/download?name='+encodeURIComponent(item.name);download.rel='noopener';
  const restore=el('button','btn btn-sm btn-light-warning','还原');restore.type='button';restore.disabled=!item.valid||running();restore.addEventListener('click',()=>openRestore(item));
  const remove=el('button','btn btn-sm btn-light-danger','删除');remove.type='button';remove.disabled=running();remove.addEventListener('click',()=>removeBackup(item));
  group.append(download,restore,remove);actions.append(group);
  row.append(name,created,content,length,actions);body.append(row);
 }
}
async function removeBackup(item){
 if(!window.confirm(tr('确定删除备份文件 {name}？此操作无法撤销。',{name:item.name})))return;
 try{await post('/delete',{name:item.name});await load()}catch(error){window.alert(i18n?i18n.message(error.message):error.message)}
}
$('backup-upload').addEventListener('change',event=>{
 const file=event.target.files[0];event.target.value='';
 if(!file)return;
 const status=$('backup-upload-status');status.hidden=false;
 const xhr=new XMLHttpRequest();
 xhr.open('POST',base+'/upload?name='+encodeURIComponent(file.name));
 xhr.setRequestHeader('X-CSRF-TOKEN',csrf);
 xhr.upload.onprogress=progress=>{if(progress.lengthComputable)setText(status,'正在上传 {percent}%',{percent:Math.floor(progress.loaded*100/progress.total)})};
 xhr.onload=async()=>{
  let data={};try{data=JSON.parse(xhr.responseText)}catch{}
  if(xhr.status===200){setText(status,'上传完成');await load()}else setMessage(status,data.error||'上传失败');
 };
 xhr.onerror=()=>setText(status,'上传失败');
 setText(status,'正在上传 {percent}%',{percent:0});
 xhr.send(file);
});

/* ---------- restoring ---------- */
function openRestore(item){
 state.restoreName=item.name;
 const manifest=item.manifest;
 $('restore-name').textContent=item.name;
 $('restore-settings').checked=false;$('restore-settings').disabled=!manifest.settings;
 const existing=new Set(state.users.map(entry=>entry.username));
 usersTable($('restore-users'),manifest.users.map(entry=>({username:entry.username,entry})),({entry,username})=>{
  const current=el('td');current.append(el('span',existing.has(username)?'badge badge-light-primary':'badge badge-light-secondary',existing.has(username)?'已存在':'不存在'));
  const files=checkboxCell('files',false,!entry.files,'还原用户文件');
  if(entry.files){const note=el('div','text-muted fs-8','{count} 个文件（{size}）',{count:entry.fileCount,size:size(entry.fileBytes)});files.append(note)}
  else if(entry.note){files.title=entry.note}
  return [current,checkboxCell('info',false,!entry.info,'还原用户信息'),files];
 });
 $('restore-info-mode').value='skip';$('restore-file-mode').value='skip';
 showError($('restore-error'),'');
 $('restore-panel').hidden=false;
 $('restore-panel').scrollIntoView({behavior:'smooth',block:'start'});
}
function syncRestoreAll(){
 const tbody=$('restore-users');
 for(const [kind,box] of [['info','restore-all-info'],['files','restore-all-files']]){
  const boxes=visibleBoxes(tbody,kind);
  $(box).checked=boxes.length>0&&boxes.every(input=>input.checked);
 }
}
$('restore-all-info').addEventListener('change',event=>{toggleAll($('restore-users'),'info',event.target.checked);syncRestoreAll()});
$('restore-all-files').addEventListener('change',event=>{toggleAll($('restore-users'),'files',event.target.checked);syncRestoreAll()});
$('restore-users').addEventListener('change',syncRestoreAll);
$('restore-cancel').addEventListener('click',()=>{$('restore-panel').hidden=true});
$('restore-start').addEventListener('click',async()=>{
 showError($('restore-error'),'');
 const body={name:state.restoreName,settings:$('restore-settings').checked,users:checkedNames($('restore-users'),'info'),userFiles:checkedNames($('restore-users'),'files'),infoMode:$('restore-info-mode').value,fileMode:$('restore-file-mode').value};
 if(!body.settings&&!body.users.length&&!body.userFiles.length){showError($('restore-error'),'请至少选择一项还原内容');return}
 const overwrite=(body.infoMode==='overwrite'&&(body.settings||body.users.length))||(body.fileMode==='overwrite'&&body.userFiles.length);
 const message=overwrite?'将覆盖当前已有的数据，且无法撤销。确定开始还原吗？':'确定开始还原所选内容吗？';
 if(!window.confirm(tr(message)))return;
 try{state.job=await post('/restore',body);$('restore-panel').hidden=true;watch()}catch(error){showError($('restore-error'),error.message)}
});

/* ---------- job progress ---------- */
function running(){return state.job.state==='running'}
function renderJob(){
 const job=state.job,panel=$('backup-job');
 panel.hidden=!job.state||job.state==='idle';
 if(panel.hidden)return;
 const restore=job.kind==='restore';
 const title=$('backup-job-title');
 if(job.state==='running')setText(title,restore?'正在还原：{phase}':'正在备份：{phase}',{phase:tr(job.phase||'准备中')});
 else if(job.state==='done')setText(title,restore?'还原完成':'备份完成');
 else if(job.state==='canceled')setText(title,restore?'还原已取消':'备份已取消');
 else setText(title,restore?'还原失败：{error}':'备份失败：{error}',{error:job.error?tr(job.error.key,job.error.values):''});
 const bar=$('backup-progress-bar');
 const percent=job.bytesTotal>0?Math.min(100,Math.floor(job.bytesDone*100/job.bytesTotal)):(job.state==='done'?100:0);
 bar.style.width=percent+'%';
 bar.className='progress-bar '+(job.state==='error'||job.state==='canceled'?'bg-danger':job.state==='done'?'bg-success':'');
 const detail=$('backup-job-detail');
 if(job.state==='running'&&job.filesTotal>0)setText(detail,'{done}/{total} 个文件，{bytes} / {all}。{current}',{done:job.filesDone,total:job.filesTotal,bytes:size(job.bytesDone),all:size(job.bytesTotal),current:job.current||''});
 else if(job.state==='done'&&job.result&&job.kind==='backup')setText(detail,'已保存为 {name}',{name:job.result});
 else detail.textContent=job.current||'';
 if(job.state!=='running')detail.setAttribute('data-air-i18n-skip','');
 const summary=$('backup-job-summary');summary.replaceChildren();
 for(const line of job.summary||[])summary.append(el('li','',line.key,line.values));
 const warnings=$('backup-job-warnings');warnings.replaceChildren();
 for(const line of job.warnings||[])warnings.append(el('li','',line.key,line.values));
 $('backup-cancel').hidden=job.state!=='running';
}
async function tick(){
 try{state.job=await request('/job')}catch{}
 renderJob();
 if(running()){state.poll=setTimeout(tick,1000)}else{state.poll=0;await load()}
}
function watch(){clearTimeout(state.poll);renderJob();updateSelection();renderBackups();state.poll=setTimeout(tick,500)}
$('backup-cancel').addEventListener('click',async()=>{try{await post('/cancel',{})}catch{}});

async function load(){
 try{
  const data=await request('/state');
  state.users=data.users;state.backups=data.backups;state.job=data.job;state.directory=data.directory;
 }catch(error){showError($('backup-create-error'),error.message);return}
 const ticked=new Set(checkedNames($('backup-users'),'info')),filesTicked=new Set(checkedNames($('backup-users'),'files'));
 renderUsers();
 for(const input of $('backup-users').querySelectorAll('input[data-kind]')){
  const name=input.closest('tr').dataset.name;
  input.checked=(input.dataset.kind==='info'?ticked:filesTicked).has(name)&&!input.disabled;
 }
 updateSelection();renderBackups();renderJob();
 if(running()&&!state.poll)state.poll=setTimeout(tick,1000);
}
load();
})();
