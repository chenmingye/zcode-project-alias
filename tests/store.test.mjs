import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProjectStore } from '../plugins/zcode-project-alias/src/store.mjs';
const fixture = async fn => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zpa-store-'));
  const settingsPath = path.join(root, 'setting.json');
  const dataDir = path.join(root, 'data');
  const a = path.join(root, 'MES 255', 'serverless');
  const b = path.join(root, 'MES 5.5', 'serverless');
  await fs.mkdir(a, { recursive: true }); await fs.mkdir(b, { recursive: true });
  const source = JSON.stringify({ lastWorkspaceSession: [{ kind: 'local', workspacePath: a }, { kind: 'local', workspacePath: b }, { kind: 'remote', workspacePath: '/remote' }], recentProjects: [a, b] });
  await fs.writeFile(settingsPath, source);
  try { await fn({ root, a, b, dataDir, settingsPath, source, store: new ProjectStore({ dataDir, settingsPath }) }); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
};
test('同名目录隔离昵称，置顶取消后恢复顺序，重开持久化且宿主设置未改', () => fixture(async ({ store, dataDir, settingsPath, source }) => {
  let result = await store.list(); assert.equal(result.remoteCount, 1); assert.equal(result.nativeSidebarSupported, false);
  const [a, b] = result.projects;
  result = await store.change({ id: a.id, expectedRevision: 1, nickname: 'MES 255/管理端' });
  assert.equal(result.projects[1].name, 'serverless');
  result = await store.change({ id: b.id, expectedRevision: 1, pinned: true });
  assert.equal(result.projects[0].id, b.id);
  result = await store.change({ id: b.id, expectedRevision: 2, pinned: false });
  assert.equal(result.projects[0].id, a.id);
  const reopened = new ProjectStore({ dataDir, settingsPath });
  assert.equal((await reopened.list()).projects[0].name, 'MES 255/管理端');
  await store.change({ id: a.id, expectedRevision: 2, nickname: '  ' });
  assert.equal((await store.list()).projects[0].name, 'serverless');
  assert.equal(await fs.readFile(settingsPath, 'utf8'), source);
  assert.equal((await fs.stat(store.file)).mode & 0o777, 0o600);
}));
test('并发窗口保存不同项目互不覆盖，同项目旧版本被拒绝，原昵称保留', () => fixture(async ({ store, dataDir, settingsPath }) => {
  const [a, b] = (await store.list()).projects;
  const second = new ProjectStore({ dataDir, settingsPath });
  await Promise.all([store.change({ id: a.id, expectedRevision: 1, nickname: '甲' }), second.change({ id: b.id, expectedRevision: 1, nickname: '乙' })]);
  assert.deepEqual((await store.list()).projects.map(p => p.name), ['甲', '乙']);
  await assert.rejects(second.change({ id: a.id, expectedRevision: 1, nickname: '覆盖' }), error => error.code === 'conflict');
  assert.equal((await store.list()).projects[0].name, '甲');
}));
test('从面板移除不会重新自动导入，不删除项目；显式导入最近项目可以恢复', () => fixture(async ({ store, a }) => {
  const [project] = (await store.list()).projects;
  await store.change({ id: project.id, expectedRevision: 1, nickname: '保留的昵称' });
  await store.change({ id: project.id, expectedRevision: 2, remove: true });
  assert.equal((await store.list()).projects.length, 1);
  assert.ok((await fs.stat(a)).isDirectory());
  const restored = await store.list({ recent: true });
  assert.equal(restored.projects.length, 2);
  assert.equal(restored.projects.find(p => p.id === project.id).nickname, '保留的昵称');
  await assert.rejects(store.change({ id: project.id, expectedRevision: 2, nickname: '旧页面' }), error => error.code === 'conflict');
}));
test('添加路径归一化并去除软链接重复，拒绝相对路径、普通文件和非法昵称', () => fixture(async ({ store, root, a }) => {
  await store.list();
  await fs.symlink(a, path.join(root, 'alias'));
  assert.equal((await store.add(path.join(root, 'alias'))).projects.length, 2);
  await assert.rejects(store.add('./a'), /绝对路径/);
  await assert.rejects(store.add(path.join(root, 'missing')), /不存在/);
  await assert.rejects(store.add(path.join(root, 'setting.json')), /不是文件夹/);
  const [project] = (await store.list()).projects;
  for (const nickname of ['a\nb', 'x'.repeat(81)]) await assert.rejects(store.change({ id: project.id, expectedRevision: 1, nickname }), /昵称/);
}));
test('损坏文件和保存失败不覆盖原数据，锁与临时文件被清理', () => fixture(async ({ store, dataDir, settingsPath }) => {
  const [project] = (await store.list()).projects;
  const original = await fs.readFile(store.file, 'utf8');
  const broken = new ProjectStore({ dataDir, settingsPath, beforeWrite: () => { throw new Error('injected write failure'); } });
  await assert.rejects(broken.change({ id: project.id, expectedRevision: 1, nickname: '未保存' }), /injected/);
  assert.equal(await fs.readFile(store.file, 'utf8'), original);
  assert.deepEqual(await fs.readdir(dataDir), ['projects.json']);
  await fs.writeFile(store.file, '{broken');
  await assert.rejects(store.list(), error => error.code === 'storage_unreadable');
  assert.equal(await fs.readFile(store.file, 'utf8'), '{broken');
}));
test('宿主清单为空值或损坏时保留已存项目，不覆盖宿主文件', () => fixture(async ({ store, settingsPath }) => {
  await store.list();
  for (const source of ['null', '{broken']) {
    await fs.writeFile(settingsPath, source);
    const result = await store.list();
    assert.equal(result.projects.length, 2);
    assert.match(result.warning, /无法读取/);
    assert.equal(await fs.readFile(settingsPath, 'utf8'), source);
  }
}));
