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
  server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<style>*, ::before, ::after { margin: 0; padding: 0; border: 0 solid; box-sizing: border-box; }body{font:14px system-ui;background:#202626;color:#eee;margin:32px}ul{list-style:none;padding:0;width:300px}li{margin-bottom:24px}li>[role=button]:first-child{display:flex;align-items:center;gap:8px;height:34px}li button{margin-left:auto;border:0;color:inherit;background:#ffffff12;border-radius:6px;padding:5px 9px}.fixture-menu{min-width:140px;background:#292929;border:1px solid #ffffff20;border-radius:10px;padding:5px;box-shadow:0 8px 24px #0005}.fixture-item{padding:8px 12px;outline:0;border-radius:5px}.fixture-item[data-highlighted]{background:#ffffff15}small{display:none}</style><div id="root"></div>`); });
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
  await page.getByRole('menuitem', { name: '编辑', exact: true }).waitFor();
};
const openEditor = async (page, path = '/a/serverless') => {
  await openMenu(page, path);
  await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
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
    await page.waitForFunction(() => document.querySelector('[data-project-entry] small').textContent === '1' &&
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

test('更多菜单提供置顶和编辑，保留移除且支持键盘', async () => {
  const context = await browser.newContext({ colorScheme: 'dark' });
  const page = await context.newPage();
  try {
    await ready(page);
    await openMenu(page);
    assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['置顶', '编辑', '× 移除']);
    await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
    await page.getByRole('menu').screenshot({ path: new URL('../test-results/project-more-menu.png', import.meta.url).pathname });
    await page.keyboard.press('Home');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), '置顶');
    await page.keyboard.press('End');
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
    // 宿主全局重置（*{margin:0}）下仍需居中：曾因依赖 dialog 默认 auto 边距而贴左上角。
    const placement = await page.evaluate(() => {
      const r = document.querySelector('.zpa-dialog').getBoundingClientRect();
      return { dx: Math.abs((innerWidth - r.width) / 2 - r.x), dy: Math.abs((innerHeight - r.height) / 2 - r.y) };
    });
    assert.ok(placement.dx < 2 && placement.dy < 2, `弹窗应居中：dx=${placement.dx} dy=${placement.dy}`);
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
    assert.ok(Math.abs(bounds.x - (360 - bounds.width) / 2) < 2, `窄窗口也应居中：x=${bounds.x} w=${bounds.width}`);
    await page.getByLabel('项目昵称（留空恢复原名）').fill('丢弃草稿');
    await page.keyboard.press('Escape');
    assert.equal(await panel.count(), 0);
    assert.equal(await label(page).textContent(), '生产管理端');
  } finally { await context.close(); }
});

test('置顶与取消置顶跨窗口持久化，保留原节点、宿主排序与编辑功能', async () => {
  const context = await browser.newContext({ colorScheme: 'dark' });
  const page = await context.newPage();
  const other = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const order = target => target.locator('[data-testid="workspace-list"] > li').evaluateAll(nodes => nodes.map(node => node.dataset.projectEntry));
  const pin = async (target, path, action) => {
    await openMenu(target, path);
    await target.getByRole('menuitem', { name: action, exact: true }).click();
  };
  try {
    await ready(page); await ready(other);
    await page.evaluate(() => { window.originalNode = document.querySelector('[data-project-entry="/b/serverless"]'); });
    await pin(page, '/b/serverless', '置顶');
    assert.deepEqual(await order(page), ['/b/serverless', '/a/serverless', 'ssh:A', 'ssh:B']);
    await other.waitForFunction(() => document.querySelector('[data-testid="workspace-list"] > li').dataset.projectEntry === '/b/serverless');
    assert.equal(await page.evaluate(() => window.originalNode === document.querySelector('[data-project-entry="/b/serverless"]')), true);
    await pin(page, '/a/serverless', '置顶');
    assert.deepEqual(await order(page), ['/a/serverless', '/b/serverless', 'ssh:A', 'ssh:B']);
    await pin(page, '/a/serverless', '取消置顶');
    await rename(page, '置顶项目', '/b/serverless');
    assert.equal(await label(page, '/b/serverless').textContent(), '置顶项目');
    await ready(page);
    assert.deepEqual(await order(page), ['/b/serverless', '/a/serverless', 'ssh:A', 'ssh:B']);
    await page.addScriptTag({ content: source });
    assert.deepEqual(await order(page), ['/b/serverless', '/a/serverless', 'ssh:A', 'ssh:B']);
    // 宿主重排后，以最新提交的顺序作未置顶项目的基线。
    await page.evaluate(() => window.renderFixture([...window.fixtureTabs].reverse(), 9));
    await page.waitForFunction(() => document.querySelector('[data-project-entry] small').textContent === '9');
    await page.waitForFunction(() => document.querySelector('[data-testid="workspace-list"] > li').dataset.projectEntry === '/b/serverless');
    assert.deepEqual(await order(page), ['/b/serverless', 'ssh:B', 'ssh:A', '/a/serverless']);
    await pin(page, '/b/serverless', '取消置顶');
    assert.deepEqual(await order(page), ['ssh:B', 'ssh:A', '/b/serverless', '/a/serverless']);
    await pin(page, '/a/serverless', '置顶');
    await page.evaluate(() => window.__zcodeProjectAlias.dispose());
    assert.deepEqual(await order(page), ['ssh:B', 'ssh:A', '/b/serverless', '/a/serverless']);
    assert.equal(await page.locator('[data-project-entry]').count(), 4);
    assert.deepEqual(errors, []);
    assert.deepEqual(await page.evaluate(() => window.removals), []);
    assert.equal(await page.evaluate(() => window.hostClicks), 0);
  } finally { await context.close(); }
});

