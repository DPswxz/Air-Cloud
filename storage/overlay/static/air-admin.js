(()=>{
 if(!location.pathname.startsWith('/web/admin/'))return;
 document.documentElement.classList.add('air-admin-ui');
 const icons={
  profile:'M20 21v-2a7 7 0 0 0-14 0v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  permissions:'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4Zm-4 9 3 3 5-6',
  quota:'M4 4h16v16H4V4Zm0 6h16M8 14h2m4 0h2m-8 3h2m4 0h2',
  advanced:'M5 3v18M12 3v18M19 3v18M2 8h6m1 8h6m1-10h6',
  storage:'M4 4h16v6H4V4Zm0 10h16v6H4v-6Zm3-7h.01M7 17h.01M14 7h3m-3 10h3',
  folder:'M3 6h7l2 3h9v12H3V6Zm0 0V3h7l2 3',
  groups:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m8-7.87a4 4 0 0 1 0 7.75',
  users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m9 0v6m-3-3h6',
  admin:'M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M2 21v-2a5 5 0 0 1 8-4m6-3 5 2v4c0 3-5 5-5 5s-5-2-5-5v-4l5-2',
  roles:'M3 4h18v16H3V4Zm4 5h4m-4 4h4m4-4 2 2 3-3m-5 8h5',
  key:'M15 7a5 5 0 1 1-4 8l-7 6H2v-3l7-7a5 5 0 0 1 6-4Zm2 2h.01',
  certificate:'M6 3h12v11H6V3Zm3 11-1 7 4-2 4 2-1-7M9 7h6m-6 3h4',
  smtp:'M3 5h18v14H3V5Zm0 1 9 7 9-7',
  acme:'M7 11V7a5 5 0 0 1 10 0v4M5 11h14v11H5V11Zm7 4v3',
  branding:'M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h3a5 5 0 0 0 0-10h-4ZM7 8h.01m5-2h.01m5 2h.01M5 13h.01',
  sftp:'m5 5-3 3 3 3m14 2 3 3-3 3M2 8h13M9 16h13',
  connections:'M3 3v7h7M3 10l7-7m11 18v-7h-7m7 0-7 7',
  events:'M5 5h14v16H5V5Zm3-3v6m8-6v6M5 10h14m-10 4h6m-6 3h4',
  actions:'m13 2-9 12h7l-1 8 10-13h-7l1-7',
  ip:'M3 3h18v18H3V3Zm0 6h18M9 9v12M6 6h.01m4 0h.01m4 7h4m-4 4h4',
  defender:'M12 2 3 6v6c0 6 9 10 9 10s9-4 9-10V6l-9-4Zm-4 7 8 8m0-8-8 8',
  maintenance:'m14 5 5 5m-7 4-8 8-2-2 8-8M14 3a6 6 0 0 0-7 7l7 7a6 6 0 0 0 7-7l-4 4-7-7 4-4',
  status:'M3 12h4l3-8 4 16 3-8h4',
  password:'M6 10h12v11H6V10Zm3 0V6a3 3 0 0 1 6 0v4m-3 5v3',
  network:'M12 3v6M5 15v-3h14v3M9 3h6v6H9V3ZM2 15h6v6H2v-6Zm14 0h6v6h-6v-6',
  rules:'M5 4h14v17H5V4Zm3-2h8v4H8V2Zm0 9 2 2 5-5m-7 9h8'
 };
 Object.assign(icons,{
  headers:'M3 4h18v16H3V4Zm0 5h18M7 13h4m-4 3h8',
  query:'M9 8 5 12l4 4m6-8 4 4-4 4M13 5l-2 14',
  multipart:'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7',
  environment:'M3 4h18v16H3V4Zm3 4 4 4-4 4m7 0h5',
  retention:'M12 3a9 9 0 1 0 9 9M12 6v6l4 2m0-11h6m-3-3v6',
  rename:'m15 4 5 5M4 16 16 4a2 2 0 0 1 4 4L8 20H4v-4m8 5h9',
  copy:'M8 8h13v13H8V8ZM4 16H2V2h14v2',
  schedule:'M3 5h18v16H3V5Zm4-3v6m10-6v6M3 10h18m-13 4h3v3H8v-3',
  filter:'M3 4h18l-7 8v7l-4 2v-9L3 4Z',
  path:'M3 5h6v5H3V5Zm12 9h6v5h-6v-5M6 10v6h9m-4-4 4 4-4 4',
  fileSize:'M5 3h9l5 5v13H5V3Zm9 0v5h5M8 14h8m-8 3h8m-6-5v7m4-7v7',
  preferences:'M4 4h16v16H4V4Zm0 5h16M9 9v11m4-6h4m-4 3h4',
  client:'M3 4h18v13H3V4Zm4 17h10m-5-4v4M7 8h10m-10 4h6',
  groupFilter:'M3 5h18l-7 7v6l-4 3V12L3 5Zm4 0V2m10 3V2',
  roleFilter:'M12 3 3 7l9 4 9-4-9-4Zm-9 9 9 4 9-4m-18 5 9 4 9-4'
 });
 function key(el){
  const exact=el.getAttribute('data-i18n')||el.querySelector('[data-i18n]')?.getAttribute('data-i18n');
  const specific={'title.event_manager':'events','title.ip_manager':'permissions','title.ip_lists':'ip','title.defender':'defender','actions.http_headers':'headers','actions.query_parameters':'query','actions.multipart_body':'multipart','general.env_vars':'environment','actions.data_retention':'retention','actions.fs_types.rename':'rename','actions.fs_types.copy':'copy','rules.triggers.schedule':'schedule','rules.name_filters':'filter','rules.group_name_filters':'groupFilter','rules.role_name_filters':'roleFilter','rules.path_filters':'path','rules.file_size_limits':'fileSize','filters.directory_patterns':'filter','filters.access_time':'schedule','filters.src_bandwidth_limit':'connections','admin.user_page_pref':'preferences','admin.users_groups':'groups','general.role':'roles','storage.title':'storage','status.ssh':'environment','status.ftp':'sftp','status.webdav':'network','status.http':'client','status.data_provider':'storage'};
  if(specific[exact])return specific[exact];
  const hint=[el.getAttribute('data-bs-target'),el.getAttribute('href'),el.getAttribute('data-i18n'),...Array.from(el.querySelectorAll('[data-i18n]')).map(n=>n.getAttribute('data-i18n')),el.textContent].join(' ').toLowerCase();
  const rules=[[/permissions|访问控制|权限/,'permissions'],[/quota|bandwidth|配额|带宽/,'quota'],[/advanced|高级/,'advanced'],[/profile|个人信息/,'profile'],[/smtp|邮件|邮箱|additional_emails/,'smtp'],[/acme|https|证书管理/,'acme'],[/branding|品牌/,'branding'],[/public_keys|公钥/,'key'],[/tls_certs|tls_certificates|tls 证书/,'certificate'],[/password|密码/,'password'],[/all-files|全部文件/,'storage'],[/filesystem|文件系统|storage_provider/,'storage'],[/virtual_folders|folders|虚拟文件夹/,'folder'],[/groups|组/,'groups'],[/admins|管理员/,'admin'],[/roles|角色/,'roles'],[/users|用户/,'users'],[/connections|活动连接/,'connections'],[/eventactions|event_actions|事件操作/,'actions'],[/eventrules|event_rules|事件规则/,'rules'],[/events|事件/,'events'],[/defender|防御/,'defender'],[/iplist|ip_lists|ip 管理/,'ip'],[/maintenance|维护/,'maintenance'],[/server_manager|服务器管理/,'network'],[/status|状态/,'status'],[/sftp|ftp|协议/,'sftp']];
  return rules.find(([pattern])=>pattern.test(hint))?.[1];
 }
 function decorate(el,host=el){const name=key(el);if(!name)return;let icon=host.querySelector(':scope > .air-admin-section-icon');if(icon?.dataset.icon===name)return;
  host.querySelectorAll(':scope > .air-action-icon,:scope > .air-admin-section-icon,:scope > i.ki-duotone,:scope > i.ki-solid').forEach(n=>n.remove());
  if(host.classList.contains('menu-icon'))host.replaceChildren();
  icon=document.createElement('span');icon.className='air-admin-section-icon';icon.dataset.icon=name;icon.setAttribute('aria-hidden','true');
  icon.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="'+icons[name]+'"/></svg>';host.prepend(icon);
 }
 let queued=false;
 function enhance(){queued=false;
  for(const row of document.querySelectorAll('#kt_app_content .form-group.row')){const labels=row.querySelectorAll(':scope > label.col-form-label');if(labels.length){row.classList.add('air-admin-field');row.classList.toggle('air-admin-paired',labels.length===2);for(const child of row.children)if(child.tagName==='DIV'&&/col-/.test(child.className)&&!child.children.length&&!child.textContent.trim())child.classList.add('air-admin-spacer')}}
  for(const el of document.querySelectorAll('#kt_app_content .accordion-button,#kt_app_content .card-title'))decorate(el);
  for(const el of document.querySelectorAll('#kt_app_sidebar .menu-link')){const host=el.querySelector(':scope > .menu-icon');if(host)decorate(el,host)}
 }
 function schedule(){if(!queued){queued=true;requestAnimationFrame(enhance)}}
 function start(){enhance();new MutationObserver(schedule).observe(document.body||document.documentElement,{childList:true,subtree:true,characterData:true})}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
