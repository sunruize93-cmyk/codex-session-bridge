# 依赖与参考

- OpenCLI 2.0.2，Apache-2.0，npm 包完整性记录在 package-lock.json；上游 tag v2.0.2 = deca0fee85016be2e58836eeca974825e09c9076。只使用固定版本 Browser Bridge transport，调用一次 requestDaemon，未调用其自动重试 sendCommandRaw 或站点会话池。所依赖的服务仅限本机 127.0.0.1:19825；上游以 X-OpenCLI 请求头与 Origin 检查防浏览器 CSRF，这不是防恶意本机进程的秘密认证。
- MCP TypeScript SDK 1.32.1：MIT；zod、zod-to-json-schema：MIT。运行包保留 node_modules 中的原始 LICENSE。
- PyObjC Cocoa / ApplicationServices / Quartz 12.0：MIT；实际传递依赖和哈希见 wechat-worker/uv.lock。
- WeChat-MCP：MIT，参考固定 commit cc470367ca6613b129f7e2bb742e6cc57df8c4d6 的公开 AX 控件事实（session*item*、big_title_line_h_view、Messages、Search），未复制实现代码。当前账户和接收者稳定标识能力尚待实机验证。
- 浏览器页面和 AX 测试样本为合成 fixtures，不包含实际账号/聊天内容。

参考链接：https://github.com/jackwener/OpenCLI/tree/v2.0.2 、https://github.com/BiboyQG/WeChat-MCP/tree/cc470367ca6613b129f7e2bb742e6cc57df8c4d6 。
