/** README 截图宿主。作者：Jason.chen
 * 按用户提供的 ZCode 项目侧栏参考图还原悬停布局，数据均为演示数据。
 * 仅供截图使用，不将这个宿主样式注入真实 ZCode。
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import * as Menu from '@radix-ui/react-dropdown-menu';

const Icon = ({ shape }) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={shape}/></svg>;
const folder = 'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7h18';
const tabs = [
  { kind: 'workspace', workspacePath: '/a/serverless', label: 'serverless', task: '配置开发环境', age: '16小时' },
  { kind: 'workspace', workspacePath: '/b/serverless', label: 'serverless', task: '完善列表页面', age: '20小时' },
  { kind: 'workspace', workspacePath: '/c/serverless', label: 'serverless', task: '检查接口联调', age: '1天' },
  { kind: 'workspace', workspacePath: '/d/serverless', label: 'serverless', task: '整理项目说明', age: '2天' },
];
const Workspace = ({ tab }) => <li data-project-entry={tab.workspacePath}>
  <div role="button" data-testid={`workspace-item-${tab.workspacePath}`}>
    <Icon shape={folder}/><div className="min-w-0 truncate text-ui-base">{tab.label}</div>
    <div className="workspace-actions">
      <Menu.Root><Menu.Trigger asChild><button aria-label="更多">···</button></Menu.Trigger>
        <Menu.Portal><Menu.Content className="fixture-menu" align="end" sideOffset={4}>
          <Menu.Item data-testid={`workspace-close-${tab.workspacePath}`} className="fixture-item"><Icon shape="M6 6l12 12M18 6L6 18"/>移除</Menu.Item>
        </Menu.Content></Menu.Portal>
      </Menu.Root>
      <button aria-label="宿主原有操作一"><Icon shape="M8 5h13M8 12h13M8 19h13M3 5v14h2"/></button>
      <button aria-label="宿主原有操作二"><Icon shape="M21 11a9 9 0 0 1-9 9H3l2-5a9 9 0 1 1 16-4zM12 7v8M8 11h8"/></button>
    </div>
  </div>
  <div role="button" data-testid="task-item"><span>{tab.task}</span><time>{tab.age}</time></div>
</li>;
createRoot(document.getElementById('root')).render(<aside>
  <div className="sidebar-tabs"><span># 分组</span><strong><Icon shape={folder}/>项目</strong></div>
  <div className="sidebar-heading">项目⌄</div>
  <ul data-testid="workspace-list">{tabs.map(tab => <Workspace key={tab.workspacePath} tab={tab}/>)}</ul>
</aside>);
