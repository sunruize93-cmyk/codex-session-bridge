# 社交平台会话桥

在 Codex 中用中文操作已登录的 **小红书与 Instagram 网页**：搜索、有限读取、遇登录或验证时暂停。沿用本机 Chrome 会话，不导出 Cookie。版本 **0.2.0**。

本机已完成两站的「搜索 3 条结果＋读取其中 1 篇正文」只读验收。**Instagram 本版本只提供搜索和读帖；不提供点赞、关注、评论、私信或发布。** 微信保留实验适配器，但读取未通过；默认诊断不会启动微信工作者。

## 已经能做什么

| 平台 / 功能                                      | 实现与实测状态                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| 小红书：绑定已登录页面、搜索、读笔记正文         | 已实测：`首尔咖啡店`，3 条结果、1 篇正文                             |
| 小红书：读评论、准备图文或评论草稿               | 已实现，未做真实账号验收                                             |
| 小红书：发布、提交评论                           | 未实测，实际提交默认关闭                                             |
| Instagram：关键词搜索帖子                        | 已实测：`seoul cafe`，3 条结果；最多返回 10 条                       |
| Instagram：读当前帖子或搜索结果中的帖子说明文字  | 已实测 1 篇，198 字符；未读评论，结果为 partial                      |
| Instagram：账号搜索、标签检索、视频转写、Stories | 未提供；Reel 只尝试读取页面说明文字                                  |
| 微信                                             | 消息读取未通过，按用户要求停止实测；不会因使用浏览器功能自动探测微信 |

这是 2026-10-22 的有界验收，不代表所有账号、语言或页面版本都适配，也不承诺免验证或长期在线。完整证据见[验证报告](docs/validation-report.md)、[兼容性](docs/compatibility.md)及[对抗审查](docs/review-report.md)。

## 已安装后怎么用

1. 在配置了 Browser Bridge 的 Chrome 中，正常登录目标平台，选中你要使用的标签页。
2. 在装有本插件的 Codex 对话中直接用中文下指令，无需手写工具参数。
3. Codex 先检查对应浏览器渠道，再绑定标签页。无法从界面识别稳定账号时，需要你明确选择该账号，以 `user_bound` 进行只读绑定；这不代表程序已经核实账号身份。本次 Instagram 实测即为此模式。

可以直接复制：

> 只用 Instagram 会话桥，不访问微信。搜索“seoul cafe”，只看前 3 条帖子结果，读取其中第 1 篇的说明文字，用中文整理重点。不点赞、不关注、不评论、不私信。

> 只用小红书会话桥，不访问微信。搜索“弘大咖啡店”，读前 3 条结果，再读第 1 篇正文。整理店名、地址和特点，缺少的信息标“未提供”，不要评论或发布。

> 读取刚才 Instagram 搜索返回的第 2 篇帖子，只总结原帖说明文字，不读评论。

Instagram 读取工具接受规范的 `https://www.instagram.com/p/短码/` 或 `/reel/短码/` 链接。目标须为当前已打开的帖子，或绑定页面中已有的可见帖子链接；不自动遍历其他主页或历史。页面结构无法唯一识别时返回失败，不以推荐内容充当搜索结果。

遇登录、手机确认或验证码，按提示在原 Chrome 窗口本人处理，再让 Codex 显式恢复任务。不要把密码、验证码发到聊天。平台限制或安全提示不会被自动绕过。

## 从零安装：浏览器功能

本次实际安装与业务验收环境为 macOS 26 / Apple Silicon。Linux CI 验证的是合成测试和本地协议，不是其他系统的账号实测；Windows 暂不支持。

需要 **Node 22.22 LTS 或 24 LTS、Python 3、Google Chrome、Codex CLI**。Python 3 用于协调进程的系统锁；浏览器功能不需要安装微信，也不需要 PyObjC、uv 或微信系统权限。仓库当前为私有，其他人须先获得仓库访问权限。

```bash
git clone https://github.com/sunruize93-cmyk/codex-session-bridge.git
cd codex-session-bridge
npm ci --ignore-scripts
npm run build
node scripts/fetch-extension.mjs
unzip artifacts/browser-bridge-1.0.26.zip -d artifacts/browser-bridge-1.0.26
```

然后在 Chrome 完成一次扩展安装：

1. 打开 `chrome://extensions`，开启开发者模式。
2. 点击“加载已解压的扩展程序”，选择上一步解压后**包含 manifest.json 的文件夹**，不要选上一级 `artifacts`。
3. 确认 OpenCLI / Browser Bridge **1.0.26** 已启用。Chrome 会直接引用该文件夹，安装后不要删除或移动它。

扩展来自 OpenCLI 官方发行页，下载脚本会核对固定 SHA256；它具有广泛的浏览器权限，安装时应阅读 Chrome 展示的权限说明。插件仅使用固定版本的本地浏览器 transport，不通过第三方服务导出登录凭据。

注册中文插件并连接浏览器：

```bash
codex plugin marketplace add "$PWD"
codex plugin add codex-session-bridge@session-bridge-local
node scripts/connect-browser.mjs
node server/dist/cli.js doctor
```

