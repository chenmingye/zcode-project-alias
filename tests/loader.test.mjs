import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import * as url from 'node:url';

const loader = fs.readFileSync(new URL('../plugins/zcode-project-alias/runtime/loader.cjs', import.meta.url), 'utf8');
const source = label => `window.__zcodeProjectAlias = { status: () => ({version:'0.2.0', label:'${label}'}), dispose: () => {delete window.__zcodeProjectAlias} }`;
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

test('独立加载器在没有其他插件时注入、热更新、停用，隔离外部页面与子窗口', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zpa-loader-'));
  const app = Object.assign(new EventEmitter(), { whenReady: () => Promise.resolve(), getVersion: () => '3.15.3' });
  const resourcePath = '/Applications/ZCode.app/Contents/Resources';
  const createWindow = (id, pageUrl, type = 'window') => {
    const context = vm.createContext({ window: {} });
    let calls = 0;
    return Object.assign(new EventEmitter(), {
      id, context, getURL: () => pageUrl, getType: () => type, isDestroyed: () => false,
      calls: () => calls,
      executeJavaScript: async code => { calls++; return vm.runInContext(code, context); },
    });
  };
  const trustedUrl = url.pathToFileURL(`${resourcePath}/app.asar/out/renderer/index.html`).href;
  const main = createWindow(1, `${trustedUrl}?restoreSession=true`);
  const remote = createWindow(2, 'https://example.org/');
  const webview = createWindow(3, trustedUrl, 'webview');
  const otherFile = createWindow(4, 'file:///tmp/index.html');
  const windows = [main, remote, webview, otherFile];
  const ownLoader = path.join(dir, 'loader.cjs');
  fs.writeFileSync(ownLoader, loader);
  fs.writeFileSync(path.join(dir, 'alias.js'), source('first'));
  fs.writeFileSync(path.join(dir, 'enabled.json'), '{"enabled":true,"runtimeVersion":"0.2.0"}');
  let tick;
  const context = vm.createContext({
    require: name => ({ electron: { app, webContents: { getAllWebContents: () => windows } },
      'node:fs': fs, 'node:path': path, 'node:crypto': crypto, 'node:vm': vm, 'node:url': url })[name],
    __dirname: dir, __filename: ownLoader,
    process: { pid: 43210, resourcesPath: resourcePath }, URL,
    console: { error: () => {} },
    setInterval: callback => { tick = callback; return { unref() {} }; }, clearInterval() {},
  });
  try {
    vm.runInContext(loader, context);
    await settle();
    assert.equal(main.context.window.__zcodeProjectAlias.status().label, 'first');
    assert.deepEqual(windows.slice(1).map(w => w.calls()), [0, 0, 0]);
    fs.writeFileSync(path.join(dir, 'alias.js'), source('second'));
    tick(); await settle();
    assert.equal(main.context.window.__zcodeProjectAlias.status().label, 'second');
    fs.writeFileSync(path.join(dir, 'alias.js'), 'invalid syntax !');
    tick(); await settle();
    assert.equal(main.context.window.__zcodeProjectAlias.status().label, 'second');
    const statusFile = path.join(dir, 'status/43210.json');
    assert.ok(JSON.parse(fs.readFileSync(statusFile)).error);
    fs.writeFileSync(path.join(dir, 'enabled.json'), '{"enabled":false}');
    tick(); await settle();
    assert.equal(main.context.window.__zcodeProjectAlias, undefined);
    fs.writeFileSync(path.join(dir, 'alias.js'), source('third'));
    fs.writeFileSync(path.join(dir, 'enabled.json'), '{"enabled":true,"runtimeVersion":"0.2.0"}');
    tick(); await settle();
    assert.equal(main.context.window.__zcodeProjectAlias.status().label, 'third');
    fs.writeFileSync(path.join(dir, 'enabled.json'), 'malformed');
    tick(); await settle();
    assert.equal(main.context.window.__zcodeProjectAlias, undefined);
    app.emit('will-quit');
    assert.equal(fs.existsSync(statusFile), false);
    assert.equal(context.__zcodeProjectAliasLoader, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
