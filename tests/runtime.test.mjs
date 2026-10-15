import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { build } from 'esbuild';

let browser, server, origin, bundle;
const source = await readFile(new URL('../plugins/zcode-project-alias/runtime/alias.js', import.meta.url), 'utf8');
before(async () => {
  const built = await build({ entryPoints: [new URL('./fixture.jsx', import.meta.url).pathname], bundle: true, write: false, format: 'iife' });
  bundle = built.outputFiles[0].text;
  server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<style>body{font:14px system-ui;background:#202626;color:#eee;margin:32px}section{width:300px;margin-bottom:24px}section>[role=button]:first-child{display:flex;align-items:center;gap:8px;height:34px}section button{margin-left:auto;border:0;color:inherit;background:#ffffff12;border-radius:6px;padding:5px 9px}.fixture-menu{min-width:140px;background:#292929;border:1px solid #ffffff20;border-radius:10px;padding:5px;box-shadow:0 8px 24px #0005}.fixture-item{padding:8px 12px;outline:0;border-radius:5px}.fixture-item[data-highlighted]{background:#ffffff15}small{display:none}</style><div id="root"></div>`); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  // 使用独立无头实例和临时 profile，绝不连接用户正在运行的浏览器。
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });

const ready = async page => {
  await page.goto(origin);
  await page.addScriptTag({ content: bundle });
  await page.waitForSelector('[data-testid="workspace-item-/a/serverless"]');
  await page.addScriptTag({ content: source });
  await page.waitForFunction(() => window.__zcodeProjectAlias?.status().projects === 4);
};
const label = (page, path = '/a/serverless') => page.locator(`[data-testid="workspace-item-${path}"] > div.truncate`).first();
const openMenu = async (page, path = '/a/serverless') => {
  await page.locator(`[data-testid="workspace-item-${path}"]`).first().getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('menuitem', { name: '重命名', exact: true }).waitFor();
};
const openEditor = async (page, path = '/a/serverless') => {
  await openMenu(page, path);
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  await page.getByLabel('项目昵称（留空恢复原名）').waitFor();
};
const rename = async (page, name, path = '/a/serverless') => {
  await openEditor(page, path);
  await page.getByLabel('项目昵称（留空恢复原名）').fill(name);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.zpa-dialog'));
};

test('同名项目、任务与远端身份独立，保存不触发宿主选择', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await ready(page);
    assert.equal(await page.locator('.zpa-edit').count(), 0);
    await rename(page, '生产后端');
    assert.equal(await label(page).textContent(), '生产后端');
    await openEditor(page);
    await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
    await page.screenshot({ path: new URL('../test-results/nickname-dialog.png', import.meta.url).pathname });
    await page.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await label(page, '/b/serverless').textContent(), 'serverless');
    assert.equal(await page.locator('[data-testid="task-item"]').first().textContent(), 'serverless');
    assert.equal(await page.evaluate(() => window.hostClicks), 0);
    await rename(page, '远端 A', '/srv/serverless');
    assert.deepEqual(await page.locator('[data-testid="workspace-item-/srv/serverless"] > div.truncate').allTextContents(), ['远端 A', 'serverless']);
    assert.match(await page.locator('[data-testid="workspace-item-/a/serverless"]').getAttribute('title'), /\/a\/serverless/);
    await page.evaluate(() => window.renderFixture(window.fixtureTabs.map(t => ({ ...t, label: 'serverless新' })), 1));
    await page.waitForFunction(() => document.querySelector('section small').textContent === '1' &&
      document.querySelector('[data-testid="workspace-item-/a/serverless"] > div.truncate').textContent === '生产后端');
    await page.evaluate(() => window.__zcodeProjectAlias.dispose());
    assert.equal(await label(page).textContent(), 'serverless新');
    assert.equal(await page.locator('.zpa-edit').count(), 0);
    assert.equal(await page.locator('#zpa-style').count(), 0);
  } finally { await context.close(); }
});

test('多窗口同步、重新打开、热更新与恢复原名；昵称作为纯文本渲染', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const other = await context.newPage();
  try {
    await ready(page); await ready(other);
    const nickname = '<img src=x onerror=alert(1)> 中文';
    await rename(page, nickname);
    await other.waitForFunction(value => document.querySelector('[data-testid="workspace-item-/a/serverless"] > div.truncate').textContent === value, nickname);
    assert.equal(await page.locator('[data-testid="workspace-item-/a/serverless"] img').count(), 0);
    await page.addScriptTag({ content: source });
    assert.equal(await page.locator('.zpa-edit').count(), 0);
    assert.equal(await label(page).textContent(), nickname);
    await ready(page); // 新文档恢复，存储未清理。
    assert.equal(await label(page).textContent(), nickname);
    await openEditor(page);
    await page.getByRole('button', { name: '恢复原名', exact: true }).click();
    await other.waitForFunction(() => document.querySelector('[data-testid="workspace-item-/a/serverless"] > div.truncate').textContent === 'serverless');
    assert.equal(await label(page).textContent(), 'serverless');
    const status = await page.evaluate(() => window.__zcodeProjectAlias.status());
    assert.equal(status.error, null);
    assert.ok(status.scans < 30, `观察器不应自循环: ${status.scans}`);
  } finally { await context.close(); }
});

