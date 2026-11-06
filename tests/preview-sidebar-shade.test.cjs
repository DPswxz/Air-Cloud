const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../storage/overlay/static/air-page-preload.js','utf8');
const code=source.slice(source.indexOf('function syncModalShade('),source.indexOf('\nlet shadeAnimation'));
test('native preview shades the persistent sidebar and clears it on close',()=>{
 let open=true;const dialog={},doc={querySelector:selector=>selector.includes('dialog')&&open?dialog:null};
 const shell={contentDocument:{getElementById:()=>({getBoundingClientRect:()=>({width:240})})}};
 const context={sidebarShade:{hidden:true,style:{}},active:{contentDocument:doc,contentWindow:{getComputedStyle:()=>({backgroundColor:'rgba(0, 0, 0, 0.5)',opacity:'1'})}},shell,window:{innerWidth:1280}};
 vm.runInNewContext(code,context);context.syncModalShade();assert.equal(context.sidebarShade.hidden,false);assert.equal(context.sidebarShade.style.width,'240px');assert.equal(context.sidebarShade.style.background,'rgba(0, 0, 0, 0.5)');open=false;context.syncModalShade();assert.equal(context.sidebarShade.hidden,true);
 context.active=shell;context.syncModalShade();assert.equal(context.sidebarShade.hidden,true);
});
