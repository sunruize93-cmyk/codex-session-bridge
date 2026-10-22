# 小红书与微信会话桥

中文 Codex 本地插件：绑定已有登录窗口，串行操作，遇验证暂停，结果未知时先核对、禁止重发。代码、安装与故障测试已交付；**尚未证明解决原先掉线或验证码问题**。

## 当前状态

- P0：18 个工具的 MCP 服务、Unix socket 单协调进程、OS 锁、持久任务、搜索/有限读取适配、暂停/恢复/取消与 doctor。
- P1：图文/评论/微信文字草稿、宿主授权范围、提交账本、防重复发出与条件式结果核对。平台控件或稳定身份缺失时拒绝提交；实际发送、发布、评论均未验证。
- Codex：MCP、本地插件已安装；当前桌面聊天已真实加载并调用插件工具。
- 本机：Chrome 156.0.8078.48、OpenCLI 2.0.2、Browser Bridge 1.0.26 已连接；小红书正式工具完成 3 条搜索结果和 1 篇正文读取。
- 微信：已按用户授权更新至官方 4.1.15（270135），旧版完整备份。更新前无 AX/无输入对照保持登录，但窗口捕获全透明；新版窗口仍标记不可共享，最后一次正式绑定未通过目标核验，未截图或读到消息。用户要求最后一次后已停止微信实测。**微信原问题尚未证明解决**，详见[重登诊断](docs/wechat-session-diagnosis.md)。

完整证据：[验证报告](docs/validation-report.md)、[兼容性](docs/compatibility.md)、[对抗审查](docs/review-report.md)。不承诺免验证、永久在线或平台端 exactly-once。

## 安装

要求 Node 22.22 LTS 或 24 LTS、Python 3.12、uv、Codex CLI。源码安装：

```bash
npm ci --ignore-scripts
npm run build
node scripts/setup-worker.mjs
node scripts/install.mjs
npm run doctor
```

打包版本包含可运行 JS、生产 node_modules 与 macOS Python wheelhouse；解压后不需再次构建，运行 `node scripts/setup-worker.mjs` 安装本机工作者，再执行 install。Python 解释器、Node、uv 和 Chrome 仍是系统前置条件。Apple Silicon 与 Intel 的工作者 wheel 标记为 universal2；本次运行包只验收 Apple Silicon。

安装器用绝对 Node/文件路径注册 `session-bridge`，保留其他配置；同名不同配置会停止并说明。配置备份只写用户私有数据目录。`node scripts/uninstall.mjs` 仅移除属于此副本的 MCP 配置。

也可通过本地插件源安装中文技能与 MCP：

```bash
codex plugin marketplace add /你的绝对路径/codex-session-bridge
codex plugin add codex-session-bridge@session-bridge-local
```

直接 MCP 和插件方式选一种即可；多个前端仍共享协调进程。不要改动工具审批或全局安全设置。

## 首次连接

1. 小红书：安装本地 Chrome 和上游官方 Browser Bridge **1.0.26**，在你选择的 profile 正常登录一次。运行 `node scripts/connect-browser.mjs` 启动未运行的本地桥接，再用 doctor 检查扩展。已运行时不会重启桥接。官方扩展包可用 `node scripts/fetch-extension.mjs` 下载并验证摘要，解压后在 Chrome 的扩展开发者模式中手动加载 **manifest.json 所在的子文件夹**。选择上一级目录会报“清单文件缺失”。插件的 doctor 只观察，不自动启动 Chrome 或登录。
2. 微信原生模式：系统设置 → 隐私与安全性 → 辅助功能，允许实际工作进程使用 AX。`bridge_doctor` 返回 `worker_executable`，应核对它，而不是仅凭终端已授权推定可用。实验性屏幕只读模式另用系统录屏与本地 OCR，不访问 AX；已授权也可能遇窗口禁止共享。
3. 新 Codex 会话中说：“用会话桥检查环境，绑定我当前选择的小红书标签页/微信窗口。”账号读不出来时，可明确绑定当前窗口为 user_bound，只读和草稿能力仍取决于控件；发送还要求稳定账号与接收者证据。

微信当前版本没有通过消息控件与稳定身份验收，给予 AX 权限不等于可用；安全重登时停止操作。小红书新版搜索框、双重编码路由、同一卡片的封面/标题链接已适配并做一次实机只读验收；创作中心和实际写入仍未验收。

## 操作示例

- “在已绑定小红书页搜索咖啡店，只读前 3 个结果，再读我选的一篇。”
- “定位微信里的文件传输助手，读取当前可见的最后 5 条；不要发送。”
- “我已手动打开文件传输助手独立窗口并保持前台；用屏幕只读模式读取最多 3 行，不点击。”绑定参数为 `channel:wechat_macos`、`user_bound:true`、`read_only_backend:screen`、`expected_chat:文件传输助手`。标题、窗口唯一性或共享状态不符时停止；不自动改用 AX。OCR 只返回 `text_lines`，不承诺一行对应一条消息。
- “给指定聊天准备这段文字草稿，不发送。”

每次业务请求提供稳定 `client_request_id`；`bridge_get_task` 查询任务，传输重试复用同一 ID。任务接口立即返回，等待人工不会阻塞 MCP。

`NEEDS_HUMAN` / `NEEDS_LOGIN`：在原窗口处理，完成后 `bridge_resume_task`。取消不会解除平台验证；显式恢复可重新检查并释放人工接管，也可解绑定，用户窗口不会关闭。

`OUTCOME_UNKNOWN`：只调用 `bridge_reconcile_operation` 核对。即使换请求 ID，同一 operation 也不再次提交。没有可靠新标识则继续保留未知。若不再阻断，可显式 resume 重新观察后释放前台；这不会重放未知提交。

实际写入默认关闭。你明确需要时，本地执行：

```bash
node server/dist/cli.js write-mode trusted-host
```

这只表示信任个人 Codex 宿主理解你的发送/发布授权。stdio 服务看不到原始用户消息，scope_ref 不是密码学批准票据。提交只能消费 prepare 返回的 operation_id、版本和摘要，不能另传正文。修改草稿产生新操作，旧版本不提交。关闭写入用 `write-mode disabled`。

## 本地数据、诊断与卸载

数据默认在 `~/Library/Application Support/codex-session-bridge/`，目录 0700、SQLite/socket 0600。Cookie 留在 Chrome；不导出 token；不记录原始页面或截图；任务存储保留恢复所需正文。传给 Codex 的结果可能被云端模型处理，不能声称内容永不离开电脑。

```bash
node server/dist/cli.js diagnostics
node server/dist/cli.js purge
node server/dist/cli.js forget-payload OPERATION_ID
node scripts/uninstall.mjs
```

终态正文默认七天清理，保留最小去重墓碑；PREPARED、暂停、未知结果保留到人工处理。forget-payload 会删除该操作及关联任务中的正文，保留去重账本；准备中的操作会过期，未知操作不再能做正文核对。不要通过删库后重建操作来“重试”未知提交。

插件卸载另用 `codex plugin remove codex-session-bridge@session-bridge-local`。移除插件不会删除任务存储。若确实要删除整个私有目录，先停止本插件协调进程并确认没有未决副作用；这会永久丢失恢复/去重信息。备份配置不自动覆盖恢复，避免抹掉之后的配置变化。

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

测试使用合成 DOM/AX 与真实本地 MCP/IPC，和平台实测分开计数。测试不登录、不发送、不发布。
