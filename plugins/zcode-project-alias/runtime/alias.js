/**
 * ZCode 项目昵称界面。作者：Jason.chen
 * 由本插件自己的 companion.cjs 通过匿名管道加载；安装器不读取其他插件。
 * 只读 React 节点取得项目身份与宿主顺序，在原列表内调整置顶显示、名称和本扩展界面，
 * 不写宿主 store、不调用会话接口。React 私有结构不兼容时跳过该项目。
 */
(() => {
  'use strict';
  const GLOBAL = '__zcodeProjectAlias';
  const VERSION = '0.6.0';
  const PREFIX = 'zcode.project-alias.v1:';
  const PIN_PREFIX = 'zcode.project-pin.v1:';
  window[GLOBAL]?.dispose();
  const records = new Map();
  const menus = new Map();
  const pendingDialogs = new Set();
  let disposed = false;
  let scheduled = false;
  let dialog = null;
  let nameSession = null;
  const nameRequests = [];
  let error = null;
  let scanned = 0;

  const basename = path => path.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || path;
  // 身份不可取显示名；远端还须隔离连接目标，避免相同远端目录串昵称。
  const identity = tab => JSON.stringify([
    tab.workspaceIdentity || tab.remoteSessionId || (tab.remoteTarget ? JSON.stringify(tab.remoteTarget) : 'local'),
    tab.workspacePath,
  ]);
  const storageKey = tab => `${PREFIX}${identity(tab)}`;
  const read = tab => {
    try { return localStorage.getItem(storageKey(tab)) || ''; }
    catch (cause) { error = `无法读取昵称：${cause.message}`; return ''; }
  };
  const write = (tab, value) => {
    const name = value.trim();
    if (name.length > 80) throw new Error('昵称最多 80 个字符');
    if (/[\u0000-\u001f\u007f]/u.test(name)) throw new Error('昵称不能包含换行或控制字符');
    // 每个项目单独保存，避免多个窗口修改不同项目时整份配置互相覆盖。
    if (name) localStorage.setItem(storageKey(tab), name);
    else localStorage.removeItem(storageKey(tab));
    error = null;
    scan();
  };

  const pinned = tab => {
    try { return localStorage.getItem(`${PIN_PREFIX}${identity(tab)}`) === '1'; }
    catch (cause) { error = `无法读取置顶状态：${cause.message}`; return false; }
  };
  const togglePin = tab => {
    const key = `${PIN_PREFIX}${identity(tab)}`;
    if (pinned(tab)) localStorage.removeItem(key);
    else localStorage.setItem(key, '1');
    error = null;
    scan();
  };

  const getTab = element => {
    const key = Object.keys(element).find(key => key.startsWith('__reactFiber$'));
    let fiber = key ? element[key] : null;
    for (let depth = 0; fiber && depth < 128; depth++, fiber = fiber.return) {
      const tab = fiber.memoizedProps?.tab;
      if (tab?.kind === 'workspace' && typeof tab.workspacePath === 'string' && tab.workspacePath) {
        return tab;
      }
    }
    return null;
  };

  const closeDialog = () => {
    if (nameSession) clearTimeout(nameSession.timer);
    nameSession = null;
    nameRequests.length = 0;
    if (!dialog) return;
    const active = dialog;
    dialog = null;
    active.close();
    active.remove();
  };
  const make = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };

  const folderIcon = () => {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: '20', height: '20',
      fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round',
      'stroke-linejoin': 'round', 'aria-hidden': 'true' })) icon.setAttribute(key, value);
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', 'M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l3 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2ZM2 10h20');
    icon.append(shape);
    return icon;
  };
  const openEditor = tab => {
    closeDialog();
    const panel = make('dialog', '', 'zpa-dialog');
    panel.setAttribute('aria-labelledby', 'zpa-title');
    const form = make('form');
    const header = make('div', '', 'zpa-header');
    const title = make('h2', '编辑项目');
    title.id = 'zpa-title';
    const close = make('button', '×', 'zpa-close');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭');
    close.addEventListener('click', closeDialog);
    header.append(title, close);
    const label = make('label', '项目昵称（留空恢复原名）', 'zpa-sr-only');
    const nameField = make('div', '', 'zpa-name-field');
    const nameIcon = make('span', '', 'zpa-name-icon');
    nameIcon.append(folderIcon());
    const input = make('input');
    input.id = 'zpa-name';
    input.name = 'nickname';
    input.maxLength = 80;
    input.value = read(tab) || basename(tab.workspacePath);
    input.placeholder = basename(tab.workspacePath);
    input.autocomplete = 'off';
    label.htmlFor = input.id;
    nameField.append(nameIcon, input);
    // 源文件夹只读展示真实身份，不把“重命名显示名称”扩展成目录管理。
    const source = make('section', '', 'zpa-source');
    source.setAttribute('aria-labelledby', 'zpa-source-title');
    const sourceTitle = make('h3', '源文件夹');
    sourceTitle.id = 'zpa-source-title';
    const folder = make('div', '', 'zpa-folder');
    folder.append(folderIcon());
    const folderInfo = make('div', '', 'zpa-folder-info');
    const folderName = make('div', basename(tab.workspacePath), 'zpa-folder-name');
    const path = make('div', tab.workspacePath, 'zpa-path');
    folderInfo.append(folderName, path);
    folder.append(folderInfo);
    source.append(sourceTitle, folder);
    const suggestions = make('section', '', 'zpa-suggestions');
    const suggestionsTitle = make('h3', '候选名称');
    const suggestionsNote = make('p', '', 'zpa-suggestions-note');
    suggestionsNote.setAttribute('role', 'status');
    const suggestionsList = make('div', '', 'zpa-suggestions-list');
    suggestions.append(suggestionsTitle, suggestionsNote, suggestionsList);
    const message = make('p', '', 'zpa-error');
    message.setAttribute('role', 'alert');
    const actions = make('div', '', 'zpa-actions');
    const reset = make('button', '恢复原名', 'zpa-reset');
    reset.type = 'button';
    const cancel = make('button', '取消', 'zpa-cancel');
    cancel.type = 'button';
    const save = make('button', '保存', 'zpa-primary');
    save.type = 'submit';
    const commit = value => {
      try { write(tab, value.trim() === basename(tab.workspacePath) ? '' : value); closeDialog(); }
      catch (cause) { message.textContent = `保存失败：${cause.message}`; }
    };
    reset.addEventListener('click', () => commit(''));
    cancel.addEventListener('click', closeDialog);
    form.addEventListener('submit', event => { event.preventDefault(); commit(input.value); });
    panel.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
    actions.append(reset, cancel, save);
    form.append(header, label, nameField, suggestions, source, message, actions);
    panel.append(form);
    document.body.append(panel);
    dialog = panel;
    panel.showModal();
    beginNameSuggestions(tab, panel, input, suggestionsNote, suggestionsList);
    input.focus();
    input.select();
  };

  const receiveNameSuggestions = ({ id, result }) => {
    const session = nameSession;
    if (!session || session.id !== id || !session.panel.isConnected || disposed) return;
    clearTimeout(session.timer);
    session.note.textContent = result.message || '点击候选填入前缀，再继续输入后缀；也可以复制';
    session.list.replaceChildren();
    for (const candidate of (Array.isArray(result.candidates) ? result.candidates : []).slice(0, 8)) {
      if (typeof candidate.name !== 'string' || candidate.name.length > 80 || /[\u0000-\u001f\u007f]/u.test(candidate.name)) continue;
      const row = make('div', '', 'zpa-candidate');
      const use = make('button', candidate.name, 'zpa-candidate-use');
      use.type = 'button';
      use.setAttribute('aria-label', `使用候选名称：${candidate.name}`);
      use.title = `${candidate.source || '目录'}：点击填入，尚未保存`;
      const source = make('span', candidate.source || '目录', 'zpa-candidate-source');
      const copy = make('button', '复制', 'zpa-candidate-copy');
      copy.type = 'button';
      copy.setAttribute('aria-label', `复制候选名称：${candidate.name}`);
      use.addEventListener('click', () => {
        session.input.value = candidate.name;
        session.input.focus();
        session.input.setSelectionRange(candidate.name.length, candidate.name.length);
      });
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(candidate.name); copy.textContent = '已复制'; }
        catch { session.note.textContent = '复制失败，可以点击候选名称直接填入'; }
      });
      row.append(use, source, copy); session.list.append(row);
    }
  };
  const beginNameSuggestions = (tab, panel, input, note, list) => {
    const id = crypto.randomUUID();
    nameSession = { id, panel, input, note, list, timer: null };
    if (tab.workspaceIdentity || tab.remoteSessionId || tab.remoteTarget) {
      note.textContent = '远程项目暂不读取本机仓库信息，仍可手动编辑名称';
      return;
    }
    if (!window.__zcodeProjectAliasNamesAvailable) {
      note.textContent = '仓库候选需要伴随加载器；请从“ZCode 项目昵称”启动器打开，当前仍可手动编辑';
      return;
    }
    note.textContent = '正在只读识别本地 SVN / Git 项目名称…';
    nameRequests.push({ id, workspacePath: tab.workspacePath, remote: false });
    nameSession.timer = setTimeout(() => {
      if (nameSession?.id === id) note.textContent = '识别暂未完成，仍可手动编辑；不会覆盖已输入的内容';
    }, 12000);
  };

  const projectGroups = () => {
    const groups = new Map();
    for (const [row] of records) {
      const item = row.closest('li');
      const list = item?.parentElement;
      const tab = getTab(row);
      if (!tab || !list || list.tagName !== 'UL') continue;
      if (!groups.has(list)) groups.set(list, new Map());
      groups.get(list).set(identity(tab), { item, tab });
    }
    const result = [];
    for (const [list, entries] of groups) {
      // 从宿主当前提交的 children 读取原顺序，不修改 React store。
      // 项目仅在同一个 ul 内移动，保持原节点、任务子树与事件处理器。
      const propsKey = Object.keys(list).find(key => key.startsWith('__reactProps$'));
      const keys = [];
      const visit = children => {
        for (const child of Array.isArray(children) ? children : [children]) {
          if (child?.props?.tab?.kind === 'workspace') keys.push(identity(child.props.tab));
          else if (child?.props?.children) visit(child.props.children);
        }
      };
      visit(list[propsKey]?.children);
      if (keys.length !== entries.size || keys.length !== list.children.length ||
        new Set(keys).size !== keys.length || !keys.every(key => entries.has(key))) continue;
      result.push({ list, ordered: keys.map(key => entries.get(key)) });
    }
    return result;
  };
  const sortProjects = (restoreOriginal = false) => {
    for (const { list, ordered } of projectGroups()) {
      const target = restoreOriginal ? ordered : [...ordered].sort((a, b) => Number(pinned(b.tab)) - Number(pinned(a.tab)));
      target.forEach(({ item }, index) => {
        if (list.children[index] !== item) list.insertBefore(item, list.children[index] || null);
      });
    }
  };

  const restore = record => {
    if (record.node.isConnected && record.node.nodeValue === record.applied) record.node.nodeValue = record.original;
    if (record.row.getAttribute('title') === record.title) {
      if (record.originalTitle === null) record.row.removeAttribute('title');
      else record.row.setAttribute('title', record.originalTitle);
    }
  };
  const scan = () => {
    if (disposed) return;
    scanned++;
    for (const [row, record] of records) {
      if (!row.isConnected || !record.node.isConnected || identity(getTab(row) || { workspacePath: '' }) !== record.key) {
        restore(record);
        records.delete(row);
      }
    }
    for (const row of document.querySelectorAll('[role="button"][data-testid^="workspace-item-"]')) {
      const tab = getTab(row);
      if (!tab || row.getAttribute('data-testid') !== `workspace-item-${tab.workspacePath}`) continue;
      let record = records.get(row);
      if (!record) {
        // 当前 3.15.3 的项目行使用 div.truncate 呈现标签。仅接受直接文本，
        // 不删除 React 子节点，也不扫描聊天内容或用同名文字猜项目归属。
        const leaf = [...row.querySelectorAll('div.truncate')].find(node =>
          node.childNodes.length === 1 && node.firstChild.nodeType === Node.TEXT_NODE &&
          (node.textContent === tab.label || node.textContent === basename(tab.workspacePath) ||
            node.textContent.startsWith(`${tab.label} [SSH: `)));
        if (!leaf) continue;
        record = { row, node: leaf.firstChild, original: leaf.textContent, applied: leaf.textContent,
          originalTitle: row.getAttribute('title'), title: '', key: identity(tab) };
        records.set(row, record);
      }
      // 宿主重新渲染改回了原文时，记录新的原文再覆盖，卸载能恢复正确名称。
      if (record.node.nodeValue !== record.applied) record.original = record.node.nodeValue;
      const nickname = read(tab);
      const suffix = tab.remoteTarget?.kind === 'ssh' && tab.remoteTarget.sshConfigAlias?.trim()
        ? ` [SSH: ${tab.remoteTarget.sshConfigAlias.trim()}]` : '';
      const next = nickname ? `${nickname}${suffix}` : record.original;
      if (record.node.nodeValue !== next) record.node.nodeValue = next;
      record.applied = next;
      record.title = `${nickname || record.original}\n${tab.workspacePath}`;
      if (row.title !== record.title) row.title = record.title;
    }
    sortProjects();
    scanMenus();
  };
  const scanMenus = () => {
    for (const [remove, record] of menus) {
      const tab = getTab(remove);
      if (!remove.isConnected || !tab || record.key !== identity(tab)) {
        record.dispose(); menus.delete(remove);
      } else record.update(tab);
    }
    for (const remove of document.querySelectorAll('[role="menuitem"][data-testid^="workspace-close-"]')) {
      if (menus.has(remove)) continue;
      const tab = getTab(remove);
      const menu = remove.closest('[role="menu"]');
      if (!menu || !tab || remove.dataset.testid !== `workspace-close-${tab.workspacePath}`) continue;
      const makeItem = (text, shape) => {
        const item = make('div', '', `${remove.className} zpa-menu-item`);
        item.setAttribute('role', 'menuitem'); item.tabIndex = -1;
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: '16', height: '16',
          fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) icon.setAttribute(key, value);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', shape); icon.append(path);
        const label = document.createTextNode(text);
        item.append(icon, label);
        return { item, label };
      };
      const pin = makeItem(pinned(tab) ? '取消置顶' : '置顶', 'M16 3l5 5-4 1-4 4-1 4-5-5 4-1 4-4zM7 17l-4 4');
      const edit = makeItem('编辑', 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8');
      edit.item.dataset.zpaEdit = 'true';
      pin.item.dataset.zpaPin = 'true';
      const message = make('div', '', 'zpa-menu-error');
      message.setAttribute('role', 'alert');
      const update = current => {
        pin.label.nodeValue = pinned(current) ? '取消置顶' : '置顶';
        const supported = projectGroups().some(group => group.ordered.some(entry => identity(entry.tab) === identity(current)));
        pin.item.setAttribute('aria-disabled', String(!supported));
        pin.item.title = supported ? '' : '当前项目列表结构暂不支持置顶';
      };
      update(tab);
      remove.before(pin.item, edit.item, message);
      const dismiss = () => menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      const activate = (event, action) => {
        event.preventDefault(); event.stopPropagation();
        const current = getTab(remove);
        if (!current || identity(current) !== identity(tab) || remove.dataset.testid !== `workspace-close-${current.workspacePath}`) return;
        if (action === 'pin') {
          if (pin.item.getAttribute('aria-disabled') === 'true') return;
          try { togglePin(current); dismiss(); }
          catch (cause) { error = `保存置顶失败：${cause.message}`; message.textContent = error; }
        } else {
          dismiss();
          const timer = setTimeout(() => { pendingDialogs.delete(timer); if (!disposed) openEditor(current); }, 0);
          pendingDialogs.add(timer);
        }
      };
      pin.item.addEventListener('click', event => activate(event, 'pin'));
      edit.item.addEventListener('click', event => activate(event, 'edit'));
      const onKey = event => {
        if (event.target.closest('[role="menu"]') !== menu) return;
        if (['Enter', ' '].includes(event.key) && [pin.item, edit.item].includes(event.target)) {
          activate(event, event.target === pin.item ? 'pin' : 'edit'); return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const items = [...menu.querySelectorAll('[role="menuitem"]')].filter(node =>
          node.closest('[role="menu"]') === menu && !node.hasAttribute('data-disabled') && node.getAttribute('aria-disabled') !== 'true');
        const index = items.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
          (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
        event.preventDefault(); event.stopPropagation(); items[next]?.focus();
      };
      for (const { item } of [pin, edit]) item.addEventListener('pointermove', () => item.focus());
      menu.addEventListener('keydown', onKey, true);
      menus.set(remove, { key: identity(tab), update, dispose: () => {
        pin.item.remove(); edit.item.remove(); message.remove(); menu.removeEventListener('keydown', onKey, true);
      } });
    }
  };
  const schedule = () => {
    if (scheduled || disposed) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; scan(); });
  };
  const style = make('style');
  style.id = 'zpa-style';
  style.textContent = `
    .zpa-menu-item {display:flex;align-items:center;gap:8px;cursor:default;outline:none;}
    .zpa-menu-error {color:#f87171;font-size:12px;max-width:240px;overflow-wrap:anywhere;}
    .zpa-menu-error:empty {display:none;}
    .zpa-menu-item[aria-disabled="true"] {opacity:.5;}
    .zpa-menu-item:focus,.zpa-menu-item:hover {background:var(--color-surface-hover,#8882);}
    /* 宿主的全局重置（* 清零边距）会覆盖 dialog 默认的 margin:auto，只靠默认样式会贴左上角；显式声明居中。 */
    .zpa-dialog {position:fixed;inset:0;margin:auto;--zpa-bg:#292929;--zpa-fg:#ededed;--zpa-border:#ffffff14;--zpa-muted:#999;--zpa-save-bg:#fff;--zpa-save-fg:#242424;box-sizing:border-box;width:min(520px,calc(100vw - 32px));max-height:calc(100dvh - 48px);overflow:auto;padding:20px;border:1px solid var(--color-border,var(--zpa-border));border-radius:22px;color:var(--color-foreground,var(--zpa-fg));background:var(--color-card,var(--zpa-bg));font:14px/1.5 var(--font-sans,system-ui,sans-serif);box-shadow:0 20px 70px #0004;}
    .zpa-dialog *, .zpa-dialog *::before, .zpa-dialog *::after {box-sizing:border-box;}
    .zpa-dialog::backdrop {background:#0004;}
    .zpa-header {display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px;}
    .zpa-dialog h2 {font-size:20px;line-height:1.3;font-weight:600;margin:0;}
    .zpa-dialog button {font:inherit;cursor:pointer;border:0;}
    .zpa-dialog .zpa-close {flex:none;display:grid;place-items:center;width:28px;height:28px;padding:0;color:var(--color-foreground-subtle,var(--zpa-muted));background:transparent;font-size:24px;line-height:1;}
    .zpa-close:hover {color:inherit;}
    .zpa-name-field {display:flex;align-items:stretch;min-width:0;height:40px;border:1px solid var(--color-border,var(--zpa-border));border-radius:12px;}
    .zpa-name-field:focus-within {border-color:#448aff;box-shadow:0 0 0 1px #448aff;}
    .zpa-name-icon {flex:none;display:grid;place-items:center;width:40px;border-right:1px solid var(--color-border,var(--zpa-border));}
    .zpa-dialog input {flex:1;min-width:0;width:100%;padding:0 10px;border:0;outline:0;border-radius:0 12px 12px 0;font:inherit;color:inherit;background:transparent;}
    .zpa-source {width:100%;margin:14px 0 0;}
    .zpa-suggestions {width:100%;margin:14px 0 0;}
    .zpa-suggestions h3 {font-size:14px;font-weight:500;margin:0 0 6px;}
    .zpa-suggestions-note {font-size:11px;color:var(--color-foreground-subtle,var(--zpa-muted));margin:0 0 8px;}
    .zpa-suggestions-list {display:flex;flex-direction:column;gap:5px;}
    .zpa-candidate {display:flex;align-items:center;gap:8px;min-width:0;border:1px solid var(--color-border,var(--zpa-border));border-radius:8px;padding:5px 8px;}
    .zpa-candidate-use {min-width:0;text-align:left;overflow-wrap:anywhere;background:transparent;color:inherit;padding:0;}
    .zpa-candidate-use:hover {text-decoration:underline;}
    .zpa-candidate-source {margin-left:auto;flex-shrink:0;font-size:10px;color:var(--color-foreground-subtle,var(--zpa-muted));}
    .zpa-candidate-copy {flex:none;font-size:11px;background:transparent;color:var(--color-foreground-subtle,var(--zpa-muted));padding:2px;}

    .zpa-source h3 {font-size:14px;font-weight:500;margin:0 0 8px;}
    .zpa-folder {display:flex;align-items:center;gap:10px;padding:12px;border:1px solid var(--color-border,var(--zpa-border));border-radius:10px;}
    .zpa-folder > svg {flex:none;color:var(--color-foreground-subtle,var(--zpa-muted));}
    .zpa-folder-info {min-width:0;}
    .zpa-folder-name {overflow-wrap:anywhere;}
    .zpa-path {font-size:11px;color:var(--color-foreground-subtle,var(--zpa-muted));overflow-wrap:anywhere;user-select:text;}
    .zpa-actions {display:flex;align-items:center;justify-content:flex-end;gap:14px;margin-top:20px;}
    .zpa-actions button {padding:6px 12px;border-radius:9px;background:transparent;color:var(--color-foreground-subtle,var(--zpa-muted));}
    .zpa-actions button:hover {background:var(--color-surface-hover,#8882);}
    .zpa-actions .zpa-reset {margin-right:auto;padding-left:0;font-size:12px;}
    .zpa-actions .zpa-primary {min-width:62px;background:var(--zpa-save-bg);color:var(--zpa-save-fg);font-weight:600;}
    .zpa-actions .zpa-primary:hover {opacity:.9;}
    .zpa-error {color:#f87171;font-size:12px;margin:10px 0 0;}
    .zpa-error:empty {display:none;}
    .zpa-sr-only {position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;}
    @media(prefers-color-scheme:light){.zpa-dialog {--zpa-bg:#fff;--zpa-fg:#242424;--zpa-border:#0002;--zpa-muted:#777;--zpa-save-bg:#252525;--zpa-save-fg:#fff;}}
    :is(.dark,.zai-dark) .zpa-dialog {--zpa-bg:#292929;--zpa-fg:#ededed;--zpa-border:#ffffff14;--zpa-muted:#999;--zpa-save-bg:#fff;--zpa-save-fg:#242424;}
    :is(.light,.zai-light) .zpa-dialog {--zpa-bg:#fff;--zpa-fg:#242424;--zpa-border:#0002;--zpa-muted:#777;--zpa-save-bg:#252525;--zpa-save-fg:#fff;}
  `;
  document.head.append(style);
  const observer = new MutationObserver(mutations => {
    // 长任务可能持续输出大量聊天 DOM；仅观察项目行及包含项目行的新增子树。
    const selector = '[role="button"][data-testid^="workspace-item-"], [role="menuitem"][data-testid^="workspace-close-"]';
    if (mutations.some(mutation => {
      const element = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
      if (element?.closest(selector)) return true;
      return mutation.type === 'childList' && [...mutation.addedNodes].some(node =>
        node.nodeType === Node.ELEMENT_NODE && (node.matches(selector) || node.querySelector(selector)));
    })) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  const onStorage = event => { if (event.key === null || (event.key?.startsWith(PREFIX) || event.key?.startsWith(PIN_PREFIX))) schedule(); };
  window.addEventListener('storage', onStorage);
  // 慢速兜底处理 React 更新 props 却没有改动 DOM 的情况；没有网络或磁盘轮询。
  const timer = setInterval(schedule, 3000);
  window[GLOBAL] = {
    version: VERSION,
    takeNameRequests: () => ({
      requests: nameRequests.splice(0, 2),
      workspaces: [...records.keys()].map(getTab).filter(Boolean).map(tab => ({
        workspacePath: tab.workspacePath, remote: !!(tab.workspaceIdentity || tab.remoteSessionId || tab.remoteTarget),
      })),
    }),
    receiveNameSuggestions,
    status: () => ({ version: VERSION, projects: records.size, scans: scanned, error }),
    dispose: () => {
      disposed = true;
      observer.disconnect(); clearInterval(timer);
      window.removeEventListener('storage', onStorage);
      closeDialog();
      for (const timer of pendingDialogs) clearTimeout(timer);
      for (const record of menus.values()) record.dispose();
      menus.clear();
      sortProjects(true);
      for (const record of records.values()) restore(record);
      records.clear(); style.remove();
      delete window[GLOBAL];
    },
  };
  scan();
})();
