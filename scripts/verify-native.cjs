/** 官方签名应用的隔离管道验收。作者：Jason.chen。不读取用户账号或业务配置。 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { execFileSync } = require('node:child_process');
const { startCompanion, verifyApp, VERSION } = require('../plugins/zcode-project-alias/runtime/companion.cjs');
const appPath = process.env.ZCODE_APP_PATH || '/Applications/ZCode.app';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-native-alias-'));
const source = path.resolve(__dirname, '../plugins/zcode-project-alias/runtime');
const evidence = path.resolve(__dirname, '../test-results/native-pipe-report.json');
const hashes = () => Object.fromEntries(['Contents/Resources/app.asar', 'Contents/Info.plist', 'Contents/MacOS/ZCode', 'Contents/_CodeSignature/CodeResources'].map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(appPath, name))).digest('hex')]));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  verifyApp(appPath); const before = hashes();
  for (const file of ['alias.js', 'name-suggestions.cjs', 'launch-signed.py']) fs.copyFileSync(path.join(source, file), path.join(root, file));
  const enabled = value => fs.writeFileSync(path.join(root, 'enabled.json'), JSON.stringify({ enabled: value, runtimeVersion: VERSION }));
  enabled(true);
  const app = await startCompanion({ appPath, dataDir: root, controls: false, env: { ...process.env,
    ZCODE_DESKTOP_APPLICATION_NAME: 'ZCode 昵称隔离验收', ZCODE_DESKTOP_HOME_DIR: root,
    ZCODE_DESKTOP_USER_DATA_DIR: path.join(root, 'profile'), ZCODE_DESKTOP_SESSION_DATA_DIR: path.join(root, 'session'), ZCODE_DATA_BASE_DIR: path.join(root, '.zcode') } });
  let report;
  try {
    for (let attempt = 0; attempt < 30; attempt++) {
      await app.poll();
      if (app.status().windows.some(w => w.runtime?.version === VERSION)) break;
      await delay(300);
    }
    assert.ok(app.status().windows.some(w => w.runtime?.version === VERSION), '官方主窗口必须实际加载插件');
    const responsible = Number(execFileSync('python3', ['-c', 'import ctypes,sys; f=ctypes.CDLL("/usr/lib/libSystem.B.dylib").responsibility_get_pid_responsible_for_pid; f.argtypes=[ctypes.c_int]; f.restype=ctypes.c_int; print(f(int(sys.argv[1])))', String(app.child.pid)], { encoding: 'utf8' }).trim());
    assert.equal(responsible, app.child.pid, '官方应用必须承担自身责任身份，不能继承外部启动器身份');
    enabled(false); await app.poll();
    assert.ok(app.status().windows.every(w => !w.runtime), '停用必须撤销当前主窗口里的插件');
    enabled(true); await app.poll();
    assert.ok(app.status().windows.some(w => w.runtime?.version === VERSION), '恢复必须重新加载插件');
    verifyApp(appPath); assert.deepEqual(hashes(), before, '官方应用资源必须逐字节不变');
    report = { version: VERSION, appPath, signatureVerified: true, appResourcesUnchanged: true,
      realRendererInjected: true, disabledAndReenabled: true, independentApplicationResponsibility: true, transport: 'anonymous-pipe',
      computerUseToolCall: '由 ZCode 实际工具单独验收；本脚本不代替 Computer Use 工具调用' };
  } finally {
    // 正常关闭本轮隔离实例，不能处理用户的主实例；Browser.close 可能先断管道再返回。
    const exited = once(app.child, 'exit');
    try { await app.cdp.call('Browser.close'); } catch (error) { if (!app.cdp.closed) throw error; }
    await Promise.race([exited, delay(20000).then(() => { if (app.child.exitCode === null) throw new Error('隔离实例未正常关闭'); })]);
  }
  fs.mkdirSync(path.dirname(evidence), { recursive: true }); fs.writeFileSync(evidence, JSON.stringify(report, null, 2));
  fs.rmSync(root, { recursive: true, force: true });
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
