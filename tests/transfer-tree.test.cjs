const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const source=fs.readFileSync(require('node:path').join(__dirname,'../storage/overlay/static/air-background.js'),'utf8');
const context=vm.createContext({});vm.runInContext(source.slice(source.indexOf('function transferTree('),source.indexOf('function transferIcon(')),context);
const task=(relative,batch=1,type='download',status='ready')=>({relative,name:relative.split('/').pop(),batch,type,status,total:10,bytes:status==='done'?10:2});
test('transfer tree preserves folder hierarchy and standalone files',()=>{const tree=context.transferTree([task('folder/1'),task('folder/2'),task('folder/sub/3'),task('root.txt')]);assert.equal(tree.children.length,2);const folder=tree.children[0];assert.equal(folder.name,'folder');assert.equal(folder.tasks.length,3);assert.equal(folder.children.length,3);assert.equal(folder.children[2].name,'sub');assert.equal(folder.children[2].children[0].task.name,'3');assert.equal(tree.children[1].task.name,'root.txt')});
test('repeat batches and upload/download directories stay independent',()=>{const tree=context.transferTree([task('folder/1'),task('folder/2',2),task('folder/3',1,'upload')]);assert.equal(tree.children.length,3);assert.equal(new Set(tree.children.map(f=>f.key)).size,3)});
test('folder progress includes every file, including beyond the visible limit',()=>{const tasks=Array.from({length:150},(_,i)=>task('folder/'+i,1,'download',i<50?'done':'ready'));const folder=context.transferTree(tasks).children[0],sum=context.transferTotals(folder.tasks);assert.equal(folder.tasks.length,150);assert.equal(sum.total,1500);assert.equal(sum.bytes,700);assert.equal(sum.done,50)});

test('active progress excludes completed, failed, removed and browser-only tasks',()=>{const all=[task('folder/old',1,'download','done'),task('folder/current'),task('folder/failed',1,'download','error'),{...task('removed'),removed:true},{...task('browser'),browserOnly:true}],active=context.transferProgressJobs(all,'active'),sum=context.transferTotals(active);assert.equal(active.length,1);assert.equal(sum.total,10);assert.equal(sum.bytes,2);assert.equal(sum.done,0);const summaries=context.transferFolderSummaries(active),folder=context.transferTree(active).children[0];assert.equal(context.transferTotals(summaries.get(folder.key)).bytes,2);assert.equal(context.transferProgressJobs(all,'done').length,1)});

test('download destinations contain their files and stay distinct even when directory names match',()=>{
 const a={...task('one.txt'),sink:{name:'Downloads'},destinationKey:'a'},b={...task('sub/two.txt',2),sink:{name:'Downloads'},destinationKey:'b'},c={...task('three.txt',3),sink:{name:'Downloads'},destinationKey:'a'};
 const tree=context.transferTree([a,b,c]);assert.equal(tree.children.length,2);assert.equal(tree.children[0].name,'Downloads/');assert.equal(tree.children[0].tasks.length,2);assert.equal(tree.children[0].children[1].task,c);assert.equal(tree.children[1].children[0].name,'sub');assert.equal(tree.children[1].children[0].children[0].task,b);
});
test('unknown-size ZIP downloads retain received bytes in directory summaries',()=>{
 const pending={...task('archive.zip'),archive:true,total:0,bytes:2048,status:'downloading'};
 assert.equal(context.transferTotals([pending]).bytes,2048);
 pending.total=2048;pending.status='done';assert.equal(context.transferTotals([pending]).bytes,2048);assert.equal(context.transferTotals([pending]).done,1);
});
