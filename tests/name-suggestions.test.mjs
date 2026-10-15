import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import service from '../plugins/zcode-project-alias/runtime/name-suggestions.cjs';
const exec = promisify(execFile);
const temporary = async fn => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zpa-names-'));
  try { await fn(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
};

test('SVN 仓库名、中文路径与分支候选只读提取，不暴露 URL 凭据', () => temporary(async root => {
  const wc = path.join(root, 'copy');
  await fs.mkdir(path.join(wc, '.svn'), { recursive: true });
  const project = path.join(wc, 'frontend', 'admin');
  await fs.mkdir(project, { recursive: true });
  const calls = [];
  const result = await service.inspect(project, async (command, args) => {
    calls.push([command, args]);
    return `<info><entry><url>https://u:FAKE_SECRET@example.org/svn/MES%20255/branches/MES%205.5/%E7%AE%A1%E7%90%86%E7%AB%AF</url><repository><root>https://u:FAKE_SECRET@example.org/svn/MES%20255</root></repository><wc-info><wcroot-abspath>${wc}</wcroot-abspath></wc-info></entry></info>`;
  });
  assert.equal(result.vcs, 'svn');
  assert.ok(result.candidates.some(row => row.name === 'MES 255/'));
  assert.ok(result.candidates.some(row => row.name === 'MES 5.5/'));
  assert.ok(result.candidates.some(row => row.name === '管理端/'));
  assert.ok(!result.candidates.some(row => row.name === 'branches/'));
  assert.equal(JSON.stringify(result).includes('FAKE_SECRET'), false);
  assert.deepEqual(calls, [['svn', ['info', '--xml', '--non-interactive', '--depth', 'empty', '--', `${await fs.realpath(project)}@`]]]);
}));

test('真实 Git 独立 git-dir 与未提交分支，命令只读且不需要网络', () => temporary(async root => {
  const wc = path.join(root, 'MES 5.5');
  await exec('git', ['init', '--separate-git-dir', path.join(root, 'metadata.git'), '-b', 'MES-5.5', wc]);
  await exec('git', ['-C', wc, 'config', 'remote.origin.url', 'git@example.org:org/MES%20255.git']);
  const project = path.join(wc, 'admin');
  await fs.mkdir(project);
  const result = await service.inspect(project);
  assert.equal(result.status, 'ok');
  assert.equal(result.vcs, 'git');
  for (const name of ['MES 255/', 'MES-5.5/', 'MES 5.5/']) assert.ok(result.candidates.some(row => row.name === name), name);
}));

test('真实本地 SVN 工作副本能识别带空格的仓库名，不连接业务服务器', () => temporary(async root => {
  const repo = path.join(root, 'MES 255');
  await exec('svnadmin', ['create', repo]);
  const wc = path.join(root, 'copy');
  await exec('svn', ['checkout', '--non-interactive', pathToFileURL(repo).href, wc]);
  const moved = path.join(root, 'copy@branch');
  await fs.rename(wc, moved);
  const result = await service.inspect(moved);
  assert.equal(result.status, 'ok');
  assert.equal(result.vcs, 'svn');
  assert.ok(result.candidates.some(row => row.name === 'MES 255/'));
}));

test('非仓库、缺命令、路径失效与控制字符均有有界回退', () => temporary(async root => {
  const project = path.join(root, 'MES 255', 'branches', 'admin');
  await fs.mkdir(project, { recursive: true });
  let result = await service.inspect(project);
  assert.equal(result.vcs, null);
  assert.ok(result.candidates.some(row => row.name === 'MES 255/'));
  await fs.mkdir(path.join(root, 'MES 255', '.svn'));
  result = await service.inspect(project, async () => { throw new Error('missing executable FAKE_SECRET'); });
  assert.equal(result.status, 'unavailable');
  assert.ok(result.candidates.some(row => row.name === 'MES 255/'));
  assert.equal(JSON.stringify(result).includes('FAKE_SECRET'), false);
  assert.equal((await service.inspect('https://example.org/project')).status, 'unavailable');
  assert.equal((await service.inspect(path.join(root, 'missing'))).status, 'unavailable');
  const rows = service.candidatesFrom(project, { vcs: 'svn', repositoryName: 'bad\nname', segments: Array.from({ length: 30 }, (_, i) => `MES ${i}`) });
  assert.ok(rows.length <= 8);
  assert.ok(rows.every(row => !row.name.includes('\n')));
  const normalized = service.candidatesFrom(project, { vcs: 'svn', repositoryName: 'demo-MES5.5', segments: ['DEMO-mes5.5'] });
  assert.ok(normalized.some(row => row.name === 'MES 5.5/' && row.source.includes('格式整理')));
  assert.equal(normalized.filter(row => row.name.toLowerCase() === 'demo-mes5.5/').length, 1);
}));
