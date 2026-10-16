/** 真实 SDK AppBridge + stdio MCP 的浏览器交互验收，数据均为隔离夹具。作者：Jason.chen。 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const exec = promisify(execFile);
const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'zpa-panel-'));
const artifacts = path.join(root, process.argv.includes('--screenshots') ? 'docs/images' : 'test-results/panel');
await fs.mkdir(artifacts, { recursive: true });
const git = path.join(temporary, 'MES 255', 'serverless');
const svn = path.join(temporary, 'MES 5.5', 'serverless');
await fs.mkdir(path.dirname(git), { recursive: true });
await fs.mkdir(path.dirname(svn), { recursive: true });
await exec('git', ['init', '-b', 'MES-255', git]);
await exec('git', ['-C', git, 'config', 'remote.origin.url', 'https://example.invalid/projects/MES255.git']);
await exec('svnadmin', ['create', path.join(temporary, 'MES 5.5 repo')]);
await exec('svn', ['checkout', '--non-interactive', new URL(`file://${temporary}/MES%205.5%20repo`).href, svn]);
await fs.mkdir(path.join(temporary, 'v2'));
await fs.writeFile(path.join(temporary, 'v2/setting.json'), JSON.stringify({ lastWorkspaceSession: [{ kind: 'local', workspacePath: git }, { kind: 'local', workspacePath: svn }] }));
const client = new Client({ name: 'panel-test', version: '1' });
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'plugins/zcode-project-alias/dist/server.mjs')],
  env: { ...process.env, ZCODE_DATA_BASE_DIR: temporary, ZCODE_WORKSPACE_ROOT: git }, stderr: 'pipe' });
const hostJS = (await build({ stdin: { contents: `
  import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
  const iframe = document.querySelector('iframe');
  const bridge = new AppBridge(null, {name:'acceptance-fixture',version:'1'}, {serverTools:{},logging:{}}, {hostContext:{theme:'dark',displayMode:'fullscreen',availableDisplayModes:['inline','fullscreen']}});
  bridge.oncalltool = async params => { const r=await fetch('/tool',{method:'POST',body:JSON.stringify(params)});if(!r.ok)throw Error('HTTP '+r.status);return r.json(); };
  bridge.oninitialized=()=>{window.initialized=true};
  window.setTheme=theme=>bridge.setHostContext({theme,displayMode:'fullscreen',availableDisplayModes:['inline','fullscreen']});
  window.teardownPanel=()=>bridge.teardownResource({});
  await bridge.connect(new PostMessageTransport(iframe.contentWindow,iframe.contentWindow));
  iframe.src='/panel';
`, resolveDir: root }, bundle: true, format: 'esm', platform: 'browser', write: false })).outputFiles[0].text;
let injectFailure = false;
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/panel') { res.setHeader('Content-Type', 'text/html'); res.end(await fs.readFile(path.join(root, 'plugins/zcode-project-alias/dist/panel.html'))); }
    else if (req.url === '/host.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(hostJS); }
    else if (req.url === '/tool' && req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk;
      const tool = JSON.parse(body);
      res.setHeader('Content-Type', 'application/json');
      if (injectFailure && tool.name === 'edit_project') res.end(JSON.stringify({ isError: true, content: [{ type: 'text', text: '故障注入：保存未完成，请重试。' }] }));
      else res.end(JSON.stringify(await client.callTool(tool)));
    } else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><body style="margin:0;background:#202224"><iframe title="项目昵称插件面板" style="border:0;width:100vw;height:100vh"></iframe><script type="module" src="/host.js"></script></body></html>'); }
  } catch (error) { res.statusCode = 500; res.end(error.message); }
});
let browser;
try {
  await client.connect(transport);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 720, height: 850 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error('PAGEERROR', error.message); }); page.on('console', message => { if(message.type() === 'error') console.error('BROWSER',message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.initialized === true);
  const frame = page.frameLocator('iframe');
  await frame.locator('.project').first().waitFor();
  assert.equal(await frame.locator('.project').count(), 2);
  const shot = async name => { await page.screenshot({ path: path.join(artifacts, `${name}.png`) }); };
  await shot('panel-projects');
  const more = async index => { await frame.locator('.project').nth(index).locator('summary').click(); };
  await more(0); await shot('panel-more-menu');
  await frame.getByRole('button', { name: '编辑', exact: true }).click();
  await frame.getByRole('button', { name: '使用候选名称：MES 255/', exact: true }).waitFor();
  await shot('panel-editor-git');
  await frame.getByRole('button', { name: '使用候选名称：MES 255/', exact: true }).click();
  assert.equal(await frame.locator('#nickname').inputValue(), 'MES 255/');
  await frame.locator('#nickname').press('End'); await frame.locator('#nickname').pressSequentially('管理端');
  await frame.getByRole('button', { name: '复制候选名称：MES 255/', exact: true }).click();
  // 未声明系统剪贴板权限时必须提供可手动复制的回退，不能谎报成功。
  await page.waitForFunction(() => { const doc=document.querySelector('iframe').contentDocument; return !doc.querySelector('#copy-fallback').hidden || [...doc.querySelectorAll('.candidate-copy')].some(button=>button.textContent==='已复制'); });
  await shot('panel-name-candidates');
  injectFailure = true;
  await frame.getByRole('button', { name: '保存', exact: true }).click();
  await frame.getByText('故障注入：保存未完成，请重试。', { exact: true }).waitFor();
  assert.equal(await frame.locator('#nickname').inputValue(), 'MES 255/管理端');
  assert.equal(await frame.locator('#editor').isVisible(), true);
  await shot('panel-save-error'); injectFailure = false;
  await frame.getByRole('button', { name: '保存', exact: true }).click();
  await frame.getByRole('heading', { name: 'MES 255/管理端', exact: true }).waitFor();
  await more(1); await frame.getByRole('button', { name: '置顶', exact: true }).click();
  await frame.locator('.project').first().locator('.pin').waitFor();
  assert.match(await frame.locator('.project').first().textContent(), /MES 5.5/);
  await more(0); await frame.getByRole('button', { name: '编辑', exact: true }).click();
  await frame.getByRole('button', { name: '使用候选名称：MES 5.5/', exact: true }).waitFor();
  await shot('panel-editor-svn');
  await frame.locator('#nickname').fill('MES 5.5/现场作业');
  await frame.getByRole('button', { name: '保存', exact: true }).click();
  await frame.getByRole('heading', { name: 'MES 5.5/现场作业', exact: true }).waitFor();
  await shot('panel-pinned');
  await page.evaluate(() => window.setTheme('light')); await shot('panel-light');
  await page.setViewportSize({ width: 360, height: 800 });
  await shot('panel-narrow');
  assert.equal(await frame.locator('body').evaluate(node => node.scrollWidth <= innerWidth), true);
  // 冷重建页面仍从服务文件读取已保存的昵称、置顶。
  await page.reload(); await frame.getByRole('heading', { name: 'MES 5.5/现场作业', exact: true }).waitFor();
  assert.equal(await frame.locator('.project').first().locator('.pin').textContent(), '已置顶');
  await more(0); await frame.getByRole('button', { name: '取消置顶', exact: true }).click();
  await frame.locator('.project').first().getByRole('heading', { name: 'MES 255/管理端', exact: true }).waitFor();
  await more(0); await frame.getByRole('button', { name: '编辑', exact: true }).click();
  await frame.getByRole('button', { name: '恢复原名', exact: true }).click();
  await frame.getByRole('button', { name: '保存', exact: true }).click();
  await frame.locator('.project').first().getByRole('heading', { name: 'serverless', exact: true }).waitFor();
  await frame.locator('#search').fill('现场作业'); await shot('panel-search'); assert.equal(await frame.locator('.project').count(), 1);
  await frame.locator('#search').fill('no-such-project'); assert.equal(await frame.locator('#empty').isVisible(), true);
  await frame.locator('#search').fill('');
  await more(1); await frame.getByRole('button', { name: '从面板移除', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('iframe').contentDocument.querySelectorAll('.project').length === 1);
  await frame.getByRole('button', { name: '刷新', exact: true }).click(); assert.equal(await frame.locator('.project').count(), 1);
  assert.ok((await fs.stat(svn)).isDirectory());
  await frame.getByRole('button', { name: '添加文件夹', exact: true }).click();
  await shot('panel-add-folder');
  await frame.locator('#folder-path').fill(svn); await frame.getByRole('button', { name: '添加', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('iframe').contentDocument.querySelectorAll('.project').length === 2);
  assert.deepEqual(await page.evaluate(() => window.teardownPanel()), {});
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, sdkHandshake: true, realStdio: true, gitAndSvn: true, failureRetainsInput: true, persisted: true, narrowViewport: true, artifacts }));
} finally {
  await browser?.close(); await client.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  await fs.rm(temporary, { recursive: true, force: true });
}
