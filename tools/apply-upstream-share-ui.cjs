const fs=require('node:fs'),path=require('node:path');
const root=process.argv[2];if(!root)throw Error('Provide upstream source directory');
function update(name,fn){const file=path.join(root,name);fs.writeFileSync(file,fn(fs.readFileSync(file,'utf8')));}
update('templates/webclient/share.html',s=>s.replace('<form id="share_form" action="{{.CurrentURL}}" method="POST" autocomplete="off">',`<form id="share_form" action="{{.CurrentURL}}" method="POST" autocomplete="off">
<div class="mb-8"><label for="custom_id" class="form-label">自定义分享后缀（可选）</label><input id="custom_id" name="custom_id" class="form-control" maxlength="64" pattern="[A-Za-z0-9_-]{1,64}" value="{{.Share.ShareID}}" {{if not .IsAdd}}readonly{{end}} placeholder="例如：1、photos"><div class="form-text">填写 1，分享链接就是本站域名/1。留空自动生成，只支持字母、数字、下划线和短横线。已有分享后缀不可更改。</div></div>`));
update('templates/webclient/shares.html',s=>{
 const start=s.indexOf('                <div id="readShare"'),end=s.indexOf('                <div id="writeShare"',start);
 if(start<0||end<0)throw Error('Cannot locate native share modal');
 s=s.slice(0,start)+`<div id="readShare" class="mb-5"><p>将链接发给对方，即可打开分享页面。文件夹可浏览并选择下载。</p><div class="d-flex gap-3"><button id="readLinkCopy" type="button" class="btn btn-primary btn-clipboard-copy"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 8h12v13H9V8M5 16H3V3h12v2"/></svg> 复制分享链接</button><a id="readLink" href="#" target="_blank" rel="noopener noreferrer" class="btn btn-light-primary"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/></svg> 打开分享页面</a></div></div>\n`+s.slice(end);
 s=s.replace('if (expiresAt < Date.now())','if (expiresAt > 0 && expiresAt < Date.now())');
 s=s.replaceAll('shareURL + "/download"','"/" + encodeURIComponent(shareID)');
 return s;
});
update('templates/common/base.html',s=>s.replace('</head>','<style>.app-sidebar{box-shadow:6px 0 20px #1c355514,inset -1px 0 5px #1c355508!important}</style>\n</head>'));
update('templates/webclient/files.html',s=>s.replace('{{- define "extra_js"}}',`{{- define "extra_js"}}
{{if not .FileURL}}<script {{if .CSPNonce}}nonce="{{.CSPNonce}}"{{end}}>
setInterval(function(){if(document.hidden||!window.jQuery||!jQuery.fn.dataTable.isDataTable('#file_manager_list'))return;const table=jQuery('#file_manager_list').DataTable();if(!table.rows({selected:true}).count())table.ajax.reload(null,false);},10000);
</script>{{end}}`));
