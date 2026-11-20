import { readFileSync, writeFileSync } from 'node:fs';
const file = name => new URL(name, import.meta.url);
const read = name => readFileSync(file('src/' + name), 'utf8');
const image = readFileSync(file('src/organ.jpg')).toString('base64');
const resources = 'const organTexture = "data:image/jpeg;base64,' + image + '";\n' +
  'const panelStyle = ' + JSON.stringify(read('panel.css')+'\n'+read('scene.css')) + ';\n' +
  'const panelMarkup = ' + JSON.stringify(read('panel.html')) + ';';
const shared = [resources, ...['scene.js','ui.js'].map(read)].join('\n');
const adapter = 'window.__ModuleLoader__.load({id:"dsh-dimensional-archive", factory(require) {\n' +
  shared + '\n' + read('adapter.js') + '\n}});';
writeFileSync(file('client.js'), adapter);
const standalone = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>次元生殖腔体 · 状态档案</title><style>html,body,#app{display:block;margin:0;height:100%;background:#100f16}</style><div id="app"></div><script>\n' +
  shared + '\nmountPanel(document.querySelector("#app"), {connection:"独立预览 · 未连接 DSH"});\n</script></html>';
writeFileSync(file('preview.html'), standalone);
