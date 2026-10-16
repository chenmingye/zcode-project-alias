/**
 * 签名保留的伴随加载器。作者：Jason.chen。
 * 以原厂签名的 ZCode 可执行文件启动应用，通过继承的匿名管道调用 Chromium CDP。
 * 不修改应用，不监听 TCP，不启动 Node inspector，不放宽浏览器或 Computer Use 校验。
 */
'use strict';
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { EventEmitter } = require('node:events');
const { fileURLToPath } = require('node:url');
const { suggest } = require('./name-suggestions.cjs');
const VERSION = '0.6.0';
class PipeClient extends EventEmitter {
  constructor(input, output) {
    super(); this.input = input; this.pending = new Map(); this.sequence = 0; this.buffer = Buffer.alloc(0); this.closed = false;
    output.on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      if (this.buffer.length > 32 * 1024 * 1024) return this.close(new Error('CDP 输出超出限制'));
      let end;
      while ((end = this.buffer.indexOf(0)) >= 0) {
        const bytes = this.buffer.subarray(0, end); this.buffer = this.buffer.subarray(end + 1);
        let message;
        try { message = JSON.parse(bytes.toString()); } catch { this.close(new Error('CDP 响应格式无效')); return; }
        if (message.id) {
          const wait = this.pending.get(message.id);
          if (!wait) continue;
          this.pending.delete(message.id); clearTimeout(wait.timer);
          message.error ? wait.reject(new Error(message.error.message)) : wait.resolve(message.result);
        } else this.emit('notification', message);
      }
    });
    output.on('end', () => this.close(new Error('ZCode 调试管道已关闭')));
    output.on('error', error => this.close(error));
    input.on('error', error => this.close(error));
  }
  call(method, params = {}, sessionId, timeout = 8000) {
    if (this.closed) return Promise.reject(new Error('调试管道未连接'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} 超时`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.input.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });
  }
  close(error = new Error('调试管道已关闭')) {
    if (this.closed) return;
    this.closed = true;
    for (const wait of this.pending.values()) { clearTimeout(wait.timer); wait.reject(error); }
    this.pending.clear(); this.emit('closed', error);
  }
}
function trustedTarget(target, appPath) {
  try {
    return target.type === 'page' && fileURLToPath(new URL(target.url)) === path.join(appPath, 'Contents/Resources/app.asar/out/renderer/index.html');
  } catch { return false; }
}
function verifyApp(appPath) {
  // codesign 的 requirement 使用 '=' 前缀，确保校验表达式而非把它解释成文件名。
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', '=anchor apple generic and identifier "dev.zcode.app" and certificate leaf[subject.OU] = "8A5X4JJ39T"', appPath], { stdio: 'pipe' });
}
function atomicJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 }); fs.renameSync(temp, file);
}
async function startCompanion({ appPath, dataDir, env = process.env, extraArgs = [], controls = true }) {
  verifyApp(appPath);
  if (extraArgs.length > 1 || extraArgs.some(arg => !arg.startsWith('--open-workspace='))) throw new Error('不支持的应用启动参数');
  const configPath = path.join(dataDir, 'enabled.json');
  const statusPath = path.join(dataDir, 'companion-status.json');
  const socketPath = path.join(dataDir, 'control.sock');
  const fileHash = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(dataDir, file))).digest('hex');
  const companionHash = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
  const serviceHash = fileHash('name-suggestions.cjs');
  const launcherHash = fileHash('launch-signed.py');
  if (controls) {
    if (Buffer.byteLength(socketPath) > 100) throw new Error('运行目录过长，无法创建本机控制 socket');
    try {
      const old = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
      let alive = false;
      try { process.kill(old.companionPid, 0); alive = true; } catch {}
      if (alive) throw new Error('伴随加载器已在运行，请通过安装器刷新');
    } catch (cause) { if (cause.message.includes('已在运行')) throw cause; }
  }
  const childEnv = { ...env };
  delete childEnv.ELECTRON_RUN_AS_NODE; delete childEnv.NODE_OPTIONS;
  let launchConfig = {};
  try { launchConfig = JSON.parse(fs.readFileSync(path.join(dataDir, 'launch-config.json'), 'utf8')); } catch {}
  const launcherArgs = [path.join(dataDir, 'launch-signed.py'), '--app', appPath];
  if (extraArgs.length) launcherArgs.push('--workspace', extraArgs[0].slice('--open-workspace='.length));
  const child = spawn(launchConfig.python || 'python3', launcherArgs, {
    env: childEnv, stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
  });
  const cdp = new PipeClient(child.stdio[3], child.stdio[4]);
  const sessions = new Map(); let stopped = false; let busy = false; let error = null; let server;
  let enabled = true;
  // 只保留故障尾部，不把主应用日志或聊天内容抄进插件日志。
  let startupError = '';
  child.stderr.on('data', bytes => { startupError = (startupError + bytes.toString()).slice(-2000); });
  const evaluate = async (sessionId, expression) => {
    const result = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || '界面脚本执行失败');
    return result.result?.value;
  };
  const status = () => ({ version: VERSION, transport: 'anonymous-pipe', companionPid: process.pid, appPid: child.pid,
    appPath, companionHash, serviceHash, launcherHash, connected: !cdp.closed, updatedAt: Date.now(), enabled, error, windows: [...sessions.values()].map(({ targetId, runtime, sourceHash, error }) => ({ targetId, runtime, sourceHash, error })) });
  const report = () => { if (!stopped) atomicJSON(statusPath, status()); };
  cdp.on('closed', cause => { error = cause.message; report(); });
  const poll = async () => {
    if (busy || stopped || cdp.closed) return;
    busy = true;
    try {
      let config;
      try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch { config = {}; }
      enabled = config.enabled === true;
      const source = enabled ? fs.readFileSync(path.join(dataDir, 'alias.js'), 'utf8') : '';
      const hash = crypto.createHash('sha256').update(source).digest('hex');
      const { targetInfos } = await cdp.call('Target.getTargets');
      const live = targetInfos.filter(target => trustedTarget(target, appPath));
      for (const id of sessions.keys()) if (!live.some(target => target.targetId === id)) sessions.delete(id);
      for (const target of live) {
        let row = sessions.get(target.targetId);
        try {
          if (!row) {
            const { sessionId } = await cdp.call('Target.attachToTarget', { targetId: target.targetId, flatten: true });
            row = { targetId: target.targetId, sessionId }; sessions.set(target.targetId, row);
          }
          const state = await evaluate(row.sessionId, 'window.__zcodeProjectAlias?.status() ?? null');
          if (enabled) {
            await evaluate(row.sessionId, 'window.__zcodeProjectAliasNamesAvailable = true');
            if (row.sourceHash !== hash || state?.version !== config.runtimeVersion) await evaluate(row.sessionId, source);
            const bundle = await evaluate(row.sessionId, 'window.__zcodeProjectAlias?.takeNameRequests?.() ?? null');
            for (const request of (bundle?.requests ?? []).slice(0, 2)) {
              if (!request || !/^[a-f0-9-]{36}$/i.test(request.id) || request.remote || typeof request.workspacePath !== 'string' ||
                  !bundle.workspaces?.some(w => !w.remote && w.workspacePath === request.workspacePath)) continue;
              const result = await suggest(request.workspacePath);
              await evaluate(row.sessionId, `window.__zcodeProjectAlias?.receiveNameSuggestions?.(${JSON.stringify({ id: request.id, result })})`);
            }
          } else await evaluate(row.sessionId, 'window.__zcodeProjectAlias?.dispose(); delete window.__zcodeProjectAliasNamesAvailable');
          row.runtime = await evaluate(row.sessionId, 'window.__zcodeProjectAlias?.status() ?? null');
          row.sourceHash = hash; row.error = null;
        } catch (cause) { row.error = cause.message; if (/session|target|context/i.test(cause.message)) sessions.delete(target.targetId); }
      }
      error = null;
    } catch (cause) { error = cause.message; }
    finally { busy = false; report(); }
  };
  // 控制接口只接收自己的固定操作；不能从 socket 执行任意 JavaScript、CDP 或文件命令。
  if (controls) {
    try { fs.unlinkSync(socketPath); } catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
    server = net.createServer(socket => {
      let buffer = '';
      socket.setTimeout(3000, () => socket.destroy());
      socket.on('error', () => {});
      socket.on('data', async bytes => {
        buffer += bytes.toString();
        if (buffer.length > 1024) { socket.destroy(); return; }
        if (!buffer.includes('\n')) return;
        socket.pause();
        try {
          const command = JSON.parse(buffer.split('\n')[0]);
          if (command.action === 'status') socket.end(`${JSON.stringify(status())}\n`);
          else if (command.action === 'refresh') { await poll(); socket.end(`${JSON.stringify(status())}\n`); }
          else socket.end('{"error":"不支持的控制操作"}\n');
        } catch { socket.end('{"error":"无效控制请求"}\n'); }
      });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    fs.chmodSync(socketPath, 0o600);
  }
  const timer = setInterval(() => void poll(), 1500);
  const cleanup = () => {
    stopped = true; clearInterval(timer); cdp.close(); server?.close();
    if (controls) { try { fs.unlinkSync(socketPath); } catch {} }
    try { const old = JSON.parse(fs.readFileSync(statusPath)); if (old.companionPid === process.pid) fs.unlinkSync(statusPath); } catch {}
  };
  child.once('exit', (code, signal) => {
    if (!sessions.size && code) console.error(`[project-alias] ZCode 启动失败 (${code ?? signal})：${startupError}`);
    cleanup();
  });
  child.once('error', cause => { error = cause.message; cleanup(); });
  void poll();
  // 测试可直接使用已持有的匿名管道验证；不额外开放调试接口。
  return { child, cdp, evaluate, poll, status, sessions, cleanup };
}
module.exports = { PipeClient, trustedTarget, verifyApp, startCompanion, VERSION };
if (require.main === module) {
  const args = process.argv.slice(2);
  const appPath = args[args.indexOf('--app') + 1];
  const dataDir = args[args.indexOf('--data-dir') + 1];
  if (!args.includes('--app') || !args.includes('--data-dir')) { console.error('需要 --app 与 --data-dir'); process.exitCode = 1; }
  else startCompanion({ appPath, dataDir }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
