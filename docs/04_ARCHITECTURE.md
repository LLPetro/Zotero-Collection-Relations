# 技术架构（0.8.7）

当前实现使用 Zotero 9 的 bootstrapped 插件框架、原生设置面板和经典脚本模块。在线数据源目前只有 OpenAlex；设置层使用 Zotero 本机偏好，不需要额外服务器。

## 目录和责任

```text
bootstrap.js                 插件生命周期、模块加载与失败清理
manifest.json                唯一发布版本与 Zotero 兼容范围
prefs.js                     Zotero 默认偏好种子
src/module-map.js            显式运行模块顺序
src/app/literature-graph.js   应用协调、会话和窗口回调
src/config/settings.js       配置 schema、校验、保存、回滚、脱敏订阅
src/domain/                  纯身份、引用关系和探索状态规则
src/services/                检索编排、缓存、去重与候选排序
src/infrastructure/          OpenAlex 请求、会话文件和关系存储
src/integrations/            Zotero 读取接口与原生设置面板注册
ui/                          图谱、工作台状态、主题和设置页控制器
locale/                      插件本地化资源
icons/                       Zotero 集成图标
scripts/                     打包、离线预览与发布检查
tests/                      领域、服务、存储、配置与界面状态回归
```

`domain` 不调用 Zotero、网络或文件系统。`services` 使用 provider 和本地索引的数据对象；`infrastructure` 执行请求和 IO。`integrations` 集中适配 Zotero API。UI 通过回调和公开配置快照操作，不直接读写 Zotero.Prefs，也不持有已保存的 API Key。

## 图谱阅读与交互

Zotero 主窗口在文献集工具栏提供“关系图”入口，随窗口卸载和插件停用清理。工作台左上角的当前文献集名称是切换入口，下方弹出父子目录树。展开箭头只改变目录显示，双击名称或确认按钮才切换范围。树遵循左右键展开、折叠及上下键移动的键盘操作，搜索保留父路径，并与普通展开状态分开保存。

切换会重建当前窗口中的控制器和内容，不新开窗口；旧控制器取消请求、定时器、监听和设置订阅。原“所属文献集”选择器仍仅作筛选。

会话通过可选的 collectionScope 保存文献集 ID、库 ID 和 key。返回同一文献集复用其会话、队列和探索历史；旧会话仅在名称和根条目集合完全匹配时识别。已匹配的文献可从缓存复用；取消匹配不降级成错误的本地候选。选择器本身不创建空的保存记录。

节点和连线使用可缩放坐标层，标题和作者年份使用独立标注层。标注保持 13px/12px 字号，按缩放和可用空间控制密度；先尝试节点四周的位置，再隐藏拥挤区域的次要标签。选中项、悬停项和检索队列优先。标题按实际字体宽度换行，最多两行；完整标题在悬停预览和详情中显示。

悬停预览不请求外部数据，也不改变网络布局。滚轮缩放，Ctrl＋滚轮切换光标处的重叠条目；Page Up/Page Down 保留键盘切层。关闭或重建窗口会清理预览定时器。

## 中英文界面

ui/messages.js 集中维护文案，ui/i18n.js 提供纯字符串翻译、模板参数、单复数及标记元素的 DOM 更新。动态界面通过 ZLGT 调用，静态 XHTML 仅处理带 data-zlg 标记的插件文案。存储在旧会话中的界面说明可在展示时转换；书目、文献集名称、笔记正文和附件名称不作全文替换。

语言是 SettingsService 的非秘密偏好，支持 auto、zh-CN、en-US。图谱渲染签名纳入界面语言，位置和拓扑签名保持独立，因此切换只更新展示。原生 Fluent 面板提供中英文专用 ID，以支持覆盖 Zotero 界面语言。

## 配置链路

```text
Zotero 设置页 / 工作台设置入口
             ↓
公开配置接口（脱敏快照、更新、订阅）
             ↓
SettingsService（schema 校验、保存失败回滚）
             ↓
Zotero.Prefs（本机持久化）
             ↓
应用与 provider（请求时读取 Key）
```

配置名称、默认值和校验集中在 `src/config/settings.js`；测试验证它与根目录 `prefs.js` 一致。设置更新先验证整个补丁，写入失败时回退已写字段；回退也失败时返回脱敏的 `rollbackIncomplete` 标记。

| 设置 | 生效方式 |
|---|---|
| 界面语言 | auto 根据 Zotero 语言选择；保存后原生入口、设置页和已打开工作台同步更新，不重建控制器或发起查询 |
| OpenAlex Key | 后续网络请求读取当前值；保存不会重新查询已有缓存 |
| 默认结果数量 | 新工作台窗口使用；已显示结果的请求快照和当前草稿数量保留 |
| 节点大小 | 当前打开的工作台通过订阅同步更新 |
| 自动更新被引量 | 前后端均检查；不影响初始文献匹配或手动查找 |
| 演示关系 | 仅控制独立示例图中的虚构连线，不与真实条目关系合并 |
| 会话保存 | 启动时读取，设置页显示状态，不提供切换按钮 |

密钥保存在本机 Zotero 偏好中，不加密；公开快照只返回 apiKeyConfigured。UI 不回填旧密钥，留空保存保留当前密钥，清除操作显式执行。网络认证使用 Authorization Bearer，不把 Key 放进查询 URL；provider 错误信息和响应体会移除当前密钥明文。

writeEnabled 和 mirrorNativeRelated 是保留的历史默认值，当前构建不使用，设置页不显示；关系写入仍被 WRITES_COMPILED=false 编译级限制。

## 生命周期和资源

bootstrap 使用 module-map 加载全部运行代码，等待应用初始化成功后注册窗口入口。初始化失败时释放已注册项；关闭插件时关闭图窗、清理监听、移除设置面板和公开配置接口。

设置页使用 PreferencePanes.register 注册 XHTML 片段。Zotero 在独立 scope 加载设置脚本，片段 onload 经公开接口调用 Zotero_Preferences.getScope 取得控制器；不能假定脚本变量存在于设置窗口全局。此路径已用真实 Zotero 9.0.6 验证。

窗口卸载时取消活动检索、解绑配置订阅和主题监听。队列草稿、已提交请求快照、结果和历史导航独立；设置保存不发起检索，也不重写文献或队列。

## 数据和失败边界

- Zotero 是书目、附件、笔记和文献集的权威来源；插件不改写它们。
- 内部引用来自 OpenAlex 的 referenced_works；相关推荐来自 related_works，不等同于全文相似度。
- 本机会话存储外部元数据、引用边、探索历史和候选状态，不存 API Key、PDF 正文或 Zotero 笔记。
- 429 保留 Retry-After 并提示用户，当前不自动进行指数退避重试；网络失败不清除已显示图谱。
- 存储 schema 和本地条目身份保持兼容；公开回归数据由索引生成，不包含个人文献库记录。

## 参考

- [Zotero 官方插件与设置接口](https://www.zotero.org/support/dev/zotero_7_for_developers#preference_panes)
- [官方 PreferencePanes 实现](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/preferencePanes.js)与[设置页脚本作用域](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/preferences/preferences.js)
- [社区 zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)：借鉴生命周期、设置脚本与业务模块分离；当前项目保留可直接加载的 JS，不引入模板的全部依赖。
