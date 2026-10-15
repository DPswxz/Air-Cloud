const fs=require('node:fs'),path=require('node:path');
const root=process.argv[2];if(!root)throw Error('Provide customized SFTPGo source directory');
function update(name,fn){const file=path.join(root,name);fs.writeFileSync(file,fn(fs.readFileSync(file,'utf8')));}
update('templates/webclient/share.html',s=>s.replace('  <div class="nas-share-fields">',`  <div class="mb-6"><label for="custom_id" class="form-label">自定义分享后缀 <span class="text-muted">（可选）</span></label><input id="custom_id" name="custom_id" class="form-control" maxlength="64" pattern="[A-Za-z0-9_-]{1,64}" value="{{.Share.ShareID}}" {{if not .IsAdd}}readonly{{end}} placeholder="例如：1、photos、family-2026"><div class="form-text">填写 1，链接就是本站域名/1。只支持字母、数字、下划线和短横线；留空自动生成。{{if not .IsAdd}}已有链接保持不变；如需其他后缀，请新建分享。{{end}}</div></div>
  <div class="nas-share-fields">`));
update('templates/webclient/shares.html',s=>s.replaceAll('复制下载链接','复制分享链接').replaceAll('打开下载','打开分享页面').replaceAll('aria-label="下载链接"','aria-label="分享链接"').replace('将链接发给对方，即可下载分享的文件。','将链接发给对方，即可打开分享页面；文件夹可浏览并选择下载。').replace("origin + shareURL + '/download?compress=false'","origin + '/' + encodeURIComponent(shareID)"));
update('static/nas-ui.js',s=>s.replace('[[/个人信息',"[[/复制|Copy/i,'copy'],[/打开|Open/i,'open'],[/个人信息"));
update('static/nas-ui.css',s=>s+'\n/* Keep the expanded navigation and its handle visually lifted. */\n.app-sidebar{box-shadow:6px 0 20px #1c355514,inset -1px 0 5px #1c355508!important}.nas-sidebar-toggle::before{box-shadow:0 3px 10px #19304b29}\n');
update('templates/common/base.html',s=>s.replace(/nas-ui\.css\?v=[^"']+/g,'nas-ui.css?v=20261015-share2').replace(/nas-ui\.js\?v=[^"']+/g,'nas-ui.js?v=20261015-share2'));
update('templates/webclient/files.html',s=>s.replace('enabled:{{if .IsLoggedToShare}}false{{else}}true{{end}}','enabled:{{if .FileURL}}true{{else}}false{{end}}').replace('{{- define "extra_js"}}',`{{- define "extra_js"}}
{{if not .FileURL}}<script {{if .CSPNonce}}nonce="{{.CSPNonce}}"{{end}}>
setInterval(function(){if(document.hidden||!window.jQuery||!jQuery.fn.dataTable.isDataTable('#file_manager_list'))return;const table=jQuery('#file_manager_list').DataTable();if(!table.rows({selected:true}).count())table.ajax.reload(null,false);},10000);
</script>{{end}}`));