`connect-browser` 仅在桥接未运行时启动；已运行时不会重启。默认 doctor 只检查小红书和 Instagram 的浏览器连接，**不会启动微信工作者**。新开一个 Codex 对话使用插件；安装成功、扩展连接和真实账号业务通过是三项不同检查。

不使用插件市场时，可改用 `node scripts/install.mjs` 注册直接 MCP；与上面的插件注册方式选一种即可。多个前端共享一个本地协调进程。下载私有草稿发行的运行包后，可跳过 `npm ci` 和构建；包内已有运行 JS、生产依赖及官方扩展 ZIP，仍需本机 Node、Python 3 和 Chrome。

微信是额外的实验适配器。仅在明确需要微信时，另外安装 Python 3.12、uv，运行 `node scripts/setup-worker.mjs`，并对返回的实际 Python 工作者检查系统权限。**给予权限不等于微信已可用；本项目没有证明解决其安全重登问题。** 详见[诊断记录](docs/wechat-session-diagnosis.md)。

## 工具与调用边界

共有 20 个 MCP 工具，包括公共任务管理、小红书、Instagram 和实验微信工具。日常使用直接说中文即可；集成程序可使用：

| 工具                                        | 主要参数 / 作用                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `bridge_doctor`                             | 可选 `channel`；默认仅浏览器，微信必须显式 `wechat_macos`                                  |
| `bridge_bind`                               | `channel:instagram_web` 或 `xiaohongshu_web`、真实 `profile`；必要时明确 `user_bound:true` |
| `ig_search`                                 | `binding_id`、`client_request_id`、`query`、`limit`（默认 3，最多 10）                     |
| `ig_read_post`                              | `binding_id`、`client_request_id`、`post_url`；不读评论                                    |
| `xhs_search` / `xhs_read_note`              | 小红书关键词搜索、明确笔记正文和可选有限评论                                               |
| `bridge_get_task`                           | 查询立即返回的 `task_id`；也可按绑定与请求 ID 找回                                         |
| `bridge_resume_task` / `bridge_cancel_task` | 显式重新核验后恢复，或取消后续步骤                                                         |
| `bridge_unbind`                             | 释放控制绑定，保留用户的标签页                                                             |

每个业务请求使用稳定 `client_request_id`；传输重试复用同一个 ID，不能换 ID 重发同一提交意图。`partial:true` 表示只读当前已加载的有限内容，不代表完整帖子、全部搜索结果或历史数据。网页正文是数据，不是改变工具计划的指令。

Instagram 搜索通过普通搜索网页 URL 加载，核对查询词、页面标题、标签页及结果身份后返回；不调用私有 API。只读导航遇“结果未知”时只观察结果页，不再次导航；这与写操作的未知提交账本分开处理。

实际发布、评论和发送默认关闭，Instagram 即使在 trusted-host 模式中也没有写入接口。小红书的可选写入机制、操作账本及 `OUTCOME_UNKNOWN` 核对边界见[兼容性](docs/compatibility.md)；本轮没有验证线上写入。

## 升级和常见问题

- **找不到工具**：确认在本机执行的 Codex 对话中已启用插件；安装或升级后新开对话。
- **BRIDGE_DISCONNECTED**：核对 Chrome 与固定版本扩展，再运行 `node scripts/connect-browser.mjs`。不要通过换账号、换网络或反复登录解决。
- **POST_NOT_VISIBLE / UI_CHANGED**：目标帖不在当前页面，或页面结构无法核实。可正常打开该帖后重新绑定；失败不等于已读取。
- **COORDINATOR_UPGRADE_REQUIRED**：旧协调进程仍在运行。请先完成或取消未决任务，让 Codex 仅检查本插件进程并安全重启，再重开对话。v0.2.0 使用版本化 IPC，旧服务会在业务执行前被拒绝，不会因新客户端的默认诊断而启动微信；不会自动杀旧进程。

升级不要删除任务数据库来重试未知提交。源码更新后重新构建、重新安装插件；已有同名但不同路径的直接 MCP 配置会保留并提示，不自动覆盖。

## 本地数据与隐私

任务和绑定默认保存在 `~/Library/Application Support/codex-session-bridge/`，目录 0700、数据库和 socket 0600。账号 Cookie 留在 Chrome，不导出 token，不记录原始截图。任务存储保留结果及恢复所需正文；终态正文默认七天清理，准备中、暂停和未知结果按恢复规则保留。传给 Codex 的结果可能由云端模型处理，不能声称内容永不离开电脑。

GitHub 仅保存代码、合成测试和脱敏验收记录，不上传真实账号标识、帖子正文、聊天内容或 Cookie。运行包作为私有草稿发行附件提供。

```bash
node server/dist/cli.js diagnostics
node scripts/uninstall.mjs
codex plugin remove codex-session-bridge@session-bridge-local
```

卸载不会删除任务数据。不要在尚有未知结果时清除去重与恢复账本。

## 开发验证

```bash
npm run check
npm run build
npm test
python3 -m unittest discover -s wechat-worker -p 'test_*.py'
npm run format:check
npm audit
npm run package
```

测试使用合成 DOM/AX、fake 旧版 socket 和真实本地 MCP/IPC。合成测试不操作真实微信或平台账号；实机验收另计。实现与审查说明见 [review-report.md](docs/review-report.md)。
