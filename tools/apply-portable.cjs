'use strict';
// Apply to a clean checkout of the pinned SFTPGo source. Requires Git and Node.js.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const source=process.argv[2];if(!source)throw Error('Usage: node tools/apply-portable.cjs <sftpgo-source>');
const root=path.resolve(source),storage=path.resolve(__dirname,'../storage');
execFileSync('git',['apply','--check',path.join(storage,'portable.patch')],{cwd:root,stdio:'inherit',env:{...process.env,GIT_CEILING_DIRECTORIES:path.dirname(root)}});
execFileSync('git',['apply',path.join(storage,'portable.patch')],{cwd:root,stdio:'inherit',env:{...process.env,GIT_CEILING_DIRECTORIES:path.dirname(root)}});
fs.cpSync(path.join(storage,'extensions'),path.join(root,'internal/httpd'),{recursive:true});
fs.cpSync(path.join(storage,'overlay'),root,{recursive:true});
console.log('Portable NAS patches and assets applied. Build with Go 1.26+.');
