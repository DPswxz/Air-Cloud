const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../storage/overlay/static/air-background.js'),'utf8');
function setup({cancel=false,exists=false,overwrite=true}={}){
 const calls={picked:0,pumped:0,shown:0,manifest:0,alerts:[],written:[]};
 const sink={name:'Downloads',async getFileHandle(){if(!exists)throw Object.assign(Error(),{name:'NotFoundError'});return {}}};
 const context={resumeReady:Promise.resolve(),resumeEngine:{async prepare(){}},owner:'user',config:{share:true},jobs:[],batchSequence:0,sequence:0,window:{isSecureContext:true,showDirectoryPicker(){},AirI18n:{t:s=>s}},
  async defaultDownloadFolder(){calls.picked++;if(cancel)throw Object.assign(Error(),{name:'AbortError'});return sink},
  async manifest(){calls.manifest++;throw Error('Single files must not request a batch manifest')},validURL:u=>new URL(u,'https://nas.test'),
  show(){calls.shown++},notice(){},render(){},pumpDownloads(){calls.pumped++},alert:s=>calls.alerts.push(s),confirm:()=>overwrite};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('async function enqueueDownloads('),source.indexOf('\nfunction pumpDownloads(')),context);
 return {context,calls,sink};
}
test('single file uses the batch folder flow and a visible streaming task',async()=>{
 const {context,calls,sink}=setup();await context.enqueueFile({owner:'user',name:'报告.txt',url:'/file?path=%2Freport',size:42});
 assert.equal(calls.picked,1);assert.equal(calls.manifest,0);assert.equal(calls.pumped,1);assert.equal(calls.shown,1);
 assert.equal(context.jobs.length,1);const job=context.jobs[0];assert.equal(job.sink,sink);assert.equal(job.browserOnly,false);assert.equal(job.relative,'报告.txt');assert.equal(job.total,42);assert.equal(job.publicShare,true);
});
test('cancelled folder picker and declined overwrite create no download',async()=>{
 for(const options of [{cancel:true},{exists:true,overwrite:false}]){const {context,calls}=setup(options);await context.enqueueFile({owner:'user',name:'a.txt',url:'/file'});assert.equal(context.jobs.length,0);assert.equal(calls.pumped,0);assert.equal(calls.alerts.length,0)}
});
test('single file rejects account changes and unsafe destination names',async()=>{
 const {context}=setup();await assert.rejects(context.enqueueFile({owner:'other',name:'a.txt',url:'/file'}));
 for(const name of ['..','../a','a/b','a\\b'])await assert.rejects(context.enqueueFile({owner:'user',name,url:'/file'}));
 assert.equal(context.jobs.length,0);
});
test('batch manifests containing nested JavaScript switch the whole selection to ZIP',async()=>{
 for(const name of ['jquery.js','SCRIPT.JS']){
  const {context,calls}=setup();let archived;
  context.manifest=async()=>({files:[{name,relative:'nested/'+name}],directories:['nested']});
  context.enqueueArchive=async data=>{archived=data};
  await context.enqueueDownloads({owner:'user',url:'/web/client/download',files:['nested','photo.jpg']});
  assert.deepEqual(archived.files,['nested','photo.jpg']);assert.equal(context.jobs.length,0);assert.equal(calls.pumped,0);
 }
});