test('取消与存储失败不丢数据；移除再导入和晚挂载可恢复', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await ready(page); await rename(page, '原昵称');
    await openEditor(page);
    await page.getByLabel('项目昵称（留空恢复原名）').fill('不保存');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await label(page).textContent(), '原昵称');
    await page.evaluate(() => {
      window.realSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = () => { throw new Error('模拟磁盘配额不足'); };
    });
    await openEditor(page);
    await page.getByLabel('项目昵称（留空恢复原名）').fill('新昵称');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    assert.match(await page.getByRole('alert').textContent(), /保存失败/);
    assert.equal(await page.locator('.zpa-dialog').count(), 1);
    assert.equal(await label(page).textContent(), '原昵称');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.evaluate(() => { Storage.prototype.setItem = window.realSetItem; window.renderFixture([]); });
    await page.waitForFunction(() => window.__zcodeProjectAlias.status().projects === 0);
    await page.evaluate(() => window.renderFixture());
    await page.waitForFunction(() => document.querySelector('[data-testid="workspace-item-/a/serverless"] > div.truncate')?.textContent === '原昵称');
    assert.equal(await page.locator('.zpa-edit').count(), 0);
    await page.evaluate(() => window.__zcodeProjectAlias.dispose());
    await page.addScriptTag({ content: source });
    assert.equal(await label(page).textContent(), '原昵称');
  } finally { await context.close(); }
});

test('更多菜单保留移除，重命名支持键盘且不触发原操作', async () => {
  const context = await browser.newContext({ colorScheme: 'dark' });
  const page = await context.newPage();
  try {
    await ready(page);
    await openMenu(page);
    assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['重命名', '× 移除']);
    await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
    await page.screenshot({ path: new URL('../test-results/project-more-menu.png', import.meta.url).pathname });
    await page.keyboard.press('Home');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), '重命名');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), '× 移除');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await page.getByLabel('项目昵称（留空恢复原名）').waitFor();
    assert.equal(await page.getByRole('menu').count(), 0);
    assert.deepEqual(await page.evaluate(() => window.removals), []);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await openMenu(page);
    await page.getByRole('menuitem', { name: '× 移除', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.removals), ['/a/serverless']);
    assert.equal(await page.locator('.zpa-dialog').count(), 0);
    await openMenu(page);
    await page.evaluate(() => window.__zcodeProjectAlias.dispose());
    assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['× 移除']);
  } finally { await context.close(); }
});

test('编辑项目展示真实源文件夹，关闭不保存，原名保存无冗余记录，适配主题和窄窗口', async () => {
  const context = await browser.newContext({ colorScheme: 'dark' });
  const page = await context.newPage();
  try {
    await ready(page);
    await openEditor(page);
    const panel = page.getByRole('dialog', { name: '编辑项目', exact: true });
    assert.equal(await panel.locator('.zpa-folder-name').textContent(), 'serverless');
    assert.equal(await panel.locator('.zpa-path').textContent(), '/a/serverless');
    assert.equal(await panel.getByLabel('项目昵称（留空恢复原名）').inputValue(), 'serverless');
    await panel.getByLabel('项目昵称（留空恢复原名）').fill('不应保存');
    await panel.getByRole('button', { name: '关闭', exact: true }).click();
    assert.equal(await label(page).textContent(), 'serverless');
    await openEditor(page);
    assert.equal(await page.getByLabel('项目昵称（留空恢复原名）').inputValue(), 'serverless');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('zcode.project-alias.v1:')).length), 0);
    await rename(page, '生产管理端');
    await openEditor(page);
    await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
    await panel.screenshot({ path: new URL('../test-results/edit-project-dark.png', import.meta.url).pathname });
    await page.emulateMedia({ colorScheme: 'light' });
    await panel.screenshot({ path: new URL('../test-results/edit-project-light.png', import.meta.url).pathname });
    await page.setViewportSize({ width: 360, height: 640 });
    const bounds = await panel.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 360);
    await page.getByLabel('项目昵称（留空恢复原名）').fill('丢弃草稿');
    await page.keyboard.press('Escape');
    assert.equal(await panel.count(), 0);
    assert.equal(await label(page).textContent(), '生产管理端');
  } finally { await context.close(); }
});
