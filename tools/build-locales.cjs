'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),staticDir=path.join(root,'storage/overlay/static');
const dictionary=JSON.parse(fs.readFileSync(path.join(staticDir,'air-i18n.en.json'),'utf8'));
const runtime=fs.readFileSync(path.join(__dirname,'locales/runtime.js'),'utf8');
const output='(()=>{\nconst dictionary='+JSON.stringify(dictionary)+';\n'+runtime+'\n})();\n';
fs.writeFileSync(path.join(staticDir,'air-i18n.js'),output);
if(process.argv.includes('--live'))fs.writeFileSync(path.resolve(root,'../app/static/air-i18n.js'),output);
console.log('Built '+Object.keys(dictionary).length+' English translations.');
