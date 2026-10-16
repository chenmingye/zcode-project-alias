/** 官方 stdio MCP 入口，只暴露本插件的数据与页面。作者：Jason.chen。 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ProjectStore, PanelError } from './store.mjs';
import names from '../runtime/name-suggestions.cjs';

export const VERSION = '0.7.0';
export const PANEL_URI = 'ui://zcode-project-alias/panel.html';
export function createServer({ store = new ProjectStore({ workspaceRoot: process.env.ZCODE_WORKSPACE_ROOT }), assetRoot = path.dirname(fileURLToPath(import.meta.url)) } = {}) {
  const server = new McpServer({ name: 'zcode-project-alias', version: VERSION });
  const register = (name, description, inputSchema, execute, { appOnly = true, readOnly = false } = {}) => {
    server.registerTool(name, { description, inputSchema,
      annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { resourceUri: PANEL_URI, surface: 'projects', visibility: appOnly ? ['app'] : ['model', 'app'] } },
    }, async input => {
      try {
        const result = await execute(input);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        const result = { error: { code: error instanceof PanelError ? error.code : 'operation_failed',
          message: error instanceof PanelError ? error.message : '操作失败，未确认保存成功。请刷新后重试，检查插件数据目录的访问权限。' } };
        return { isError: true, content: [{ type: 'text', text: result.error.message }], structuredContent: result };
      }
    });
  };
  register('open_project_manager', '打开项目昵称管理面板。昵称和置顶只影响插件面板，不更改原生侧栏、真实目录或代码。', {}, async () => {
    const state = await store.list();
    // 模型只需知道面板已打开；全部项目路径由页面自己的工具读取，不放进主对话。
    return { opened: true, projectCount: state.projects.length, nativeSidebarSupported: false };
  }, { appOnly: false });
  register('list_projects', '刷新本机项目列表，只读取 ZCode 项目路径并保存到插件独立清单。', {}, () => store.list());
  register('import_recent_projects', '导入 ZCode 最近项目到本面板，恢复此前从面板移除的最近项目。', {}, () => store.list({ recent: true }));
  register('add_project', '将本地文件夹添加到昵称面板，不向 ZCode 原生项目列表添加条目。', { path: z.string().min(1).max(4096) }, ({ path }) => store.add(path));
  const id = z.string().regex(/^[a-f0-9]{64}$/);
  const expectedRevision = z.number().int().positive();
  register('edit_project', '保存项目昵称，留空恢复原名。使用页面读取到的项目版本防止覆盖其他窗口修改。',
    { id, expectedRevision, nickname: z.string().max(80) }, input => store.change(input));
  register('pin_project', '在插件面板中置顶或取消置顶。', { id, expectedRevision, pinned: z.boolean() }, input => store.change(input));
  register('remove_project', '仅从面板移除项目，不删除文件、不移除 ZCode 原生项目或聊天。',
    { id, expectedRevision }, input => store.change({ ...input, remove: true }));
  register('suggest_names', '从已登记项目的本地 SVN/Git 元数据生成昵称前缀，不连接远端仓库。',
    { id }, async ({ id }) => names.suggest((await store.project(id)).path), { readOnly: true });
  server.registerResource('project-manager', PANEL_URI, { mimeType: 'text/html;profile=mcp-app' }, async () => ({
    contents: [{ uri: PANEL_URI, mimeType: 'text/html;profile=mcp-app', text: await readFile(path.join(assetRoot, 'panel.html'), 'utf8'),
      _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } } }],
  }));
  return server;
}

// 打包后的独立 server.mjs 不依赖仓库 node_modules；测试直接导入工厂时不启动 stdio。
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await createServer().connect(new StdioServerTransport());
}
