'use strict';
// Local development only. Never copies databases, secrets, binaries or tunnel settings.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const repo=path.resolve(__dirname,'..'),local=path.join(repo,'.local');
const configPath=path.join(local,'live-sync.json');
if(!fs.existsSync(configPath))throw Error('Create .local/live-sync.json with liveRoot, sourceRoot and upstreamRoot absolute paths. See docs/live-sync.md.');
const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
for(const key of ['liveRoot','sourceRoot','upstreamRoot'])if(!path.isAbsolute(config[key]||''))throw Error(key+' must be an absolute path');
const storage=path.join(repo,'storage'),baseline=path.join(local,'live-sync-baseline');
const read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n').trimEnd()+'\n';
const write=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s)};
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
fs.mkdirSync(local,{recursive:true});const work=fs.mkdtempSync(path.join(local,'sync-work-'));
const patchPath=path.join(storage,'portable.patch'),oldPatch=read(patchPath);
const native=[...new Set([...oldPatch.matchAll(/^diff --git a\/(.+) b\//gm)].map(m=>m[1]).concat('internal/httpd/api_shares.go'))];
for(const rel of native)write(path.join(work,rel),read(path.join(config.upstreamRoot,rel)));
execFileSync('git',['apply',patchPath],{cwd:work,stdio:'pipe',env:{...process.env,GIT_CEILING_DIRECTORIES:local}});
function merge(portable,previous,current,rel){
 if(previous===current)return portable;
 const files=['portable','previous','current'].map(n=>path.join(work,'merge-'+n));
 [portable,previous,current].forEach((s,i)=>write(files[i],s));
 try{return execFileSync('git',['merge-file','-p',...files],{encoding:'utf8',stdio:['ignore','pipe','pipe']})}
 catch{throw Error('Sync conflict in '+rel+'. Resolve the portable adaptation before deployment. No release files were written.');}
}
function replaceFunction(target,live,name){
 const pattern=new RegExp('^func (?:\\(s \\*httpdServer\\) )?'+name+'\\(', 'm');
 function range(s){const match=pattern.exec(s);if(!match)throw Error('Function not found: '+name);const next=s.indexOf('\nfunc ',match.index+1);return [match.index,next<0?s.length:next+1]}
 const [a,b]=range(target),[c,d]=range(live);return target.slice(0,a)+live.slice(c,d)+target.slice(b);
}
const bootstrap={
 'internal/httpd/webclient.go':['handleClientAddSharePost','handleWebClientProfilePost'],
 'internal/httpd/webadmin.go':['handleWebAdminProfilePost'],
 'internal/httpd/api_shares.go':['addShare']
};
const snapshots=[];
for(const rel of native){
 const current=read(path.join(config.sourceRoot,rel)),previous=path.join(baseline,rel);let portable=read(path.join(work,rel));
 if(fs.existsSync(previous))portable=merge(portable,read(previous),current,rel);
 else for(const name of bootstrap[rel]||[])portable=replaceFunction(portable,current,name);
 write(path.join(work,rel),portable);snapshots.push([previous,current]);
}
const updates=[];
for(const file of walk(path.join(storage,'extensions'))){
 const rel='internal/httpd/'+path.basename(file),live=path.join(config.sourceRoot,rel);if(!fs.existsSync(live))continue;
 const current=read(live),previous=path.join(baseline,rel);let portable;
 if(fs.existsSync(previous))portable=merge(read(file),read(previous),current,rel);
 else portable=path.basename(file).startsWith('nas_recycle')?read(file):current;
 updates.push([file,portable]);snapshots.push([previous,current]);
}
function portableAsset(rel,data){
 if(!/\.(js|html|css|json|svg)$/.test(rel))return data;
 return data.toString('utf8').replace(/\r\n/g,'\n')
 .replace("window.location.hostname === '127.0.0.1' ? getCurrentURI() : 'https://dpstools02.duckdns.org'",'getCurrentURI()')
 .replaceAll('请打开 https://dpstools02.duckdns.org/?local=1 后重试。','请通过自己的 HTTPS 域名或本机 localhost 地址访问后重试。')
 .split('\n').map(line=>line.replace(/^[\t ]+/,indent=>indent.replaceAll('\t','    ')).trimEnd()).join('\n').trimEnd()+'\n';
}
const overlay=path.join(storage,'overlay');
const assets=new Set(walk(overlay).map(p=>path.relative(overlay,p)));
for(const file of walk(path.join(config.liveRoot,'app/static/nas-avatars')))assets.add(path.relative(path.join(config.liveRoot,'app'),file));
for(const rel of assets){const live=path.join(config.liveRoot,'app',rel);if(fs.existsSync(live))updates.push([path.join(overlay,rel),portableAsset(rel,fs.readFileSync(live))])}
let patch='';
for(const rel of native){
 write(path.join(work,'old',rel),read(path.join(config.upstreamRoot,rel)));write(path.join(work,'new',rel),read(path.join(work,rel)));
 let diff='';try{diff=execFileSync('git',['diff','--no-index','--','old/'+rel,'new/'+rel],{cwd:work,encoding:'utf8',stdio:['ignore','pipe','pipe']})}catch(e){if(e.status!==1)throw e;diff=e.stdout}
 patch+=diff.replace(/^diff --git a\/old\//gm,'diff --git a/').replace(/ b\/new\//g,' b/').replace(/^--- a\/old\//gm,'--- a/').replace(/^\+\+\+ b\/new\//gm,'+++ b/');
}
if(!process.argv.includes('--check')){
 for(const [file,data]of updates)write(file,data);
 write(patchPath,patch);
 for(const [file,data]of snapshots)write(file,data);
}
console.log((process.argv.includes('--check')?'Checked':'Synchronized')+' '+updates.length+' managed assets/extensions and '+native.length+' native source patches. Git push is never automatic.');
