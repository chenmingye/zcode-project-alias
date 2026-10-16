/** MCP Apps 页面：所有持久化经插件工具完成，不访问主应用 DOM。作者：Jason.chen。 */
import { App } from '@modelcontextprotocol/ext-apps';
const $ = selector => document.querySelector(selector);
const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const app = new App({ name: 'zcode-project-alias', version: '0.7.0' }, { availableDisplayModes: ['inline', 'fullscreen'] });
let state = { projects: [] };
let editing = null;
let busy = false;
let connected = false;
let requestSequence = 0;
const showError = (message, target = $('#error')) => { target.textContent = message || ''; target.hidden = !message; };
const call = async (name, args = {}) => {
  const response = await app.callServerTool({ name, arguments: args });
  if (response.isError) throw new Error(response.structuredContent?.error?.message || response.content?.find(c => c.type === 'text')?.text || '操作失败，请重试。');
  const value = response.structuredContent;
  if (!value) throw new Error('插件没有返回完整数据，请更新插件后重新打开面板。');
  return value;
};
const accept = value => {
  if (!Array.isArray(value?.projects)) return;
  // 定时刷新只在数据实际变化时重建列表，保留焦点、展开菜单及辅助功能控件身份。
  if (value.revision === state.revision && value.warning === state.warning && value.remoteCount === state.remoteCount) return;
  state = value;
  render();
};
const setBusy = value => {
  busy = value;
  document.querySelectorAll('button').forEach(button => { button.disabled = value; });
};
const run = async (action, errorTarget = $('#error')) => {
  if (busy) return;
  setBusy(true); showError('', errorTarget);
  try { await action(); }
  catch (error) { showError(error.message || '连接中断，请刷新面板。', errorTarget); }
  finally { setBusy(false); }
};
const folderIcon = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'folder-icon'); svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS(svg.namespaceURI, 'path'); shape.setAttribute('d', 'M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l3 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2ZM2 10h20');
  svg.append(shape); return svg;
};
function render() {
  const search = $('#search').value.trim().toLocaleLowerCase();
  const projects = state.projects.filter(p => `${p.name} ${p.path}`.toLocaleLowerCase().includes(search));
  $('#projects').replaceChildren();
  $('#empty').hidden = projects.length > 0;
  $('#empty').textContent = state.projects.length ? '没有匹配的项目，试试搜索路径。' : '面板中还没有项目。添加文件夹，或导入 ZCode 最近项目。';
  $('#notice').textContent = [state.warning, state.remoteCount ? `${state.remoteCount} 个远程项目未导入；当前只支持本机文件夹。` : ''].filter(Boolean).join(' ');
  for (const project of projects) {
    const article = make('article', '', 'project'); article.dataset.projectId = project.id;
    const head = make('div', '', 'project-head'); head.append(folderIcon(), make('h3', project.name, 'project-name'));
    if (project.pinned) head.append(make('span', '已置顶', 'pin'));
    const details = make('details', '', 'menu');
    const summary = make('summary', '⋯'); summary.setAttribute('aria-label', `${project.name} 的更多操作`);
    details.append(summary);
    details.addEventListener('toggle', () => {
      if (details.open) document.querySelectorAll('.menu[open]').forEach(other => { if (other !== details) other.open = false; });
    });
    const menu = make('div', '', 'menu-pop');
    const item = (text, action) => { const button = make('button', text); button.onclick = () => { details.open = false; action(); }; menu.append(button); };
    item(project.pinned ? '取消置顶' : '置顶', () => run(async () => accept(await call('pin_project', { id: project.id, expectedRevision: project.revision, pinned: !project.pinned }))));
    item('编辑', () => openEditor(project));
    item('从面板移除', () => run(async () => accept(await call('remove_project', { id: project.id, expectedRevision: project.revision }))));
    details.append(menu); head.append(details);
    article.append(head, make('p', project.path, 'project-path')); $('#projects').append(article);
  }
}
async function openEditor(project) {
  if (busy) return;
  editing = project;
  const sequence = ++requestSequence;
  $('#nickname').value = project.nickname || project.name;
  $('#source').value = project.path;
  $('#suggestions').replaceChildren(); $('#copy-fallback').hidden = true;
  $('#suggestion-note').textContent = '正在读取本地仓库信息…';
  showError('', $('#editor .dialog-error'));
  $('#editor').showModal(); $('#nickname').focus(); $('#nickname').select();
  try {
    const result = await call('suggest_names', { id: project.id });
    if (sequence !== requestSequence || !$('#editor').open) return;
    $('#suggestion-note').textContent = result.message;
    for (const candidate of result.candidates || []) {
      const row = make('div', '', 'candidate');
      const use = make('button', candidate.name, 'candidate-use'); use.type = 'button'; use.setAttribute('aria-label', `使用候选名称：${candidate.name}`);
      use.onclick = () => { $('#nickname').value = candidate.name; $('#nickname').focus(); $('#nickname').setSelectionRange(candidate.name.length, candidate.name.length); };
      const copy = make('button', '复制', 'candidate-copy'); copy.type = 'button'; copy.setAttribute('aria-label', `复制候选名称：${candidate.name}`);
      copy.onclick = async () => {
        try { await navigator.clipboard.writeText(candidate.name); copy.textContent = '已复制'; }
        catch {
          const fallback = $('#copy-fallback'); fallback.value = candidate.name; fallback.hidden = false; fallback.focus(); fallback.select();
          $('#suggestion-note').textContent = '系统未允许直接复制，候选已选中，请按 ⌘C（Windows / Linux 按 Ctrl+C）。';
        }
      };
      row.append(use, make('span', candidate.source, 'candidate-source'), copy); $('#suggestions').append(row);
    }
  } catch (error) {
    if (sequence === requestSequence && $('#editor').open) $('#suggestion-note').textContent = `候选暂不可用：${error.message}。仍可手动输入昵称。`;
  }
}
$('#search').oninput = render;
$('#refresh').onclick = () => run(async () => accept(await call('list_projects')));
$('#import').onclick = () => run(async () => accept(await call('import_recent_projects')));
$('#add').onclick = () => {
  showError('', $('#add-dialog .dialog-error')); $('#folder-path').value = ''; $('#add-dialog').showModal();
};
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.querySelectorAll('.cancel,.close').forEach(button => { button.onclick = () => { if (!busy) dialog.close(); }; });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { if (dialog.id === 'editor') { editing = null; requestSequence++; } });
}
$('#edit-form').onsubmit = event => {
  event.preventDefault();
  if (!editing) return;
  const project = editing;
  run(async () => {
    const result = await call('edit_project', { id: project.id, expectedRevision: project.revision, nickname: $('#nickname').value });
    accept(result); $('#editor').close();
  }, $('#editor .dialog-error'));
};
$('#restore').onclick = () => { $('#nickname').value = ''; $('#nickname').focus(); };
$('#add-form').onsubmit = event => {
  event.preventDefault();
  run(async () => { accept(await call('add_project', { path: $('#folder-path').value.trim() })); $('#add-dialog').close(); }, $('#add-dialog .dialog-error'));
};
const theme = () => { document.documentElement.dataset.theme = app.getHostContext()?.theme || ''; };
app.onhostcontextchanged = theme;
app.ontoolresult = result => { if (!busy && !$('#editor').open && !$('#add-dialog').open) accept(result.structuredContent); };
let poll;
app.onteardown = async () => { connected = false; clearInterval(poll); requestSequence++; return {}; };
try {
  await app.connect(); connected = true; theme();
  await run(async () => accept(await call('list_projects')));
  $('#loading').hidden = true;
  poll = setInterval(() => {
    if (connected && !busy && !document.hidden && !$('#editor').open && !$('#add-dialog').open && !document.querySelector('.menu[open]')) {
      run(async () => accept(await call('list_projects')));
    }
  }, 10000);
} catch {
  $('#loading').hidden = true;
  showError('无法连接项目昵称服务。请在 ZCode 的本地工作区内打开此插件面板；检查插件已启用后重新打开。');
  setBusy(true);
}
