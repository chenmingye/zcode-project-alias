import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const plugin = new URL('../plugins/zcode-project-alias/', import.meta.url);
test('仓库外独立产物：真实 stdio 握手、页面读取、昵称保存、版本冲突和候选', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zpa-protocol-'));
  const work = path.join(root, 'MES 255', 'serverless');
  await fs.mkdir(work, { recursive: true });
  await fs.copyFile(new URL('dist/server.mjs', plugin), path.join(root, 'server.mjs'));
  await fs.copyFile(new URL('dist/panel.html', plugin), path.join(root, 'panel.html'));
  const client = new Client({ name: 'project-alias-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'server.mjs')], cwd: root,
    env: { ...process.env, ZCODE_DATA_BASE_DIR: root, ZCODE_WORKSPACE_ROOT: work }, stderr: 'pipe' });
  let stderr = ''; transport.stderr?.on('data', value => { stderr += value; });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 8);
    assert.deepEqual(tools.find(t => t.name === 'edit_project')._meta.ui.visibility, ['app']);
    const content = (await client.readResource({ uri: 'ui://zcode-project-alias/panel.html' })).contents[0];
    assert.match(content.text, /项目昵称/); assert.match(content.text, /原生项目侧栏/);
    assert.equal(content.mimeType, 'text/html;profile=mcp-app');
    const opened = await client.callTool({ name: 'open_project_manager', arguments: {} });
    assert.equal(opened.structuredContent.projectCount, 1);
    assert.equal(opened.structuredContent.projects, undefined);
    const list = await client.callTool({ name: 'list_projects', arguments: {} });
    assert.equal(list.isError, undefined);
    const [project] = list.structuredContent.projects;
    const result = await client.callTool({ name: 'edit_project', arguments: { id: project.id, expectedRevision: 1, nickname: 'MES 255/管理端' } });
    assert.equal(result.structuredContent.projects[0].name, 'MES 255/管理端');
    const conflict = await client.callTool({ name: 'edit_project', arguments: { id: project.id, expectedRevision: 1, nickname: '不应覆盖' } });
    assert.equal(conflict.isError, true); assert.equal(conflict.structuredContent.error.code, 'conflict');
    const candidate = await client.callTool({ name: 'suggest_names', arguments: { id: project.id } });
    assert.ok(candidate.structuredContent.candidates.some(p => p.name === 'MES 255/'));
    const missing = await client.callTool({ name: 'suggest_names', arguments: { id: '0'.repeat(64) } });
    assert.equal(missing.structuredContent.error.code, 'not_found');
    assert.equal(stderr, '');
  } catch (error) { console.error(stderr); throw error; } finally { await client.close(); await fs.rm(root, { recursive: true, force: true }); }
});
