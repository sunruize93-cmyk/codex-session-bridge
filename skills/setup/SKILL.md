---
name: session-bridge-setup
description: 安装、诊断小红书与 Instagram 浏览器会话桥，微信为需明确选择的实验适配器。
---

用中文。先 bridge_doctor 并指定所选 channel（instagram_web 或 xiaohongshu_web）。默认仅浏览器，未经明确微信授权禁止 channel:wechat_macos，不运行微信工作者。不自动登录或新建 profile。按 README 安装插件；浏览器功能只需 Node、Python 3 系统锁、Chrome/扩展，不要求微信、PyObjC 或系统 AX 权限。

0.2.0 含 20 个工具，Instagram 仅 ig_search 与 ig_read_post，无写入接口。安装后分别核对工具发现、对应渠道连接及业务。COORDINATOR_UPGRADE_REQUIRED 表示旧协调进程被版本封套安全拒绝；先检查本插件未决任务并安全重启，不调用旧业务 doctor、不回退协议、不删库绕过。更新后重开 Codex 对话。

doctor 的微信分支仅检查元数据，不访问应用 AX 树；controls_checked:false 不能解释为未授权或读取成功。不要在只测试浏览器时反复探测微信。安全重登不是重复开权限可以解决的问题；出现后停止业务，不把再次人工登录计为故障已修复。

仅在用户明确选择屏幕只读时使用 read_only_backend:screen、user_bound:true、expected_chat。要求用户手动打开独立聊天窗口并保持前台；不前置、不输入、不用 AX。录屏权限也不能越过窗口禁止共享；SCREEN_CAPTURE_RESTRICTED/EMPTY 时停止，不切换后端反复试探。该模式依赖 Apple ScreenCaptureKit/Vision，需支持 SCScreenshotConfiguration 的系统；本机仅验 macOS 26。

绑定用户当前选中的已有窗口。浏览器 profile 必须来自 doctor 的真实列表。识别不到账号时，只有用户明确表示已选择当前账号，才使用 user_bound:true，并说明它不是程序已核验身份。草稿与实际发送分开。

默认实际提交关闭；只有用户要求配置后，才执行本地 CLI write-mode trusted-host。它表示信任个人 Codex 宿主，不是授权证明。当前任务若未授权发送、评论或发布，不调用提交工具。

安装成功分开核对：构建、MCP 注册、实际 tools/list/call、桌面插件发现、扩展连接、账号业务功能。manifest 或 codex mcp list 不等于真实账号通过。
