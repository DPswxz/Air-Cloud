const fs=require('node:fs'),path=require('node:path');
const directory=path.resolve(process.argv[2]||path.join(__dirname,'../storage/overlay/static/nas-avatars'));
for(const name of fs.readdirSync(directory).filter(name=>/^avatar-\d+\.svg$/.test(name))){
 const original=fs.readFileSync(path.join(directory,name),'utf8');
 const rules=[...original.matchAll(/\[(fill|stroke|color)="([^"]+)"\]\{\1:([^}]+)\}/g)];
 const light=original.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g,'');
 let dark=light;
 for(const [,attribute,from,to] of rules)dark=dark.replaceAll(attribute+'="'+from+'"',attribute+'="'+to+'"');
 // Newer artwork uses class selectors instead of attribute selectors.
 for(const [,className,fill] of original.matchAll(/\.([\w-]+)\{fill:(#[\da-fA-F]+)\}/g)){
  dark=dark.replace(/<[^>]+>/g,tag=>{
   const classes=tag.match(/\bclass="([^"]*)"/);
   if(!classes||!classes[1].split(/\s+/).includes(className))return tag;
   return /\bfill="[^"]*"/.test(tag)?tag.replace(/\bfill="[^"]*"/,'fill="'+fill+'"'):tag.replace(/(\s*\/?)>$/,' fill="'+fill+'"$1>');
  });
 }
 if(light===dark)throw Error('Missing dark palette: '+name);
 for(const [theme,svg] of [['light',light],['dark',dark]])fs.writeFileSync(path.join(directory,name.replace('.svg','-'+theme+'.svg')),svg);
}
