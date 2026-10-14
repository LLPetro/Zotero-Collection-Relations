# 开发约定

版本由 manifest.json 管理；默认偏好放根目录 prefs.js，配置 schema 和运行校验由 src/config/settings.js 管理，二者一致性纳入测试。

新增运行模块必须加入 src/module-map.js，保持依赖顺序。领域规则使用纯数据对象；Zotero API 放 integrations，网络和文件 IO 放 infrastructure，编排放 services，窗口回调放 app，界面代码放 ui。

新增设置通过 SettingsService 读取和保存；UI 使用公开脱敏接口，不能直接读写 Prefs。密钥不写日志、会话或代码。自动测试只使用明确的模拟凭据，不读取开发者的个人设置。

使用 Node 22+ 和 Python 3；构建无需 npm install，package.json 仅提供开发命令：

```bash
npm test
npm run test:ui
npm run build
```

UI 检查需要已有 Playwright 和 Chrome。新增业务逻辑应验证失败路径与跨窗口配置效果；原生设置脚本通过 Zotero 的 pane scope 初始化。插件注销要清理窗口、面板、监听和公开接口。

XPI 构建只包含 manifest、bootstrap、prefs、src、ui、icons 和 locale。公开测试只使用虚构数据。运行结构见 docs/04_ARCHITECTURE.md。

当前为本地开发构建。开发构建的更新地址使用不可解析的 .invalid 域名；正式发布前通过导出参数 --repo 设置真实主页和更新地址。

公开源码使用以下命令导出并检查；输出目录必须不存在。设置 --repo 前先确认仓库归属，许可证另行确定。

```bash
python3 scripts/prepare_github.py --output /tmp/collection-relations-source
python3 scripts/check_publication.py /tmp/collection-relations-source
```

发布检查覆盖文件范围、常见密钥格式、本机路径和图片元数据；它不能替代图片内容、代码来源及已有 Git 历史的人工审查。
