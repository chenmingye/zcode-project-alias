import React from 'react';
import { createRoot } from 'react-dom/client';

// 用真实 React fiber 与重绘验证适配器。结构来自本机 3.15.3 项目行；
// 特意包含同名任务、普通按钮，验证不会按显示文字错改聊天/任务。
const initial = [
  { kind: 'workspace', workspacePath: '/a/serverless', label: 'serverless' },
  { kind: 'workspace', workspacePath: '/b/serverless', label: 'serverless' },
  { kind: 'workspace', workspacePath: '/srv/serverless', workspaceIdentity: 'ssh:A', label: 'serverless' },
  { kind: 'workspace', workspacePath: '/srv/serverless', workspaceIdentity: 'ssh:B', label: 'serverless' },
];
const Workspace = ({ tab, tick }) => <section>
  <div role="button" data-testid={`workspace-item-${tab.workspacePath}`} onClick={() => window.hostClicks++}>
    <svg/><div className="min-w-0 truncate text-ui-base">{tab.label}</div>
    <div><button>更多</button></div>
  </div>
  <div role="button" data-testid="task-item"><div className="truncate">serverless</div></div>
  <small>{tick}</small>
</section>;
const root = createRoot(document.getElementById('root'));
window.hostClicks = 0;
window.renderFixture = (tabs = initial, tick = 0) => root.render(<>{tabs.map(tab =>
  <Workspace key={tab.workspaceIdentity || tab.workspacePath} tab={tab} tick={tick}/>)}</>);
window.fixtureTabs = initial;
window.renderFixture();
