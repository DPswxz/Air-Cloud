(()=>{function init(){const sidebar=document.getElementById('kt_app_sidebar'),header=document.getElementById('kt_app_sidebar_header');if(!sidebar||!header)return;const button=document.createElement('button');button.type='button';button.className='nas-sidebar-toggle';button.setAttribute('aria-controls','kt_app_sidebar');button.innerHTML='<svg viewBox="0 0 12 20" aria-hidden="true"><path d="M8 5 3 10l5 5" fill="currentColor"/></svg><span>收起导航</span>';header.append(button);let saved=false;try{saved=localStorage.getItem('nas.sidebar.collapsed')==='1'}catch{}
function apply(value){document.documentElement.classList.toggle('nas-sidebar-collapsed',value);document.body.classList.toggle('nas-sidebar-collapsed',value);button.setAttribute('aria-expanded',String(!value));button.setAttribute('aria-label',value?'展开左侧导航':'收起左侧导航');button.title=value?'展开左侧导航':'收起左侧导航';button.querySelector('span').textContent=value?'展开导航':'收起导航';try{localStorage.setItem('nas.sidebar.collapsed',value?'1':'0')}catch{}}
apply(saved);let animationTimer;button.addEventListener('click',()=>{clearTimeout(animationTimer);document.documentElement.classList.add('nas-sidebar-animating');apply(!document.body.classList.contains('nas-sidebar-collapsed'));animationTimer=setTimeout(()=>document.documentElement.classList.remove('nas-sidebar-animating'),300)});sidebar.querySelectorAll('.menu-link').forEach(a=>{const label=a.querySelector('.menu-title');if(label)a.title=label.textContent.trim();a.addEventListener('click',()=>{if(a.closest('.menu-accordion')&&document.body.classList.contains('nas-sidebar-collapsed'))apply(false)})});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();})();
(()=>{
const paths={
 user:'M20 21v-2a7 7 0 0 0-14 0v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
 logout:'M9 4H5v16h4m5-12 4 4-4 4m-5-4h12',
 restore:'M4 10a8 8 0 1 1 2 9M4 4v6h6m2-3v5l3 2',
 trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
 download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
 upload:'M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5',
 folder:'M3 7V4h6l3 3h9v13H3V7m9 4v6m-3-3h6',
 refresh:'M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5m-4 8a8 8 0 0 0 14 3l3-3m0 5v-5h-5',
 rename:'m15 4 5 5M4 16 16 4a2 2 0 0 1 4 4L8 20H4v-4m8 5h9',
 move:'M3 7V4h6l3 3h9v13H3V7m5 7h9m-3-3 3 3-3 3',
 share:'M8 11 16 6m-8 7 8 5M5 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6m14-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6m0 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
 check:'m5 12 4 4L20 5',
 close:'m6 6 12 12M18 6 6 18',
 save:'M4 3h13l4 4v14H3V3h1m3 0v6h10V3M7 21v-8h10v8',
 lock:'M6 10h12v11H6V10m3 0V6a3 3 0 0 1 6 0v4m-3 4v3',
 shield:'m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6l8-3m-4 9 3 3 5-6',
 copy:'M9 8h12v13H9V8M5 16H3V3h12v2',
 plus:'M12 4v16M4 12h16',
 search:'M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16m6-2 6 6',
 settings:'M4 7h16M4 17h16M8 4v6m8 4v6',
 link:'m10 14 4-4m-6-2 2-2a5 5 0 0 1 7 7l-2 2m-6 0-2 2a5 5 0 0 1-7-7l2-2',
 open:'M14 3h7v7m0-7L10 14M10 3H3v18h18v-7'
};
function choose(label){for(const [pattern,key] of [[/复制|Copy/i,'copy'],[/打开|Open/i,'open'],[/个人信息|个人资料|Profile/i,'user'],[/注销|退出|Sign out/i,'logout'],[/恢复|还原/,'restore'],[/彻底删除|清空|删除|Delete/i,'trash'],[/下载|Download/i,'download'],[/上传|Upload/i,'upload'],[/新建文件夹|新文件夹/,'folder'],[/刷新|Refresh/i,'refresh'],[/重命名|Rename/i,'rename'],[/移动|Move/i,'move'],[/分享|Share/i,'share'],[/修改密码|密码|Password/i,'lock'],[/两步验证|验证|MFA/i,'shield'],[/复制|Copy/i,'copy'],[/保存|Save/i,'save'],[/取消|返回|Cancel|关闭|Close/i,'close'],[/确认|继续|Confirm|登录|Login/i,'check'],[/添加|新增|Add/i,'plus'],[/搜索|Search/i,'search'],[/设置|高级|配置|Settings/i,'settings'],[/链接|Link/i,'link'],[/打开|Open/i,'open']])if(pattern.test(label))return key;return 'settings'}
let queued=false;
function decorate(){queued=false;for(const el of document.querySelectorAll('button,a.btn,a.menu-link')){
 if(el.closest('#kt_app_sidebar')||el.matches('.nas-sidebar-toggle,[data-tab],.air-task-launcher,.air-task-remove,#air-task-fold')||el.querySelector('svg,i,img,.menu-icon'))continue;
 const label=(el.textContent||'').trim();if(!/[\p{L}]/u.test(label)||label.length>60)continue;
 const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.classList.add('air-action-icon');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');icon.setAttribute('stroke-width','1.8');icon.setAttribute('stroke-linecap','round');icon.setAttribute('stroke-linejoin','round');icon.setAttribute('aria-hidden','true');icon.setAttribute('focusable','false');const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',paths[choose(label)]);icon.append(path);el.prepend(icon)
 }}
function schedule(){if(!queued){queued=true;requestAnimationFrame(decorate)}}
function start(){decorate();new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
(()=>{let queued=false;function enhance(){queued=false;if(!window.jQuery?.fn.select2)return;const $=jQuery;for(const select of document.querySelectorAll('select')){if(select.multiple||select.classList.contains('select2-hidden-accessible')||select.dataset.airNative==='1'||select.hasAttribute('data-control'))continue;const paging=!!select.closest('.dt-length,.dataTables_length');const parent=select.closest('.modal');$(select).select2({theme:'bootstrap5',minimumResultsForSearch:select.options.length>12?10:Infinity,width:paging?'84px':select.id==='air-recycle-days'?'110px':'100%',dropdownParent:parent?$(parent):$(document.body)});$(select).next('.select2-container').addClass('air-select');}}
function schedule(){if(!queued){queued=true;requestAnimationFrame(enhance)}}function start(){enhance();new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true})}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();})();
