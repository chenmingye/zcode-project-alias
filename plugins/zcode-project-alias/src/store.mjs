/**
 * 项目昵称面板的独立数据层。作者：Jason.chen。
 * 只读宿主的本地项目目录清单；昵称和置顶写入插件自己的文件，绝不写宿主设置。
 * 多个工作区会启动不同 MCP 进程，因此每次操作重新读取，并用文件锁串行修改。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';

export class PanelError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export const projectId = value => createHash('sha256').update(value).digest('hex');
const invalid = message => { throw new PanelError('invalid_input', message); };
const validName = value => typeof value === 'string' && value.length <= 80 && !/[\u0000-\u001f\u007f]/u.test(value);
const validPath = value => typeof value === 'string' && path.isAbsolute(value) && value.length <= 4096 && !/[\u0000-\u001f\u007f]/u.test(value);
const empty = () => ({ schema: 1, revision: 0, projects: [], hidden: [] });

export class ProjectStore {
  constructor({ dataDir, settingsPath, workspaceRoot = '', beforeWrite } = {}) {
    const base = process.env.ZCODE_DATA_BASE_DIR || path.join(os.homedir(), '.zcode');
    this.dataDir = dataDir || path.join(base, 'zcode-project-alias', 'panel');
    this.file = path.join(this.dataDir, 'projects.json');
    this.settingsPath = settingsPath || path.join(base, 'v2', 'setting.json');
    this.workspaceRoot = workspaceRoot;
    this.beforeWrite = beforeWrite;
  }
  async read() {
    let value;
    try { value = JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return empty();
      throw new PanelError('storage_unreadable', '无法读取项目昵称数据。原文件已保留，请检查文件权限或恢复备份。');
    }
    if (value?.schema !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
        !Array.isArray(value.projects) || value.projects.length > 500 || !Array.isArray(value.hidden) ||
        value.hidden.length > 1000 || value.hidden.some(id => !/^[a-f0-9]{64}$/.test(id)) ||
        new Set(value.projects.map(p => p?.id)).size !== value.projects.length || value.projects.some(p =>
          !p || !validPath(p.path) || p.id !== projectId(p.path) || !validName(p.nickname) ||
          typeof p.pinned !== 'boolean' || !Number.isSafeInteger(p.revision) || p.revision < 1)) {
      throw new PanelError('storage_invalid', '项目昵称数据格式不正确，未覆盖原文件。请从备份恢复。');
    }
    return value;
  }
  async transaction(change) {
    await fs.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    const lock = path.join(this.dataDir, 'write.lock');
    const deadline = Date.now() + 4000;
    for (;;) {
      try { await fs.mkdir(lock, { mode: 0o700 }); break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (Date.now() >= deadline) throw new PanelError('storage_busy', '另一个窗口正在保存，或上次保存中断。请稍后重试；持续出现时检查插件数据目录的 write.lock。');
        await new Promise(resolve => setTimeout(resolve, 30));
      }
    }
    const temporary = path.join(this.dataDir, `.projects-${randomUUID()}.tmp`);
    try {
      const state = await this.read();
      const changed = await change(state);
      if (changed) {
        state.revision++;
        await this.beforeWrite?.();
        const handle = await fs.open(temporary, 'wx', 0o600);
        try { await handle.writeFile(JSON.stringify(state, null, 2) + '\n'); await handle.sync(); }
        finally { await handle.close(); }
        await fs.rename(temporary, this.file);
      }
      return state;
    } finally {
      await fs.rm(temporary, { force: true });
      await fs.rmdir(lock);
    }
  }
  async normalized(value, mustExist = false) {
    if (!validPath(value)) invalid('请输入本地文件夹的完整绝对路径。');
    let real = path.normalize(value);
    try {
      real = await fs.realpath(real);
      if (!(await fs.stat(real)).isDirectory()) invalid('所选路径不是文件夹。');
    } catch (error) {
      if (error instanceof PanelError) throw error;
      if (mustExist) invalid('文件夹不存在或无法访问，请检查路径与系统权限。');
    }
    return real;
  }
  async discover(recent = false) {
    let settings = {};
    let warning = '';
    try {
      settings = JSON.parse(await fs.readFile(this.settingsPath, 'utf8'));
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('invalid settings');
    }
    catch (error) {
      settings = {};
      warning = error.code === 'ENOENT' ? '尚未找到 ZCode 本地项目清单，可以手动添加文件夹。' : '无法读取 ZCode 项目清单，已保留面板中的项目。';
    }
    const sessions = Array.isArray(settings.lastWorkspaceSession) ? settings.lastWorkspaceSession : [];
    const remoteCount = sessions.filter(p => p?.kind === 'remote').length;
    const paths = sessions.filter(p => p?.kind === 'local').map(p => p.workspacePath);
    if (this.workspaceRoot) paths.unshift(this.workspaceRoot);
    if (recent && Array.isArray(settings.recentProjects)) paths.push(...settings.recentProjects);
    const unique = [...new Set(paths.filter(validPath))].slice(0, 500);
    return { paths: [...new Set(await Promise.all(unique.map(p => this.normalized(p))))], warning, remoteCount };
  }
  async list({ recent = false } = {}) {
    const found = await this.discover(recent);
    const state = await this.transaction(state => {
      let changed = false;
      for (const workspace of found.paths) {
        const id = projectId(workspace);
        if (state.projects.some(p => p.id === id)) {
          if (recent && state.hidden.includes(id)) {
            state.hidden = state.hidden.filter(value => value !== id);
            state.projects.find(p => p.id === id).revision++;
            changed = true;
          }
          continue;
        }
        if (state.projects.length >= 500) break;
        if (!recent && state.hidden.includes(id)) continue;
        state.hidden = state.hidden.filter(value => value !== id);
        state.projects.push({ id, path: workspace, nickname: '', pinned: false, revision: 1 });
        changed = true;
      }
      return changed;
    });
    return this.present(state, found);
  }
  present(state, { warning = '', remoteCount = 0 } = {}) {
    return { revision: state.revision, warning, remoteCount, nativeSidebarSupported: false,
      projects: state.projects.map((p, index) => ({ ...p, name: p.nickname || path.basename(p.path) || p.path, order: index }))
        .filter(p => !state.hidden.includes(p.id))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order) };
  }
  async add(workspace) {
    const real = await this.normalized(workspace, true);
    return this.present(await this.transaction(state => {
      const id = projectId(real);
      if (state.projects.some(p => p.id === id)) {
        const hidden = state.hidden.includes(id);
        state.hidden = state.hidden.filter(value => value !== id);
        if (hidden) state.projects.find(p => p.id === id).revision++;
        return hidden;
      }
      if (state.projects.length >= 500) invalid('最多管理 500 个项目，请先从面板移除不用的条目。');
      state.hidden = state.hidden.filter(value => value !== id);
      state.projects.push({ id, path: real, nickname: '', pinned: false, revision: 1 });
      return true;
    }));
  }
  async change({ id, expectedRevision, nickname, pinned, remove = false }) {
    if (!/^[a-f0-9]{64}$/.test(id) || !Number.isSafeInteger(expectedRevision)) invalid('项目标识或版本不正确，请刷新面板。');
    if (nickname !== undefined && !validName(nickname)) invalid('昵称最多 80 个字符，不能包含换行或控制字符。');
    if (pinned !== undefined && typeof pinned !== 'boolean') invalid('置顶状态必须为布尔值。');
    return this.present(await this.transaction(state => {
      const record = state.projects.find(p => p.id === id);
      if (!record || state.hidden.includes(id)) throw new PanelError('not_found', '项目已从面板移除，请刷新列表。');
      if (record.revision !== expectedRevision) throw new PanelError('conflict', '另一个窗口已修改此项目。请刷新列表，再重新编辑；当前输入没有自动保存。');
      if (remove) {
        // 移除仅隐藏条目，再添加时可恢复昵称与置顶，避免误操作丢失用户数据。
        state.hidden = [...state.hidden.filter(value => value !== id), id].slice(-1000);
        record.revision++;
      } else {
        if (nickname !== undefined) record.nickname = nickname.trim();
        if (pinned !== undefined) record.pinned = pinned;
        record.revision++;
      }
      return true;
    }));
  }
  async project(id) {
    const record = (await this.read()).projects.find(p => p.id === id);
    if (!record) throw new PanelError('not_found', '项目不在面板中，请刷新或先添加文件夹。');
    return record;
  }
}
