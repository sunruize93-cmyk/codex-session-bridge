import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
const url =
  'https://github.com/jackwener/OpenCLI/releases/download/v2.0.2/opencli-extension-v1.0.26.zip';
const expected = '2b2eff46fe4a21a0b02516e743005066e6317b48f15455c1c7b07f69ad7af211';
const res = await fetch(url);
if (!res.ok) throw new Error('扩展下载失败');
const bytes = Buffer.from(await res.arrayBuffer());
const sha = createHash('sha256').update(bytes).digest('hex');
if (sha !== expected) throw new Error('扩展摘要不匹配，未保存');
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/browser-bridge-1.0.26.zip', bytes);
console.log('已保存官方扩展压缩包并验证 SHA256；需要用户在 Chrome 手动加载。');
