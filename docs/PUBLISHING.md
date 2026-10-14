# GitHub 首页与首版发布准备

仓库名：`collection-relations`。显示名：`Zotero Collection Relations`。保留原插件 ID 和偏好名称以兼容已有配置。

## 首页内容

仓库根目录 README.md 默认英文，在顶部链接到 README.zh-CN.md；中文版提供返回英文首页的入口。两版面向使用者，顺序是：用途、一张主界面图、核心功能、安装、实际操作、数据来源和限制。开发结构放在 docs/04_ARCHITECTURE.md，内部测试和开发历史不放首页。

docs/assets/ 中的公开图由实际 UI 加载虚构论文产生；英文图存于 docs/assets/en/，中文图保留在 docs/assets/。图注必须保留“示例数据”；不要替换成带私人文献集名称、笔记、账户信息或 Key 的截图。图像和内部页面链接使用仓库相对路径。[GitHub README 说明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes)

## 上传范围

建议单独建立插件仓库，使用 scripts/prepare_github.py 生成的目录。该目录只包含插件源码、通用测试、公开图片和公开说明，不包含论文项目、个人 Zotero 指纹、旧研究材料、内部验收日志或机器专用原生脚本。网页直接上传文件时也应使用这个目录，不要上传外层论文工作区或其 Git 历史。

当前源码的 .gitignore 已排除内部资料；allowlist 导出比手动选文件更容易核对。源码包不包含旧 XPI、安装产物或个人库快照；安装包单独审核后随 GitHub Release 发布。

## 发布前需要作者补充

1. GitHub 用户名与真实仓库地址，用于主页、下载链接和更新配置。当前更新地址使用不可解析的 .invalid 占位，导出时使用 --repo 替换为真实仓库；它不提供下载或自动更新。
2. 项目许可证；先核对代码和图标的来源，再选择并添加 LICENSE。本次没有默认指定 MIT 或其他授权。[GitHub 许可证说明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)
3. 在线查找验收。离线 UI 与本地操作测试不能替代真实 OpenAlex 结果；首版宜作为测试版本，并在 README 保留当前状态。
4. 对照实际发布包确认兼容版本；当前只声明 Zotero 9.x。Windows 已做过原生操作验证，其他平台不能先写“已验证”。

## 仓库 About 建议

描述：将 Zotero 文献集呈现为交互关系图，支持父子集切换、文献阅读与多篇论文检索队列，帮助梳理引用脉络并发现相关研究。

英文描述：Zotero Collection Relations is a plugin that visualizes papers and citation relationships in Zotero collections as an interactive graph, helping users trace research connections and discover references, citing papers, and related research from selected papers.

Topics：zotero、zotero-plugin、literature-review、citation-network、research-discovery、openalex。

首版标签可使用与最终 manifest 一致的版本，例如 v0.8.7，并勾选 Pre-release。上传对应 XPI；不要把介绍页准备完成等同于已经发布插件。
