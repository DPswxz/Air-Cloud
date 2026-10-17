const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {translate,dictionary}=require('../storage/overlay/static/air-i18n.js');
test('custom UI translations cover auth, transfers, recycle bin and administration',()=>{
 for(const text of ['用户名/邮箱','邮箱已被注册，请直接登录','头像设置','传输列表','回收站','全部文件','已完成','验证并注册','高级设置']){assert.ok(dictionary[text],text);assert.ok(!/[\u3400-\u9fff]/.test(translate(text)),text)}
 assert.equal(translate('用户名/邮箱','zh-CN'),'用户名/邮箱');assert.equal(translate('Private-file.mdx'),'Private-file.mdx');assert.equal(translate('  已完成 '),'  Completed ');
 assert.equal(translate('<button title="选择头像">头像设置</button>'),'<button title="Choose an avatar">Avatar settings</button>');
});
test('authored labels are localized without globally rewriting filenames or input values',()=>{
 const runtime=fs.readFileSync(path.join(__dirname,'../tools/locales/runtime.js'),'utf8');assert.ok(runtime.includes('[data-air-i18n]'));assert.ok(!runtime.includes("document.createTreeWalker(document.body"));assert.ok(!runtime.includes('.value=api.t'));
 const files=fs.readFileSync(path.join(__dirname,'../storage/overlay/templates/webclient/files.html'),'utf8');assert.ok(!files.includes('upload_files_empty_button'));assert.ok(files.includes('dropzone.addFile(selected)'));
});
