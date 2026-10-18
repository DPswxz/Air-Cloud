# 中英文界面维护

原生界面的语言资源位于 `storage/overlay/static/locales/en` 和 `zh-CN`。英文资源必须包含中文资源的所有键，保留原有插值字段（例如 `{{- name}}`）。修改后更新 `templates/common/base.html` 的 i18next `defaultVersion`，避免浏览器继续使用旧缓存。

自定义文案维护在 `storage/overlay/static/air-i18n.en.json`，运行时源文件是 `tools/locales/runtime.js`。不要直接编辑生成的 `air-i18n.js`。执行 `node tools/build-locales.cjs` 生成部署资源；本机工作区使用 `--live` 同时生成本机资源。

- `AirI18n.t` 用于固定的界面文案；HTML 片段会记录原始文案，切换语言不改变现有控件结构。
- `AirI18n.format` 用于带参数的文案，参数作为原始数据处理，不翻译文件名、路径等用户内容。
- `AirI18n.bindText(element, source, values)` 用于动态提示和统计，保留原始文案及参数，可双向切换语言。
- `AirI18n.bindMessage` 用于已生成的提示或服务端信息，仅转换已知文案，未知内容保持原样。
- 用 `data-air-i18n-skip` 标识用户内容。不要通过全局替换网页正文实现翻译。
- 更新脚本引用的版本号；原生页面壳和注册页也有脚本引用。部署本机前同步源码，重启前检查活动连接。

运行 `npm run audit:locales` 检查自定义脚本文案是否完整转换为英文，运行 `npm test` 检查原生资源键、动态提示、无刷新切换、计数和用户内容保护。新增加的中文提示应一并加入英文词典和相应功能的切换测试。
