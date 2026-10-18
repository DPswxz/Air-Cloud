const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {translate,dictionary}=require('../storage/overlay/static/air-i18n.js');

test('English colon labels leave a space before the following value',()=>{
 assert.equal(translate('分享人：')+'Alice','Shared by: Alice');
 assert.equal(translate('分享时间：')+'2026/10/18 09:30','Shared on: 2026/10/18 09:30');
 assert.equal(translate('保存位置：')+'Downloads','Save location: Downloads');
 for(const [key,value] of Object.entries(dictionary))assert.ok(!value.endsWith(':'),key);
 for(const value of ['https://nas.example/share','09:30','host:port'])assert.equal(translate(value),value);
 assert.equal(translate('分享人：','zh-CN'),'分享人：');
});
test('hover hints follow either UI language and preserve unknown user text',()=>{
 const {translateHint}=require('../storage/overlay/static/air-i18n.js');
 assert.equal(translateHint('刷新当前目录','en'),'Refresh current folder');
 assert.equal(translateHint('Refresh current folder','zh-CN'),'刷新当前目录');
 assert.equal(translateHint('Show sidebar menu','zh-CN'),'显示侧边栏菜单');
 for(const text of ['我的中文文件.txt','/Files/工作文档','user@example.com']){assert.equal(translateHint(text,'en'),text);assert.equal(translateHint(text,'zh-CN'),text)}
});
test('custom UI translations cover auth, transfers, recycle bin and administration',()=>{
 for(const text of ['用户名/邮箱','邮箱已被注册，请直接登录','头像设置','传输列表','回收站','全部文件','已完成','验证并注册','高级设置']){assert.ok(dictionary[text],text);assert.ok(!/[\u3400-\u9fff]/.test(translate(text)),text)}
 assert.equal(translate('用户名/邮箱','zh-CN'),'用户名/邮箱');assert.equal(translate('Private-file.mdx'),'Private-file.mdx');assert.equal(translate('  已完成 '),'  Completed ');
 assert.equal(translate('<button title="选择头像">头像设置</button>'),'<button title="Choose an avatar">Avatar settings</button>');
});
test('authored labels are localized without globally rewriting filenames or input values',()=>{
 const runtime=fs.readFileSync(path.join(__dirname,'../tools/locales/runtime.js'),'utf8');assert.ok(runtime.includes('[data-air-i18n]'));assert.ok(!runtime.includes("document.createTreeWalker(document.body"));assert.ok(!runtime.includes('.value=api.t'));
 const files=fs.readFileSync(path.join(__dirname,'../storage/overlay/templates/webclient/files.html'),'utf8');assert.ok(!files.includes('upload_files_empty_button'));assert.ok(files.includes('dropzone.addFile(selected)'));
});

