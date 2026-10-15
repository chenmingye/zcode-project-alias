/**
 * README 功能截图。作者：Jason.chen
 * 在隔离浏览器中运行真实插件与 React/Radix fixture；候选使用示例数据，
 * 不连接、修改或重启用户的 ZCode，不访问业务仓库。
 */
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url);
const output = new URL('docs/images/', root);
await mkdir(output, { recursive: true });
const source = await readFile(new URL('plugins/zcode-project-alias/runtime/alias.js', root), 'utf8');
const built = await build({ entryPoints: [new URL('scripts/screenshot-fixture.jsx', root).pathname], bundle: true, write: false, format: 'iife' });
const css = `*{box-sizing:border-box}body{font:16px system-ui;background:#171717;color:#d2d6d7;margin:0}aside{width:400px;min-height:600px;background:#263740;padding:24px 16px}ul{list-style:none;margin:12px 0 0;padding:0}li{margin-bottom:20px}li>[role=button]:first-child{display:flex;align-items:center;gap:12px;height:42px;color:#939da3;padding:0 10px}li>[role=button]:first-child>svg{flex-shrink:0}.truncate{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.workspace-actions{display:flex;gap:10px;align-items:center;flex-shrink:0;visibility:hidden}li>[role=button]:first-child:hover .workspace-actions,li>[role=button]:first-child:focus-within .workspace-actions{visibility:visible}li button{border:0;background:transparent;color:inherit;padding:0;width:26px;height:28px;display:grid;place-items:center;cursor:pointer;font-size:24px}li button:hover{background:#ffffff0c;border-radius:4px}.fixture-menu{min-width:170px;background:#292929;border:1px solid #ffffff20;border-radius:10px;padding:5px;box-shadow:0 8px 24px #0005}.fixture-item{display:flex;align-items:center;gap:10px;padding:10px 12px;outline:0;border-radius:5px}.fixture-item[data-highlighted]{background:#ffffff15}[data-testid=task-item]{display:flex;align-items:center;padding:8px 12px 8px 42px;gap:12px;font-size:16px}[data-testid=task-item]>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}time{font-size:14px;color:#879399}.sidebar-tabs{display:flex;align-items:center;width:max-content;background:#ffffff08;border-radius:30px;padding:4px;gap:10px;color:#89959c}.sidebar-tabs>span{padding-left:10px}.sidebar-tabs strong{display:flex;align-items:center;gap:8px;background:#171717;padding:7px 14px;border-radius:30px;font-weight:500}.sidebar-heading{margin:24px 10px 4px;color:#75858e}`;
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<style>${css}</style><div id="root"></div>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const context = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1000, height: 720 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.addScriptTag({ content: built.outputFiles[0].text });
  await page.waitForSelector('[data-testid="workspace-item-/a/serverless"]');
  await page.addScriptTag({ content: source });
  await page.waitForFunction(() => window.__zcodeProjectAlias?.status().projects === 4);
  await page.evaluate(() => {
    window.__zcodeProjectAliasNamesAvailable = true;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.copiedName = value; } } });
  });
  const row = path => page.locator(`[data-testid="workspace-item-${path}"]`).first();
  const menu = async path => {
    await row(path).hover();
    await row(path).getByRole('button', { name: '更多', exact: true }).click();
    await page.getByRole('menuitem', { name: '编辑', exact: true }).waitFor();
  };
  const editor = async (path, kind = 'SVN') => {
    await menu(path);
    await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.evaluate(kind => {
      const request = window.__zcodeProjectAlias.takeNameRequests().requests.at(-1);
      window.__zcodeProjectAlias.receiveNameSuggestions({ id: request.id, result: {
        message: '点击候选填入前缀，再输入管理端或现场作业；也可以复制',
        candidates: kind === 'SVN'
          ? [{ name: 'MES 255/', source: 'SVN 仓库' }, { name: 'MES 5.5/', source: 'SVN 路径' }]
          : [{ name: 'serverless/', source: 'Git origin' }, { name: 'feature/admin/', source: 'Git 分支' }, { name: 'MES 255/', source: '上级目录' }],
      } });
    }, kind);
  };
  const input = page.getByLabel('项目昵称（留空恢复原名）');
  const shot = async (target, name) => {
    await target.screenshot({ path: new URL(`${name}.png`, output).pathname });
    console.log(`${name}.png`);
  };
  const rename = async (path, name) => {
    await editor(path);
    await input.fill(name);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    assert.equal(await row(path).locator('div.truncate').textContent(), name);
  };
  await page.mouse.move(900, 650);
  await shot(page.locator('aside'), 'projects-before');
  await row('/a/serverless').hover();
  const actions = row('/a/serverless').locator('.workspace-actions');
  assert.equal(await actions.evaluate(node => getComputedStyle(node).visibility), 'visible');
  assert.equal(await actions.getByRole('button').count(), 3);
  await shot(page.locator('aside'), 'project-hover');
  await rename('/a/serverless', 'MES 255/管理端');
  await rename('/b/serverless', 'MES 255/现场作业');
  await page.mouse.move(900, 650);
  assert.equal(await actions.evaluate(node => getComputedStyle(node).visibility), 'hidden');
  await shot(page.locator('aside'), 'projects-after');
  await menu('/a/serverless');
  await shot(page.getByRole('menu'), 'project-more-menu');
  await page.keyboard.press('Escape');
  await menu('/b/serverless');
  await page.getByRole('menuitem', { name: '置顶', exact: true }).click();
  assert.equal(await page.locator('[data-project-entry]').first().getAttribute('data-project-entry'), '/b/serverless');
  await menu('/b/serverless');
  await page.getByRole('menuitem', { name: '取消置顶', exact: true }).waitFor();
  await shot(page, 'project-pinned');
  await page.keyboard.press('Escape');
  await editor('/a/serverless');
  await shot(page.getByRole('dialog'), 'edit-project-dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await shot(page.getByRole('dialog'), 'edit-project-light');
  await shot(page, 'nickname-dialog');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('button', { name: '复制候选名称：MES 255/', exact: true }).click();
  assert.equal(await page.evaluate(() => window.copiedName), 'MES 255/');
  await page.getByRole('button', { name: '使用候选名称：MES 255/', exact: true }).click();
  await page.keyboard.type('管理端');
  await shot(page.getByRole('dialog'), 'name-suggestions');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await editor('/a/serverless', 'Git');
  await shot(page.getByRole('dialog'), 'git-name-suggestions');
  await page.getByRole('button', { name: '恢复原名', exact: true }).click();
  assert.equal(await row('/a/serverless').locator('div.truncate').textContent(), 'serverless');
  await page.mouse.move(900, 650);
  await shot(page.locator('aside'), 'project-name-restored');
  await context.close();
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
