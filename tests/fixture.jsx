import React from 'react';
import { createRoot } from 'react-dom/client';
import * as Menu from '@radix-ui/react-dropdown-menu';

// 使用真实 React 与 Radix portal 菜单验证，项目路径标识对应本机 3.15.3。
const initial = [
  { kind: 'workspace', workspacePath: '/a/serverless', label: 'serverless' },
  { kind: 'workspace', workspacePath: '/b/serverless', label: 'serverless' },
  { kind: 'workspace', workspacePath: '/srv/serverless', workspaceIdentity: 'ssh:A', label: 'serverless' },
  { kind: 'workspace', workspacePath: '/srv/serverless', workspaceIdentity: 'ssh:B', label: 'serverless' },
];
const Workspace = ({ tab, tick }) => <section>
  <div role="button" data-testid={`workspace-item-${tab.workspacePath}`} onClick={() => window.hostClicks++}>
    <svg width="18" height="18"/><div className="min-w-0 truncate text-ui-base">{tab.label}</div>
    <Menu.Root>
      <Menu.Trigger asChild><button aria-label="更多" onClick={event => event.stopPropagation()}>•••</button></Menu.Trigger>
      <Menu.Portal><Menu.Content className="fixture-menu" onClick={event => event.stopPropagation()}>
        <Menu.Item data-testid={`workspace-close-${tab.workspacePath}`} className="fixture-item"
          onSelect={() => window.removals.push(tab.workspaceIdentity || tab.workspacePath)}>× 移除</Menu.Item>
      </Menu.Content></Menu.Portal>
    </Menu.Root>
  </div>
  <div role="button" data-testid="task-item"><div className="truncate">serverless</div></div>
  <small>{tick}</small>
</section>;
const root = createRoot(document.getElementById('root'));
window.hostClicks = 0;
window.removals = [];
window.renderFixture = (tabs = initial, tick = 0) => root.render(<>{tabs.map(tab =>
  <Workspace key={tab.workspaceIdentity || tab.workspacePath} tab={tab} tick={tick}/>)}</>);
window.fixtureTabs = initial;
window.renderFixture();
