# 架构决定

2026-10-22，初版 0.1.0。

- 独立私有 GitHub 仓库，避免把原工作区的简历、商家或账号数据带入提交。
- Node 22.22 LTS + TypeScript；内置 SQLite（实验性 API），不加载第三方 SQLite 二进制。
- stdio MCP 前端连接用户私有 Unix socket；Python fcntl.flock 持有真正 OS 锁，守护进程统一管理两路业务队列与全局前台锁。锁持有者退出前不启动替代执行者。
- OpenCLI 固定 2.0.2（Apache-2.0），扩展限定 1.0.26；直接使用其 Browser Bridge 浏览器接口，唯一 session、profile、page，绝不调用站点池化命令。每次动作核对目标与可观察账号。无 Chrome/扩展时返回未连接。
- macOS Python 3.12 / PyObjC 原生 AX 工作者。评估 WeChat-MCP 的已公开控件标识，独立实现有限接口，不引入其无范围限制的工具与滚动流程。未知布局拒绝写入。
- 受信任个人 Codex 宿主负责用户授权。默认关闭实际提交，可通过本地 CLI 开启 trusted-host 模式；scope_ref 仅为宿主传入的审计引用，不是签名或用户授权证明。
- SQLite 保存恢复所需正文，目录 0700、文件 0600，默认七天保留；诊断仅生成固定元数据。任务结果传给 Codex 后，适用 Codex 本身的数据处理范围。
- DISPATCHING 原子持久化之后的任何故障保守归为 OUTCOME_UNKNOWN；核对只观察，不自动再次提交。下游语义重试只允许明确提交前失败，结果未知绝不重发。
- 页面、聊天正文均为不可信数据，不能扩张动作与授权。业务接口不开放任意代码、shell、URL 请求或全库聊天导出。
