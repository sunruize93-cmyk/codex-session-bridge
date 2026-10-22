---
name: session-bridge-setup
description: 安装、诊断本地小红书与微信会话桥，检查 Chrome 扩展和 macOS 权限。
---
用中文。先 bridge_doctor，不自动登录或新建 profile。按 README 安装锁定依赖、构建、运行 scripts/install.mjs。读取不足时仅报告真实缺失：Chrome、Browser Bridge 1.0.26、实际 Python 工作者辅助功能权限。

绑定用户当前选中的已有窗口。浏览器 profile 必须来自 doctor 的真实列表。识别不到账号时，只有用户明确表示已选择当前账号，才使用 user_bound:true，并说明它不是程序已核验身份。草稿与实际发送分开。

默认实际提交关闭；只有用户要求配置后，才执行本地 CLI write-mode trusted-host。它表示信任个人 Codex 宿主，不是授权证明。当前任务若未授权发送、评论或发布，不调用提交工具。

安装成功分开核对：构建、MCP 注册、实际 tools/list/call、桌面插件发现、扩展连接、账号业务功能。manifest 或 codex mcp list 不等于真实账号通过。