function languageMenu({stored='zh-CN',cookie='',storageBlocked=false}={}){
 const vm=require('node:vm'),events={},hostEvents={},rows=[],writes={};let reloads=0;
 const trigger={setAttribute(){},focus(){}},menu={hidden:true,children:rows,querySelector(){return rows[stored==='en'?1:0]},append(row){rows.push(row)}};
 const host={classList:{add(){}},className:'',querySelectorAll(){return []},querySelector(selector){return selector==='button'?trigger:menu},addEventListener(name,fn){hostEvents[name]=fn},contains(target){return target===trigger||target===menu||rows.includes(target)}};
 const document={cookie,readyState:'loading',documentElement:{},body:{append(){},classList:{add(){}}},getElementById(){return null},querySelector(){return null},querySelectorAll(){return []},createElement(tag){if(tag==='div')return host;return {dataset:{},setAttribute(){},focus(){}}},addEventListener(name,fn){events[name]=fn},title:''};
 const context={document,window:{addEventListener(){},dispatchEvent(){},top:{location:{reload(){reloads++}}}},location:{protocol:'https:'},localStorage:{getItem(){if(storageBlocked)throw Error('blocked');return stored},setItem(key,value){if(storageBlocked)throw Error('blocked');writes[key]=value}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}},MutationObserver:class{observe(){}},requestAnimationFrame(){}};
 context.window.document=document;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../storage/overlay/static/air-i18n.js'),'utf8'),context);
 events.DOMContentLoaded();return {context,events,hostEvents,trigger,menu,rows,writes,get reloads(){return reloads}};
}
test('mobile focus loss does not dismiss language choice before its click',async()=>{
 const ui=languageMenu();ui.trigger.onclick();assert.equal(ui.menu.hidden,false);
 ui.hostEvents.focusout({relatedTarget:null});assert.equal(ui.menu.hidden,false);
 await ui.rows[1].onclick();assert.equal(ui.writes['air.language'],'en');assert.equal(ui.reloads,0);
 ui.trigger.onclick();ui.hostEvents.focusout({relatedTarget:{}});assert.equal(ui.menu.hidden,true);
 ui.trigger.onclick();ui.events.click({target:{}});assert.equal(ui.menu.hidden,true);
});
test('language survives unavailable browser storage through the cookie',async()=>{
 const ui=languageMenu({cookie:'other=1; AIR_LANGUAGE=en',storageBlocked:true});assert.equal(ui.context.window.AirI18n.language,'en');
 await ui.rows[0].onclick();assert.match(ui.context.document.cookie,/^AIR_LANGUAGE=zh-CN;/);assert.equal(ui.reloads,0);
 const preferred=languageMenu({stored:'zh-CN',cookie:'AIR_LANGUAGE=en'});assert.equal(preferred.context.window.AirI18n.language,'zh-CN');
});

test('language switches live during transfers and synchronizes retained frames',async()=>{
 const ui=languageMenu(),seen=[];ui.context.window.top=ui.context.window;ui.context.window.AirCloudTransfers={hasActive(){return true}};
 const child={AirI18n:{async applyLanguage(value){seen.push(value)}},document:{querySelectorAll(){return []}}};
 const original=ui.context.document.querySelectorAll;ui.context.document.querySelectorAll=selector=>selector==='iframe'?[{contentWindow:child}]:original(selector);
 await ui.context.window.AirI18n.setLanguage('en');assert.equal(ui.context.window.AirI18n.language,'en');assert.equal(ui.context.document.documentElement.lang,'en');assert.deepEqual(seen,['en']);assert.equal(ui.reloads,0);
 await ui.context.window.AirI18n.setLanguage('zh-CN');assert.equal(ui.context.window.AirI18n.language,'zh-CN');assert.equal(ui.reloads,0);
});

test('rapid switches serialize native translations and finish in the requested language',async()=>{
 const ui=languageMenu(),changes=[],events=[];ui.context.window.i18next={isInitialized:true,async changeLanguage(value){changes.push(value);await Promise.resolve()}};ui.context.window.dispatchEvent=event=>events.push(event.detail.language);
 const english=ui.context.window.AirI18n.setLanguage('en'),chinese=ui.context.window.AirI18n.setLanguage('zh-CN');await Promise.all([english,chinese]);assert.deepEqual(changes,['en','zh-CN']);assert.deepEqual(events,['zh-CN']);assert.equal(ui.context.window.AirI18n.language,'zh-CN');assert.equal(ui.reloads,0);
});

