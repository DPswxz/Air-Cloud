(()=>{function init(){const sidebar=document.getElementById('kt_app_sidebar'),header=document.getElementById('kt_app_sidebar_header');if(!sidebar||!header)return;const button=document.createElement('button');button.type='button';button.className='nas-sidebar-toggle';button.setAttribute('aria-controls','kt_app_sidebar');button.innerHTML=window.AirI18n.t("<svg viewBox=\"0 0 12 20\" aria-hidden=\"true\"><path d=\"M8 5 3 10l5 5\" fill=\"currentColor\"/></svg><span>收起导航</span>");header.append(button);let saved=false;try{saved=localStorage.getItem('nas.sidebar.collapsed')==='1'}catch{}
function apply(value){document.documentElement.classList.toggle('nas-sidebar-collapsed',value);document.body.classList.toggle('nas-sidebar-collapsed',value);button.setAttribute('aria-expanded',String(!value));button.setAttribute('aria-label',value?window.AirI18n.t("展开左侧导航"):window.AirI18n.t("收起左侧导航"));button.title=value?window.AirI18n.t("展开左侧导航"):window.AirI18n.t("收起左侧导航");button.querySelector('span').textContent=value?window.AirI18n.t("展开导航"):window.AirI18n.t("收起导航");try{localStorage.setItem('nas.sidebar.collapsed',value?'1':'0')}catch{}}
apply(saved);let animationTimer;button.addEventListener('click',()=>{clearTimeout(animationTimer);document.documentElement.classList.add('nas-sidebar-animating');apply(!document.body.classList.contains('nas-sidebar-collapsed'));animationTimer=setTimeout(()=>document.documentElement.classList.remove('nas-sidebar-animating'),300)});sidebar.querySelectorAll('.menu-link').forEach(a=>{const label=a.querySelector('.menu-title');if(label){const syncHint=()=>{const text=label.textContent.trim();const title=window.AirI18n.language==='en'?window.AirI18n.t(text):text; if(a.title!==title)a.title=title};syncHint();new MutationObserver(syncHint).observe(label,{childList:true,subtree:true,characterData:true});a.addEventListener('pointerenter',syncHint);a.addEventListener('focus',syncHint);}a.addEventListener('click',()=>{if(a.closest('.menu-accordion')&&document.body.classList.contains('nas-sidebar-collapsed'))apply(false)})});}
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
 link:'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
 open:'M14 3h7v7m0-7L10 14M10 3H3v18h18v-7'
};
function choose(label){if(/编辑|Edit/i.test(label))return "rename";if(/用作模板|模板|Template/i.test(label))return "copy";if(/配额扫描|Quota scan/i.test(label))return "search";for(const [pattern,key] of [[/复制|Copy/i,'copy'],[/打开|Open/i,'open'],[/个人信息|个人资料|Profile/i,'user'],[/注销|退出|Sign out/i,'logout'],[/恢复|还原/,'restore'],[/彻底删除|清空|删除|Delete/i,'trash'],[/下载|Download/i,'download'],[/上传|Upload/i,'upload'],[/新建文件夹|新文件夹/,'folder'],[/刷新|Refresh/i,'refresh'],[/重命名|Rename/i,'rename'],[/移动|Move/i,'move'],[/分享|Share/i,'share'],[/修改密码|密码|Password/i,'lock'],[/两步验证|验证|MFA/i,'shield'],[/复制|Copy/i,'copy'],[/保存|Save/i,'save'],[/取消|返回|Cancel|关闭|Close/i,'close'],[/确认|继续|Confirm|登录|Login/i,'check'],[/添加|新增|Add/i,'plus'],[/搜索|Search/i,'search'],[/设置|高级|配置|Settings/i,'settings'],[/链接|Link/i,'link'],[/打开|Open/i,'open']])if(pattern.test(label))return key;return 'settings'}
let queued=false;
function decorate(){queued=false;for(const el of document.querySelectorAll('button,a.btn,a.menu-link')){
 if(el.closest('#kt_app_sidebar')||el.matches('.nas-sidebar-toggle,[data-tab],.air-task-launcher,.air-task-remove,#air-task-fold')||el.querySelector('svg,i,img,.menu-icon'))continue;
 const label=(el.textContent||'').trim();if(!/[\p{L}]/u.test(label)||label.length>60)continue;
 const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.classList.add('air-action-icon');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');icon.setAttribute('stroke-width','1.8');icon.setAttribute('stroke-linecap','round');icon.setAttribute('stroke-linejoin','round');icon.setAttribute('aria-hidden','true');icon.setAttribute('focusable','false');const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',paths[choose(label)]);icon.append(path);el.prepend(icon)
 }}
