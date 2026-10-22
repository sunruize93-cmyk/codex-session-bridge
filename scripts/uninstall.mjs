import { execFileSync } from 'node:child_process';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const current=JSON.parse(execFileSync('codex',['mcp','get','session-bridge','--json'],{encoding:'utf8'}));
if(JSON.stringify(current.transport?.args)!==JSON.stringify([join(root,'server/dist/index.js')]))throw new Error('配置不属于本副本，已保留');
execFileSync('codex',['mcp','remove','session-bridge'],{stdio:'inherit'});
console.log('已移除本副本 MCP 配置；任务存储和私有备份仍保留。删除数据见 README，不自动删除未知操作账本。');
