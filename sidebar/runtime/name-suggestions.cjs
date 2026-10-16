/**
 * 从本地 SVN/Git 元数据生成名称候选。作者：Jason.chen。
 * 只读工作副本：不访问服务器，不调用更新、拉取、提交或项目脚本。
 */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const GENERIC = /^(?:svn|git|repos?|repositories|projects?|workspace|workspaces|src|trunk|branches|branch|tags|frontend|backend|desktop|documents)$/i;
const cache = new Map();
const clean = name => String(name).trim().replace(/\.git$/i, '');
const candidatesFrom = (workspace, metadata = {}) => {
  const candidates = [];
  const push = (name, source) => {
    if (candidates.length < 8 && !candidates.some(item => item.name.toLowerCase() === name.toLowerCase())) candidates.push({ name, source });
  };
  const add = (value, source) => {
    if (candidates.length >= 8) return;
    const base = clean(value).replace(/\/+$/, '');
    if (!base || GENERIC.test(base) || /[\u0000-\u001f\u007f]/u.test(base) || base.length > 79) return;
    // 提供可选的显示格式，不改仓库真名；符合用户常用的 MES + 编号/版本写法。
    const mes = base.match(/(?:^|[-_\s])MES[-_\s]?(\d+(?:\.\d+)*)(?=$|[-_\s/])/i);
    if (mes) push(`MES ${mes[1]}/`, `${source} · 格式整理`);
    push(`${base}/`, source);
  };
  if (metadata.repositoryName) add(metadata.repositoryName, `${metadata.vcs.toUpperCase()} 仓库`);
  for (const name of (metadata.segments || []).slice(0, 2)) add(name, `${metadata.vcs.toUpperCase()} 路径`);
  if (metadata.branch) add(metadata.branch, 'Git 分支');
  if (metadata.root) add(path.basename(metadata.root), '工作副本根目录');
  let parent = path.dirname(workspace);
  const home = os.homedir();
  for (let depth = 0; depth < 5 && parent !== path.dirname(parent) && parent !== home; depth++) {
    add(path.basename(parent), '本地上级目录');
    parent = path.dirname(parent);
  }
  for (const name of (metadata.segments || []).slice(2)) add(name, `${metadata.vcs.toUpperCase()} 路径`);
  return candidates.slice(0, 8);
};
const urlSegments = value => {
  try {
    // 只返回路径名字，不把 remote 中的用户名、密码或 query 带进界面/日志。
    const normalized = /^[\w.-]+@[^:]+:/.test(value) ? `ssh://${value.replace(':', '/')}` : value;
    return new URL(normalized).pathname.split('/').filter(Boolean).map(part => {
      try { return decodeURIComponent(part); } catch { return part; }
    });
  } catch { return []; }
};
const xmlText = (xml, tag) => {
  const value = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] || '';
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    if (entity[0] === '#') return String.fromCodePoint(parseInt(entity.slice(entity[1].toLowerCase() === 'x' ? 2 : 1), entity[1].toLowerCase() === 'x' ? 16 : 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity.toLowerCase()];
  });
};
const readCommand = async (command, args) => {
  const { stdout } = await exec(command, args, {
    encoding: 'utf8', timeout: 4000, maxBuffer: 256 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
  });
  return stdout.trim();
};
const locate = async workspace => {
  let current = workspace;
  for (let depth = 0; depth < 64; depth++) {
    for (const vcs of ['svn', 'git']) {
      try { await fs.lstat(path.join(current, `.${vcs}`)); return { vcs, root: current }; }
      catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
};
const inspect = async (workspace, run = readCommand) => {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace) || workspace.includes('\0')) {
    return { status: 'unavailable', candidates: [], message: '仅支持本地项目的绝对路径' };
  }
  let real;
  try {
    real = await fs.realpath(workspace);
    if (!(await fs.stat(real)).isDirectory()) throw new Error('not a directory');
  } catch { return { status: 'unavailable', candidates: [], message: '项目目录不存在或无法读取' }; }
  let metadata = {};
  try {
    const found = await locate(real);
    if (!found) return { status: 'ok', vcs: null, candidates: candidatesFrom(real), message: '未发现 SVN/Git 工作副本，显示本地目录候选' };
    metadata = found;
    if (found.vcs === 'svn') {
      const xml = await run('svn', ['info', '--xml', '--non-interactive', '--depth', 'empty', '--', `${real}@`]);
      const rootUrl = xmlText(xml, 'root');
      const url = xmlText(xml, 'url');
      if (!rootUrl || !url) throw new Error('invalid svn metadata');
      const rootSegments = urlSegments(rootUrl);
      const segments = urlSegments(url);
      metadata.repositoryName = rootSegments.at(-1);
      metadata.segments = segments.slice(rootSegments.length).filter(part => !GENERIC.test(part));
      metadata.root = xmlText(xml, 'wcroot-abspath') || found.root;
    } else {
      const git = args => run('git', ['-C', real, '-c', 'core.fsmonitor=false', ...args]);
      metadata.root = await git(['rev-parse', '--show-toplevel']);
      try { metadata.repositoryName = urlSegments(await git(['config', '--get', 'remote.origin.url'])).at(-1); } catch { /* 无 remote 的本地仓库仍有根目录候选。 */ }
      try { metadata.branch = await git(['symbolic-ref', '--quiet', '--short', 'HEAD']); } catch { /* detached HEAD 没有分支名。 */ }
    }
    return { status: 'ok', vcs: found.vcs, candidates: candidatesFrom(real, metadata), message: '点击候选填入前缀，再输入所需后缀；也可以复制，不会自动保存' };
  } catch {
    return { status: 'unavailable', vcs: metadata.vcs || null, candidates: candidatesFrom(real, metadata), message: '无法读取仓库元数据或缺少 SVN/Git 命令，显示可用的本地目录候选' };
  }
};
const suggest = async workspace => {
  const previous = cache.get(workspace);
  if (previous && Date.now() - previous.time < 60000) return previous.result;
  const result = inspect(workspace);
  cache.set(workspace, { time: Date.now(), result });
  if (cache.size > 50) cache.delete(cache.keys().next().value);
  return result;
};
module.exports = { inspect, suggest, candidatesFrom, urlSegments };
