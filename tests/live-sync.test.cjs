const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
test('live sync preserves portable adaptations, merges later edits, and refuses conflicts before writing',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nas-sync-')),repo=path.join(root,'repo'),live=path.join(root,'live'),source=path.join(root,'source'),upstream=path.join(root,'upstream');
 const write=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s)};
 const native='internal/sample.go',initial=Array.from({length:24},(_,i)=>'line '+i).join('\n')+'\n';
 write(path.join(upstream,native),initial);write(path.join(source,native),initial);
 const api='internal/httpd/api_shares.go';write(path.join(upstream,api),'func addShare() {\n old()\n}\n');write(path.join(source,api),'func addShare() {\n current()\n}\n');
 const patch='diff --git a/internal/sample.go b/internal/sample.go\n--- a/internal/sample.go\n+++ b/internal/sample.go\n@@ -21,4 +21,4 @@\n line 20\n line 21\n line 22\n-line 23\n+portable storage\n';
 write(path.join(repo,'storage/portable.patch'),patch);
 write(path.join(repo,'storage/extensions/nas_recycle_other.go'),'portable platform guard\n');write(path.join(source,'internal/httpd/nas_recycle_other.go'),'local platform guard\n');
 write(path.join(repo,'storage/overlay/static/ui.js'),'old UI\n');write(path.join(live,'app/static/ui.js'),'new UI\n');fs.mkdirSync(path.join(live,'app/static/nas-avatars'),{recursive:true});
 write(path.join(repo,'.local/live-sync.json'),JSON.stringify({liveRoot:live,sourceRoot:source,upstreamRoot:upstream}));
 const script=path.join(repo,'tools/sync-live.cjs');write(script,fs.readFileSync(path.join(__dirname,'../tools/sync-live.cjs')));
 const run=(...args)=>execFileSync(process.execPath,[script,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 run('--check');assert.equal(fs.readFileSync(path.join(repo,'storage/overlay/static/ui.js'),'utf8'),'old UI\n');
 run();assert.equal(fs.readFileSync(path.join(repo,'storage/extensions/nas_recycle_other.go'),'utf8'),'portable platform guard\n');
 write(path.join(source,native),initial.replace('line 1\n','updated line 1\n'));run();
 const output=fs.readFileSync(path.join(repo,'storage/portable.patch'),'utf8');assert.ok(output.includes('+updated line 1'));assert.ok(output.includes('+portable storage'));assert.ok(output.includes('+ current()'));
 write(path.join(repo,'storage/portable.patch'),output.replace('+updated line 1','+portable line 1'));
 write(path.join(source,native),initial.replace('line 1\n','conflicting live line 1\n'));write(path.join(live,'app/static/ui.js'),'should not write\n');
 assert.throws(()=>run(),/Sync conflict/);assert.equal(fs.readFileSync(path.join(repo,'storage/overlay/static/ui.js'),'utf8'),'new UI\n');
 // Test fixtures are deliberately retained in the OS temporary directory for diagnostics.
});
