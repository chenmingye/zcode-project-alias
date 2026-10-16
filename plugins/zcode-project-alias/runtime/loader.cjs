/**
 * 项目昵称独立 Electron 加载器。作者：Jason.chen。
 * 安装器只在 ZCode 入口追加本文件的 import；不借用其他插件或开放调试端口。
 * 只向本应用的主界面注入，自己的 enabled.json 控制启停，alias.js 支持热更新。
 */
'use strict';
const { app, dialog, webContents } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { suggest } = require('./name-suggestions.cjs');
const { fileURLToPath } = require('node:url');
const VERSION = '0.5.1';
const ROOT = __dirname;
const UI = path.join(ROOT, 'alias.js');
const CONFIG = path.join(ROOT, 'enabled.json');
const STATUS = path.join(ROOT, 'status', `${process.pid}.json`);
const HASH = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
const SERVICE_FILE = path.join(ROOT, 'name-suggestions.cjs');
const SERVICE_HASH = crypto.createHash('sha256').update(fs.readFileSync(SERVICE_FILE)).digest('hex');
// 磁盘文件可能在安装器中被原子替换，逐次重新读取比对已加载版本。
const fileHash = file => { try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; } };
if (!globalThis.__zcodeProjectAliasLoader) {
  const states = new Map();
  const attached = new WeakSet();
  let stopped = false;
  let polling = false;
  let generation = 0;
  let lastError = null;
  let promptShown = false;
  const trusted = wc => {
    try {
      if (wc.isDestroyed() || wc.getType() !== 'window') return false;
      const url = new URL(wc.getURL());
      if (url.protocol !== 'file:') return false;
      const file = fileURLToPath(url);
      return file === path.join(process.resourcesPath, 'app.asar', 'out', 'renderer', 'index.html');
    } catch { return false; }
  };
  const report = () => {
    if (stopped) return;
    try {
      fs.mkdirSync(path.dirname(STATUS), { recursive: true, mode: 0o700 });
      const value = JSON.stringify({ pid: process.pid, version: VERSION, loaderHash: HASH, serviceHash: SERVICE_HASH,
        appVersion: app.getVersion(), updatedAt: Date.now(), error: lastError,
        windows: [...states].map(([id, state]) => ({ id, ...state })) });
      const temp = `${STATUS}.tmp`;
      fs.writeFileSync(temp, value, { mode: 0o600 }); fs.renameSync(temp, STATUS);
    } catch (error) { console.error('[project-alias] status:', error.message); }
  };
  // 加载器或仓库服务被安装器更新后，由运行中的应用自己弹原生确认：点“立即重启”才重启。
  // 每次会话只提示一次；选择“稍后”或未响应时保持现状，下次正常启动本就会载入新版本。
  const promptRestart = async () => {
    if (promptShown || stopped) return;
    promptShown = true;
    let choice = 0;
    try {
      const answer = await dialog.showMessageBox({
        type: 'info', title: '项目昵称插件', message: '项目昵称插件已更新',
        detail: '需要重启 ZCode 才能完全生效。', buttons: ['稍后', '立即重启'],
        defaultId: 1, cancelId: 0, noLink: true,
      });
      choice = answer.response;
    } catch (error) { lastError = `重启确认失败：${error.message}`; report(); return; }
    if (choice === 1) { app.relaunch(); app.quit(); }
  };
  const poll = async () => {
    if (stopped || polling) return;
    polling = true;
    const current = generation;
    try {
      // 配置丢失或损坏时停止自身界面，绝不扩大到任何会话/业务操作。
      let config = {};
      let configError = null;
      try { config = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); }
      catch (error) { configError = error.message; }
      const enabled = config?.enabled === true;
      if (enabled && !promptShown && (fileHash(__filename) !== HASH || fileHash(SERVICE_FILE) !== SERVICE_HASH)) {
        void promptRestart();
      }
      const source = enabled ? fs.readFileSync(UI, 'utf8') : '';
      if (enabled) new vm.Script(source, { filename: UI });
      const sourceHash = crypto.createHash('sha256').update(source).digest('hex');
      const live = webContents.getAllWebContents().filter(trusted);
      for (const id of states.keys()) if (!live.some(wc => wc.id === id)) states.delete(id);
      // 只检查自己的状态，不读取聊天内容；没有其他插件时也能独立完成加载。
      await Promise.all(live.map(async wc => {
        try {
          const state = await wc.executeJavaScript('window.__zcodeProjectAlias?.status() ?? null');
          if (stopped || current !== generation || wc.isDestroyed()) return;
          const previous = states.get(wc.id);
          if (enabled) await wc.executeJavaScript('window.__zcodeProjectAliasNamesAvailable = true');
          if (enabled && (previous?.sourceHash !== sourceHash || state?.version !== config.runtimeVersion)) {
            await wc.executeJavaScript(source);
          } else if (!enabled && state) {
            await wc.executeJavaScript('window.__zcodeProjectAlias?.dispose()');
          }
          if (enabled) {
            const bundle = await wc.executeJavaScript('window.__zcodeProjectAlias?.takeNameRequests?.() ?? null');
            const requests = Array.isArray(bundle?.requests) ? bundle.requests.slice(0, 2) : [];
            const available = Array.isArray(bundle?.workspaces) ? bundle.workspaces : [];
            for (const request of requests) {
              if (!request || typeof request.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(request.id) ||
                request.remote || typeof request.workspacePath !== 'string' ||
                !available.some(row => row && !row.remote && row.workspacePath === request.workspacePath)) continue;
              const result = await suggest(request.workspacePath);
              if (stopped || current !== generation || !trusted(wc)) break;
              const payload = JSON.stringify({ id: request.id, result }).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
              await wc.executeJavaScript(`window.__zcodeProjectAlias?.receiveNameSuggestions?.(${payload})`);
            }
          } else {
            await wc.executeJavaScript('delete window.__zcodeProjectAliasNamesAvailable');
          }
          const result = await wc.executeJavaScript('window.__zcodeProjectAlias?.status() ?? null');
          states.set(wc.id, { enabled, sourceHash, runtime: result, error: null });
        } catch (error) { states.set(wc.id, { error: error.message }); }
      }));
      lastError = configError;
    } catch (error) {
      lastError = error.message;
      console.error('[project-alias] load:', error.message);
    } finally { polling = false; report(); }
  };
  const attach = wc => {
    if (attached.has(wc)) return;
    attached.add(wc);
    wc.on('did-finish-load', () => { states.delete(wc.id); void poll(); });
    wc.once('destroyed', () => states.delete(wc.id));
    void poll();
  };
  const onCreated = (_event, wc) => attach(wc);
  app.on('web-contents-created', onCreated);
  const timer = setInterval(() => void poll(), 2000);
  timer.unref();
  const dispose = () => {
    stopped = true; generation++;
    clearInterval(timer); app.removeListener('web-contents-created', onCreated);
    try { fs.unlinkSync(STATUS); } catch { /* 下次 doctor 仍会核对 PID，旧状态不算在线。 */ }
    delete globalThis.__zcodeProjectAliasLoader;
  };
  globalThis.__zcodeProjectAliasLoader = { version: VERSION, dispose };
  app.once('will-quit', dispose);
  app.whenReady().then(() => {
    for (const wc of webContents.getAllWebContents()) attach(wc);
    void poll();
  }).catch(error => console.error('[project-alias] startup:', error.message));
}