function schedule(){if(!queued){queued=true;requestAnimationFrame(decorate)}}
function start(){decorate();new MutationObserver(schedule).observe(document.body||document.documentElement,{childList:true,subtree:true})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
(()=>{let queued=false;function enhance(){queued=false;if(!window.jQuery?.fn.select2)return;const $=jQuery;for(const select of document.querySelectorAll('select')){if(select.multiple||select.classList.contains('select2-hidden-accessible')||select.dataset.airNative==='1'||select.hasAttribute('data-control'))continue;const paging=!!select.closest('.dt-length,.dataTables_length');const parent=select.closest('.modal');$(select).select2({theme:'bootstrap5',minimumResultsForSearch:select.options.length>12?10:Infinity,width:paging?'84px':select.id==='air-recycle-days'?'110px':'100%',dropdownParent:parent?$(parent):$(document.body)});$(select).next('.select2-container').addClass('air-select');}}
function schedule(){if(!queued){queued=true;requestAnimationFrame(enhance)}}function start(){enhance();new MutationObserver(schedule).observe(document.body||document.documentElement,{childList:true,subtree:true})}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();})();

(()=>{document.addEventListener('click',event=>{const button=event.target.closest?.('[data-avatar-toggle]');if(!button)return;const picker=document.getElementById(button.getAttribute('aria-controls'));if(!picker)return;if(window.AirMotion){window.AirMotion.toggleDetails(picker,button.getAttribute('aria-expanded')!=='true');return}picker.open=!picker.open;button.setAttribute('aria-expanded',String(picker.open));button.classList.toggle('active',picker.open)})})();

// Shared layout motion: natural dimensions remain the source of truth.
(()=>{
 const duration=280,easing='cubic-bezier(.22,1,.36,1)',reduce=matchMedia('(prefers-reduced-motion: reduce)'),states=new Map(),detailsMotion=new WeakMap();let queued=false;
 function toggleDetails(el,open=!el.open){
  const old=detailsMotion.get(el),from=el.getBoundingClientRect().height;el.dataset.airMotionOpen=String(open);
  if(old){old.oncancel=null;old.cancel();detailsMotion.delete(el)}
  if(reduce.matches){el.open=open;return}
  el.open=true;
  const display=old?old.airOriginalDisplay:el.style.display;el.style.display='block';
  const full=el.getBoundingClientRect().height,summary=el.querySelector(':scope > summary'),css=getComputedStyle(el),margin=css.marginBottom,padding=css.paddingTop;
  el.open=false;const closed=summary&&!summary.hidden?el.getBoundingClientRect().height:0;el.open=true;
  const animation=el.animate([{height:from+'px',marginBottom:from?margin:'0px',paddingTop:from?padding:'0px',overflow:'clip',boxSizing:'border-box',opacity:from?1:0},{height:(open?full:closed)+'px',marginBottom:open||closed?margin:'0px',paddingTop:open||closed?padding:'0px',overflow:'clip',boxSizing:'border-box',opacity:open?1:closed?1:0}],{duration,easing});
  animation.airOriginalDisplay=display;detailsMotion.set(el,animation);
  animation.onfinish=()=>{detailsMotion.delete(el);el.open=open;el.style.display=display;for(const [container,state] of states)if(container.contains(el))Object.assign(state,snapshot(container));schedule()};
  document.querySelectorAll('[data-avatar-toggle]').forEach(b=>{if(b.getAttribute('aria-controls')===el.id){b.setAttribute('aria-expanded',String(open));b.classList.toggle('active',open)}});
 }
 window.AirMotion={toggleDetails};
 document.addEventListener('click',event=>{const summary=event.target.closest?.('details > summary');if(!summary||event.target.closest('a,button,input,select'))return;event.preventDefault();toggleDetails(summary.parentElement,!((detailsMotion.get(summary.parentElement))?summary.parentElement.dataset.airMotionOpen==='true':summary.parentElement.open))},true);
 function snapshot(el){return {height:el.getBoundingClientRect().height,width:el.getBoundingClientRect().width,children:new Map([...el.children].map(c=>[c,c.getBoundingClientRect().top]))}}
 const observer=new ResizeObserver(entries=>{for(const entry of entries){const state=states.get(entry.target);if(state&&!state.animation)schedule()}});
 function discover(){for(const el of document.querySelectorAll('.card > .card-header,.card > .card-body,.modal-content > .modal-body')){if(states.has(el)||el.parentElement.closest('.card-body,.modal-body'))continue;states.set(el,{...snapshot(el),animation:null});observer.observe(el)}}
 function update(){queued=false;discover();for(const [el,state] of states){if(!el.isConnected){observer.unobserve(el);state.animation?.cancel();states.delete(el);continue}
   // Details and Bootstrap collapses already animate their own flow.
   if(el.querySelector('.collapsing')||[...el.querySelectorAll('details')].some(d=>detailsMotion.has(d))){Object.assign(state,snapshot(el));continue;}
   const current=state.animation?el.getBoundingClientRect().height:state.height;
   if(state.animation){state.animation.onfinish=null;state.animation.cancel();state.animation=null}
   const next=snapshot(el),before=state.height;
   // Page and card layout changes apply immediately, without height or slide animation.
   Object.assign(state,next);
  }}
 function schedule(){if(!queued){queued=true;requestAnimationFrame(update)}}
 function start(){discover();new MutationObserver(records=>{if(records.some(r=>!r.target.closest?.('.air-task-center,.air-task-launcher,.select2-container')) )schedule()}).observe(document.body||document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','open','class','style']});window.addEventListener('resize',schedule);document.addEventListener('shown.bs.tab',schedule);document.addEventListener('hidden.bs.collapse',schedule);document.addEventListener('shown.bs.collapse',schedule)}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();

// Capacity overview belongs to the shared client header on every page.
(()=>{function mount(){if(!location.pathname.startsWith('/web/client/')||!document.body.dataset.airOwner||document.getElementById('air-capacity-trigger'))return;const nav=document.querySelector('#kt_app_header_navbar>.flex-shrink-0');if(!nav)return;const host=document.createElement('div');host.innerHTML=window.AirI18n.t("<div class=\"d-flex align-items-center ms-2 ms-lg-3\">\r\n    <button type=\"button\" id=\"air-capacity-trigger\" class=\"btn btn-icon btn-active-light-primary w-35px h-35px\" aria-label=\"容量概览\" title=\"容量概览\" data-kt-menu-trigger=\"{default:'click', lg:'hover'}\" data-kt-menu-attach=\"parent\" data-kt-menu-placement=\"bottom-end\">\r\n        <i class=\"ki-duotone ki-information-2 fs-2\"><span class=\"path1\"></span><span class=\"path2\"></span><span class=\"path3\"></span></i>\r\n    </button>\r\n    <div class=\"menu menu-sub menu-sub-dropdown air-capacity-menu\" data-kt-menu=\"true\">\r\n        <div class=\"air-capacity-heading\"><span>磁盘容量</span><strong data-capacity=\"capacity\">—</strong></div>\r\n        <div class=\"air-capacity-body\">\r\n            <div class=\"air-capacity-ring\" role=\"img\" aria-label=\"正在加载容量占比\"><div><strong data-capacity=\"percent\">—</strong><span>已占用</span></div></div>\r\n            <div class=\"air-capacity-details\"><div class=\"air-capacity-total\">使用容量 <strong data-capacity=\"total\">—</strong></div>\r\n                <div class=\"air-capacity-line\"><span><i class=\"used\"></i>已用</span><strong data-capacity=\"used\">—</strong></div>\r\n                <div class=\"air-capacity-line\"><span><i class=\"recycle\"></i>回收站</span><strong data-capacity=\"recycle\">—</strong></div>\r\n                <div class=\"air-capacity-line\"><span><i class=\"remaining\"></i><span data-capacity=\"remaining-label\">剩余</span></span><strong data-capacity=\"remaining\">—</strong></div>\r\n            </div>\r\n        </div>\r\n        <div class=\"air-capacity-footer\"><span data-capacity=\"files\">正在读取…</span><span data-capacity=\"note\"></span></div>\r\n    </div>\r\n</div>");const item=host.firstElementChild;nav.prepend(item);if(window.KTMenu)KTMenu.createInstances();const script=document.createElement('script');script.src='/static/air-capacity.js?v=20261016-en2';document.body.append(script)}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount()})();

// Library views retain a clean header without page titles.
(()=>{function clean(){if(!document.body.dataset.airOwner)return;const u=new URL(location.href);if(u.pathname==="/web/client/shares"||u.pathname==="/web/client/files"&&!u.searchParams.has("air_settings"))document.documentElement.classList.add("air-library-title");document.getElementById("air-page-title")?.remove()}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",clean);else clean()})();

// Use a distinct asset URL so old logo caches cannot survive a page refresh.
(()=>{function update(){for(const el of document.querySelectorAll('img[src*="air-cloud.svg"],link[rel*="icon"][href*="air-cloud.svg"]')){const attr=el.tagName==='IMG'?'src':'href';el.setAttribute(attr,el.getAttribute(attr).replace('air-cloud.svg','air-cloud-material.svg'))}}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',update);else update()})();

// Keep the recycle title after localization updates the underlying file page.
(()=>{if(!new URL(location.href).searchParams.has('air_trash'))return;function sync(){if(document.title!==window.AirI18n.t("Air Cloud - 回收站"))document.title=window.AirI18n.t("Air Cloud - 回收站")}sync();new MutationObserver(sync).observe(document.head,{childList:true,subtree:true,characterData:true})})();
