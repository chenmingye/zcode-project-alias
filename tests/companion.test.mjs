import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
const { PipeClient, trustedTarget } = createRequire(import.meta.url)('../plugins/zcode-project-alias/runtime/companion.cjs');

test('匿名管道按请求号匹配，支持跨块 UTF-8 和多条响应，不启动网络监听', async () => {
  const input = new PassThrough(), output = new PassThrough();
  const client = new PipeClient(input, output);
  const requests = [];
  input.on('data', bytes => requests.push(JSON.parse(bytes.toString().slice(0, -1))));
  const first = client.call('Runtime.evaluate', { expression: '中文' }, 'page-1');
  const second = client.call('Target.getTargets');
  assert.equal(requests[0].sessionId, 'page-1');
  const bytes = Buffer.from(JSON.stringify({ id: 1, result: { text: '中文' } }) + '\0');
  const split = bytes.indexOf(Buffer.from('中')) + 1;
  output.write(bytes.subarray(0, split)); output.write(bytes.subarray(split));
  output.write(JSON.stringify({ id: 2, result: { targetInfos: [] } }) + '\0');
  assert.deepEqual(await first, { text: '中文' });
  assert.deepEqual(await second, { targetInfos: [] });
  assert.equal(client.pending.size, 0); client.close();
});

test('CDP 错误、超时及管道断开不能误报成功', async () => {
  const input = new PassThrough(), output = new PassThrough();
  const client = new PipeClient(input, output);
  const failed = client.call('Runtime.evaluate');
  output.write(JSON.stringify({ id: 1, error: { message: 'context destroyed' } }) + '\0');
  await assert.rejects(failed, /context destroyed/);
  await assert.rejects(client.call('Target.getTargets', {}, undefined, 10), /超时/);
  const pending = client.call('Runtime.evaluate');
  output.end(); await assert.rejects(pending, /管道已关闭/);
  await assert.rejects(client.call('Runtime.evaluate'), /未连接/);
});

test('只允许官方应用内的主界面，不注入外部网页、插件 guest 或其他本地页面', () => {
  const app = '/Applications/ZCode.app';
  const url = 'file:///Applications/ZCode.app/Contents/Resources/app.asar/out/renderer/index.html?restoreSession=true';
  assert.equal(trustedTarget({ type: 'page', url }, app), true);
  for (const target of [
    { type: 'webview', url },
    { type: 'page', url: 'https://example.com/index.html' },
    { type: 'page', url: 'file:///tmp/index.html' },
    { type: 'page', url: 'file:///Applications/ZCode.app/Contents/Resources/app.asar/out/renderer/plugin-sandbox.html' },
  ]) assert.equal(trustedTarget(target, app), false);
});
