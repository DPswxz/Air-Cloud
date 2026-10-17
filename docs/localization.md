# 界面语言

默认语言为简体中文。登录、注册和页面顶部提供简体中文 / English 切换，选择保存在当前浏览器；切换会重新加载页面，让文件浏览框架、传输状态、对话框和后台设置一起应用新语言。切换前请等待正在进行的传输完成。

管理员原有设置项继续使用 SFTPGo 内置的 `data-i18n` 与英文语言包。自定义界面使用 `window.AirI18n.t()` 和明确标记的 `data-air-i18n` 文案；文件名、路径、用户名、描述和输入框内容保留原文。浏览器系统权限弹窗由浏览器自己的语言设置决定。

英文文案的可读源文件为 `storage/overlay/static/air-i18n.en.json`，运行时代码为 `tools/locales/runtime.js`。修改后执行 `node tools/build-locales.cjs` 生成随部署分发的 `air-i18n.js`；本机开发可加 `--live`。新增静态标签用 `<span data-air-i18n>中文</span>`，静态提示属性用 `data-air-i18n-attrs`，动态文案用 `AirI18n.t()`。服务器错误使用 `AirI18n.message()` 精确翻译，避免改写错误消息中用户自己的文件名。

邮箱验证邮件与找回密码邮件跟随发起请求时的界面语言。语言偏好不改变账号资料或权限。运行 `node --test tests/localization.test.cjs` 检查常用翻译及文件名保护范围。
