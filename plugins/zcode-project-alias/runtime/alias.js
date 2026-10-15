/**
 * ZCode 项目昵称界面。作者：Jason.chen
 * 由本插件自己的 loader.cjs 独立加载；安装器不读取其他插件。
 * 只读 React 节点以取得项目身份，只修改名称文本和本扩展创建的界面，
 * 不写宿主 store、不调用会话接口。React 私有结构不兼容时跳过该项目。
 */
(() => {
  'use strict';
  const GLOBAL = '__zcodeProjectAlias';
  const VERSION = '0.2.0';
  const PREFIX = 'zcode.project-alias.v1:';
  window[GLOBAL]?.dispose();
  const records = new Map();
  const menus = new Map();
  const pendingDialogs = new Set();
  let disposed = false;
  let scheduled = false;
  let dialog = null;
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

  const openEditor = tab => {
    closeDialog();
    const panel = make('dialog', '', 'zpa-dialog');
    panel.setAttribute('aria-labelledby', 'zpa-title');
    const form = make('form');
    const title = make('h2', '设置项目昵称');
    title.id = 'zpa-title';
    const path = make('p', tab.workspacePath, 'zpa-path');
    const label = make('label', '项目昵称（留空恢复原名）');
    const input = make('input');
    input.id = 'zpa-name';
    input.name = 'nickname';
    input.maxLength = 80;
    input.value = read(tab);
    input.placeholder = basename(tab.workspacePath);
    input.autocomplete = 'off';
    label.htmlFor = input.id;
    const message = make('p', '', 'zpa-error');
    message.setAttribute('role', 'alert');
    const actions = make('div', '', 'zpa-actions');
    const reset = make('button', '恢复原名');
    reset.type = 'button';
    const cancel = make('button', '取消');
    cancel.type = 'button';
    const save = make('button', '保存');
    save.type = 'submit';
    save.className = 'zpa-primary';
    const commit = value => {
      try { write(tab, value); closeDialog(); }
      catch (cause) { message.textContent = `保存失败：${cause.message}`; }
    };
    reset.addEventListener('click', () => commit(''));
    cancel.addEventListener('click', closeDialog);
    form.addEventListener('submit', event => { event.preventDefault(); commit(input.value); });
    panel.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
    actions.append(reset, cancel, save);
    form.append(title, path, label, input, message, actions);
    panel.append(form);
    document.body.append(panel);
    dialog = panel;
    panel.showModal();
    input.focus();
    input.select();
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
    scanMenus();
  };
  const scanMenus = () => {
    for (const [remove, record] of menus) {
      const tab = getTab(remove);
      if (!remove.isConnected || !tab || record.key !== identity(tab)) {
        record.dispose(); menus.delete(remove);
      }
    }
    // 项目的“移除”项携带路径标识；普通任务菜单、聊天菜单一律不接入。
    for (const remove of document.querySelectorAll('[role="menuitem"][data-testid^="workspace-close-"]')) {
      if (menus.has(remove)) continue;
      const tab = getTab(remove);
      const menu = remove.closest('[role="menu"]');
      if (!menu || !tab || remove.dataset.testid !== `workspace-close-${tab.workspacePath}`) continue;
      const item = make('div', '', `${remove.className} zpa-rename`);
      item.setAttribute('role', 'menuitem');
      item.setAttribute('tabindex', '-1');
      item.dataset.zpaRename = 'true';
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('width', '14'); icon.setAttribute('height', '14');
      icon.setAttribute('fill', 'none'); icon.setAttribute('stroke', 'currentColor');
      icon.setAttribute('stroke-width', '1.7'); icon.setAttribute('aria-hidden', 'true');
      const pencil = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pencil.setAttribute('d', 'M15 5l4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z');
      icon.append(pencil); item.append(icon, document.createTextNode('重命名'));
      remove.before(item);
      const open = event => {
        event.preventDefault(); event.stopPropagation();
        const current = getTab(remove);
        if (!current || identity(current) !== identity(tab)) return;
        // 先通过宿主自己的 Escape 生命周期关闭菜单，再打开非阻塞式对话框。
        menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        const timer = setTimeout(() => { pendingDialogs.delete(timer); if (!disposed) openEditor(current); }, 0);
        pendingDialogs.add(timer);
      };
      const onKey = event => {
        if (event.target.closest('[role="menu"]') !== menu) return;
        if (event.target === item && ['Enter', ' '].includes(event.key)) { open(event); return; }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const items = [...menu.querySelectorAll('[role="menuitem"]')].filter(node =>
          node.closest('[role="menu"]') === menu && !node.hasAttribute('data-disabled') && node.getAttribute('aria-disabled') !== 'true');
        const index = items.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
          (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
        event.preventDefault(); event.stopPropagation(); items[next]?.focus();
      };
      item.addEventListener('click', open);
      item.addEventListener('pointermove', () => item.focus());
      menu.addEventListener('keydown', onKey, true);
      menus.set(remove, { key: identity(tab), dispose: () => {
        item.remove(); menu.removeEventListener('keydown', onKey, true);
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
    .zpa-rename {display:flex;align-items:center;gap:8px;cursor:default;outline:none;}
    .zpa-rename:focus,.zpa-rename:hover {background:var(--color-surface-hover,#8882);}
    .zpa-dialog {box-sizing:border-box;width:min(460px,calc(100vw - 32px));padding:24px;border:1px solid var(--color-border,#8886);border-radius:14px;color:var(--color-foreground,#eee);background:var(--color-card,#242424);font-family:inherit;box-shadow:0 16px 48px #0005;}
    .zpa-dialog::backdrop {background:#0005;}
    .zpa-dialog h2 {font-size:18px;margin:0 0 12px;}
    .zpa-path {font-size:12px;opacity:.7;overflow-wrap:anywhere;user-select:text;}
    .zpa-dialog label {display:block;margin:20px 0 8px;font-size:13px;}
    .zpa-dialog input {box-sizing:border-box;width:100%;padding:9px 10px;border:1px solid #8888;border-radius:6px;font:inherit;color:inherit;background:transparent;}
    .zpa-actions {display:flex;justify-content:flex-end;gap:8px;margin-top:16px;}
    .zpa-actions button {padding:6px 12px;border:1px solid #8886;border-radius:6px;cursor:pointer;font:inherit;background:transparent;color:inherit;}
    .zpa-actions .zpa-primary {background:#2563eb;color:white;border-color:#2563eb;}
    .zpa-error {color:#f87171;font-size:12px;}
    @media(prefers-color-scheme:light){.zpa-dialog {color:var(--color-foreground,#222);background:var(--color-card,#fff);}}
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
  const onStorage = event => { if (event.key === null || event.key?.startsWith(PREFIX)) schedule(); };
  window.addEventListener('storage', onStorage);
  // 慢速兜底处理 React 更新 props 却没有改动 DOM 的情况；没有网络或磁盘轮询。
  const timer = setInterval(schedule, 3000);
  window[GLOBAL] = {
    version: VERSION,
    status: () => ({ version: VERSION, projects: records.size, scans: scanned, error }),
    dispose: () => {
      disposed = true;
      observer.disconnect(); clearInterval(timer);
      window.removeEventListener('storage', onStorage);
      closeDialog();
      for (const timer of pendingDialogs) clearTimeout(timer);
      for (const record of menus.values()) record.dispose();
      menus.clear();
      for (const record of records.values()) restore(record);
      records.clear(); style.remove();
      delete window[GLOBAL];
    },
  };
  scan();
})();
