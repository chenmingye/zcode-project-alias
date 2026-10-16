/** 生成可独立分发的 stdio 服务和单文件 MCP Apps 页面。作者：Jason.chen。 */
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const plugin = path.join(root, 'plugins/zcode-project-alias');
await fs.mkdir(path.join(plugin, 'dist'), { recursive: true });
const server = await build({ entryPoints: [path.join(plugin, 'src/server.mjs')], outfile: path.join(plugin, 'dist/server.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node20', metafile: true,
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' } });
const page = await build({ entryPoints: [path.join(plugin, 'src/panel.mjs')], bundle: true, platform: 'browser', format: 'esm', target: 'chrome108', minify: true, write: false, metafile: true });
const css = await fs.readFile(path.join(plugin, 'src/panel.css'), 'utf8');
const html = (await fs.readFile(path.join(plugin, 'src/panel.html'), 'utf8'))
  .replace('/* PANEL_STYLE */', () => css)
  .replace('/* PANEL_SCRIPT */', () => page.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'));
await fs.writeFile(path.join(plugin, 'dist/panel.html'), html);
const packages = new Set();
for (const input of [...Object.keys(server.metafile.inputs), ...Object.keys(page.metafile.inputs)]) {
  if (!input.includes('node_modules/')) continue;
  const parts = input.split('node_modules/').at(-1).split('/');
  packages.add(parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
}
const notices = [];
for (const name of [...packages].sort()) {
  const folder = path.join(root, 'node_modules', name);
  const metadata = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8'));
  const licenseFiles = (await fs.readdir(folder)).filter(name => /^(?:licen[cs]e|copying|notice)(?:\.|$)/i.test(name));
  notices.push(`${name}@${metadata.version} (${metadata.license || 'see package license'})`);
  for (const file of licenseFiles) {
    if ((await fs.stat(path.join(folder, file))).isFile()) notices.push(await fs.readFile(path.join(folder, file), 'utf8'));
  }
}
await fs.writeFile(path.join(plugin, 'dist/THIRD_PARTY_NOTICES.txt'), notices.join('\n\n-----\n\n').replace(/[\t ]+$/gm, '') + '\n');
console.log(JSON.stringify({ serverBytes: (await fs.stat(path.join(plugin, 'dist/server.mjs'))).size, panelBytes: Buffer.byteLength(html) }));