test('置顶保存失败保持原顺序，错误可见，不误报为已置顶', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await ready(page);
    await openMenu(page, '/b/serverless');
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('模拟存储失败'); }; });
    await page.getByRole('menuitem', { name: '置顶', exact: true }).click();
    assert.match(await page.getByRole('alert').textContent(), /保存置顶失败/);
    assert.equal(await page.locator('[data-testid="workspace-list"] > li').first().getAttribute('data-project-entry'), '/a/serverless');
    assert.equal(await page.getByRole('menuitem', { name: '取消置顶', exact: true }).count(), 0);
  } finally { await context.close(); }
});

test('仓库名称候选可填前缀和复制，识别结果不覆盖草稿，保存前不改昵称', async () => {
  const context = await browser.newContext({ colorScheme: 'dark' });
  const page = await context.newPage();
  try {
    await ready(page);
    await page.evaluate(() => {
      window.__zcodeProjectAliasNamesAvailable = true;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedName = text; } } });
    });
    await openEditor(page);
    await page.getByLabel('项目昵称（留空恢复原名）').fill('正在编辑的草稿');
    const bundle = await page.evaluate(() => window.__zcodeProjectAlias.takeNameRequests());
    assert.equal(bundle.requests.length, 1);
    assert.equal(bundle.requests[0].workspacePath, '/a/serverless');
    assert.ok(bundle.workspaces.some(row => row.workspacePath === '/a/serverless' && !row.remote));
    await page.evaluate(id => window.__zcodeProjectAlias.receiveNameSuggestions({ id, result: {
      message: '点击候选填入前缀，再输入管理端或现场作业；也可以复制',
      candidates: [{ name: 'MES 255/', source: 'SVN 仓库' }, { name: 'MES 5.5/', source: 'SVN 路径' }],
    } }), bundle.requests[0].id);
    assert.equal(await page.getByLabel('项目昵称（留空恢复原名）').inputValue(), '正在编辑的草稿');
    await page.getByRole('button', { name: '复制候选名称：MES 255/', exact: true }).click();
    assert.equal(await page.evaluate(() => window.copiedName), 'MES 255/');
    assert.equal(await page.getByLabel('项目昵称（留空恢复原名）').inputValue(), '正在编辑的草稿');
    await page.getByRole('button', { name: '使用候选名称：MES 255/', exact: true }).click();
    assert.equal(await page.getByLabel('项目昵称（留空恢复原名）').inputValue(), 'MES 255/');
    assert.equal(await label(page).textContent(), 'serverless');
    await page.keyboard.type('管理端');
    await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
    await page.getByRole('dialog').screenshot({ path: new URL('../test-results/name-suggestions.png', import.meta.url).pathname });
    await page.getByRole('button', { name: '保存', exact: true }).click();
    assert.equal(await label(page).textContent(), 'MES 255/管理端');
  } finally { await context.close(); }
});

test('候选结果按当前弹窗隔离，远端与未连接伴随加载器时不请求本机仓库', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await ready(page);
    await openEditor(page);
    assert.match(await page.locator('.zpa-suggestions-note').textContent(), /伴随加载器/);
    assert.equal((await page.evaluate(() => window.__zcodeProjectAlias.takeNameRequests())).requests.length, 0);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.evaluate(() => { window.__zcodeProjectAliasNamesAvailable = true; });
    await openEditor(page);
    const first = (await page.evaluate(() => window.__zcodeProjectAlias.takeNameRequests())).requests[0];
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await openEditor(page, '/b/serverless');
    const second = (await page.evaluate(() => window.__zcodeProjectAlias.takeNameRequests())).requests[0];
    await page.evaluate(id => window.__zcodeProjectAlias.receiveNameSuggestions({ id, result: { candidates: [{ name: '错误项目/', source: '旧请求' }] } }), first.id);
    assert.equal(await page.locator('.zpa-candidate').count(), 0);
    await page.evaluate(id => window.__zcodeProjectAlias.receiveNameSuggestions({ id, result: { candidates: [{ name: 'MES 5.5/', source: 'Git 仓库' }] } }), second.id);
    assert.equal(await page.locator('.zpa-candidate').count(), 1);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await openEditor(page, '/srv/serverless');
    assert.match(await page.locator('.zpa-suggestions-note').textContent(), /远程项目/);
    assert.equal((await page.evaluate(() => window.__zcodeProjectAlias.takeNameRequests())).requests.length, 0);
  } finally { await context.close(); }
});
