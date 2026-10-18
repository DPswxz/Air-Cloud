'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function audit(){
 const {translate}=require('../storage/overlay/static/air-i18n.js'),directory=path.join(root,'storage/overlay/static'),context=vm.createContext({});
 const issues=[];let checked=0;
 for(const file of fs.readdirSync(directory).filter(name=>/^(air-|nas-).*\.js$/.test(name)&&name!=='air-i18n.js')){
  const source=fs.readFileSync(path.join(directory,file),'utf8');
  // Inspect literals without executing application code or interpolating user data.
  for(const match of source.matchAll(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g)){
   if(!/[\u3400-\u9fff]/.test(match[0]))continue;
   let value;try{value=vm.runInContext(match[0],context,{timeout:50})}catch{continue}
   checked++;const result=translate(value,'en');
   if(/[\u3400-\u9fff]/.test(result))issues.push({file,line:source.slice(0,match.index).split('\n').length,source:value,result});
  }
 }
 return {checked,issues};
}
module.exports={audit};
if(require.main===module){const result=audit();console.log(JSON.stringify(result,null,2));if(result.issues.length)process.exitCode=1}
