# Instagram 0.2.0 只读验收

日期：2026-10-22。macOS 26.5.2 arm64、Chrome 156.0.8078.48、OpenCLI 2.0.2、Browser Bridge 1.0.26。用户授权搜索 `seoul cafe` 前 3 条可见结果并读取其中 1 篇，登录由用户本人完成。

## 正式 MCP 实机结果

| 步骤                                   | 结果                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `bridge_doctor(channel:instagram_web)` | 仅返回 Instagram 浏览器适配器；写入 disabled                                                                              |
| `bridge_bind(channel:instagram_web)`   | 固定原 Chrome profile、session、标签页；本次为 user_bound                                                                 |
| `ig_search(query:seoul cafe, limit:3)` | SUCCEEDED；返回 3 条帖子链接与有限预览；partial:true                                                                      |
| 搜索导航回执                           | 上游 command_result_unknown；没有重放导航，核对同一目标的正常搜索路由、查询标题及新文档后返回；navigation_reconciled:true |
| `ig_read_post`                         | SUCCEEDED；读取其中 1 篇帖子说明，198 字符；partial:true、comments:[]                                                     |
| 解除绑定                               | 成功；保留用户标签页                                                                                                      |
| 发布、点赞、关注、评论、私信           | 0；Instagram 没有这些工具                                                                                                 |
| 微信访问                               | 本轮没有调用微信诊断、绑定或业务，也没有启动微信工作者                                                                    |

这是实际 stdio MCP 对真实 Chrome 的调用，不是只跑 jsdom。既有小红书验收另有 3 条搜索结果、1 篇正文成功。

账号绑定为 **user_bound**：用户明确选择刚登录的账号，程序未取得可核实的稳定账号标识；不能将此写成程序已验证账号身份。账号界面标识可识别时仍做摘要及变化核验。没有导出 Cookie、读取本地登录存储或调用 Instagram 私有 API。

## 调试失败与修复

- 两次旧输入事件版本的搜索任务返回 UI_CHANGED，没有返回搜索结果。最终版本使用正常搜索网页 URL，并核对渲染出的查询标题及结果身份。
- 两次正常导航任务因 command_result_unknown 进入 NEEDS_REBIND，调试绑定随后解除，任务保留 CANCELLED。最终只读导航会核对结果页而不重新导航；写操作规则未放宽。
- 首次读帖因未接受文章自身带作者前缀的 permalink 而返回 UI_CHANGED，没有返回正文。修复后将文章的正规作者前缀链接归一为根路径短码链接；评论 permalink 不能充当文章身份。
- 原任务没有被改写为成功。最终正式成功为 1 次搜索、1 次读帖；网页路由和界面结构的单独诊断不另算业务成功。

## 支持范围

搜索只返回当前正常关键词结果页中已加载的帖子，不返回账号/标签检索。读帖限当前已打开或页面已有可见链接的普通帖 / Reel 说明文字，要求 URL 与文章自身的可见时间 permalink 一致；没有唯一正文就失败，不读评论、不转写视频、不滚动采集历史。

不证明所有语言、账号或未来界面均适配，也不证明账号安全策略永不触发。原始账号标识、帖子短码、正文、截图及浏览器 profile 不进入 Git；仓库仅保留脱敏数量和合成 fixtures。