test('authored UI literals have complete English translations',()=>{
 const result=require('../tools/audit-locales.cjs').audit();assert.ok(result.checked>200);assert.deepEqual(result.issues,[]);
});
function labelNode(text=''){
 const attributes=new Map();return {textContent:text,closest(){return null},hasAttribute(key){return attributes.has(key)},getAttribute(key){return attributes.get(key)??null},setAttribute(key,value){attributes.set(key,String(value))},removeAttribute(key){attributes.delete(key)}};
}
function attachLabels(ui,nodes){
 const original=ui.context.document.querySelectorAll;ui.context.document.querySelectorAll=selector=>selector==='[data-air-i18n-text]'?nodes.filter(node=>node.hasAttribute('data-air-i18n-text')):selector==='[data-air-i18n]'?nodes.filter(node=>node.hasAttribute('data-air-i18n')):selector.startsWith('[data-air-i18n-attrs]')?nodes.filter(node=>node.hasAttribute('data-air-i18n-attrs')):original(selector);
}
test('background upload notice switches both ways after it was created in either language',async()=>{
 for(const stored of ['zh-CN','en']){
  const ui=languageMenu({stored}),label=labelNode(),api=ui.context.window.AirI18n;attachLabels(ui,[label]);
  api.bindMessage(label,api.t('上传在后台进行，可以继续浏览网盘。'));
  await api.setLanguage('en');assert.equal(label.textContent,'Uploads continue in the background. You can keep browsing your files.');
  await api.setLanguage('zh-CN');assert.equal(label.textContent,'上传在后台进行，可以继续浏览网盘。');assert.equal(ui.reloads,0);
 }
});
test('search descriptions and formatted notices preserve opaque filenames across language switches',async()=>{
 const ui=languageMenu(),label=labelNode(),unknown=labelNode(),api=ui.context.window.AirI18n;attachLabels(ui,[label,unknown]);
 const userPath='/文件/回收站/上传文件.txt';api.bindText(label,'所在目录：{path}',{path:userPath});api.bindMessage(unknown,'上传文件.txt');
 await api.setLanguage('en');assert.equal(label.textContent,'Folder: '+userPath);assert.equal(unknown.textContent,'上传文件.txt');
 assert.equal(label.getAttribute('data-air-i18n'),'所在目录：{path}');
 await api.setLanguage('zh-CN');assert.equal(label.textContent,'所在目录：'+userPath);assert.equal(unknown.textContent,'上传文件.txt');
});
test('dynamic accessibility hints restore their original source instead of retaining English',async()=>{
 const ui=languageMenu(),node=labelNode(),api=ui.context.window.AirI18n;node.setAttribute('data-air-i18n-attrs','');node.setAttribute('aria-label','头像 12');attachLabels(ui,[node]);
 await api.setLanguage('en');assert.equal(node.getAttribute('aria-label'),'Avatar 12');
 await api.setLanguage('zh-CN');assert.equal(node.getAttribute('aria-label'),'头像 12');
});

test('native English resources include every Chinese key, including recycle confirmations',()=>{
 const flatten=(obj,prefix='',out={})=>{for(const [key,value]of Object.entries(obj))if(value&&typeof value==='object')flatten(value,prefix+key+'.',out);else out[prefix+key]=value;return out};
 const directory=path.join(__dirname,'../storage/overlay/static/locales'),en=flatten(JSON.parse(fs.readFileSync(path.join(directory,'en/translation.json')))),zh=flatten(JSON.parse(fs.readFileSync(path.join(directory,'zh-CN/translation.json'))));
 assert.deepEqual(Object.keys(zh).filter(key=>!(key in en)),[]);for(const [key,value]of Object.entries(en))assert.ok(!/[\u3400-\u9fff]/.test(value),key);
 assert.ok(en['fs.recycle_confirm'].includes('{{- name}}'));assert.ok(en['fs.recycle_multi_confirm']);
});

test('mixed text bindings preserve existing counter elements across language switches',async()=>{
 const ui=languageMenu(),button=labelNode(),counter={nodeType:1,textContent:'2'},text={nodeType:3,nodeValue:'进行中 '};button.childNodes=[text,counter];button.setAttribute('data-air-i18n-text',JSON.stringify([{index:0,source:'进行中 '}]));attachLabels(ui,[button]);
 await ui.context.window.AirI18n.setLanguage('en');assert.equal(text.nodeValue,'Active ');assert.equal(counter.textContent,'2');assert.equal(button.childNodes.length,2);
 await ui.context.window.AirI18n.setLanguage('zh-CN');assert.equal(text.nodeValue,'进行中 ');assert.equal(counter.textContent,'2');
});

test('message translation preserves user text and count inflection does not rewrite paths',async()=>{
 const ui=languageMenu(),api=ui.context.window.AirI18n;await api.setLanguage('en');
 assert.equal(api.message('Unable to open 文件.txt'),'Unable to open 文件.txt');assert.equal(api.format('找到 {count} 项',{count:1}),'Found 1 item');
 assert.equal(api.format('所在目录：{path}',{path:'/1 items/文件.txt'}),'Folder: /1 items/文件.txt');
});
