// Builds dist/kopolo.html: the whole game in one file that runs straight from disk, with no server.
// Browsers refuse to load ES modules on file:// pages, so each module is inlined as a function scope.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

// The only module syntax the sources use: named or namespace imports of sibling files, and exported declarations.
const IMPORT = /^import\s+(?:\{([^}]*)\}|\* as (\w+))\s+from '\.\/([\w-]+)\.js';$/gm;
const EXPORT = /^export (?=(?:const|function|class) (\w+))/gm;

const state = new Map(); // module name -> 'pending' | 'done'
let bundle = '';

// Appends a module after everything it imports.
async function add(name) {
  if (state.get(name) === 'pending') throw new Error(`circular import through ${name}.js`);
  if (state.has(name)) return;
  state.set(name, 'pending');
  const src = await read(`src/${name}.js`);
  for (const dep of [...src.matchAll(IMPORT)].map((m) => m[3])) await add(dep);
  const names = [];
  const body = src
    .replace(IMPORT, (_, list, ns, dep) => `const ${ns || `{${list}}`} = __modules['${dep}'];`)
    .replace(EXPORT, (_, id) => { names.push(id); return ''; });
  if (/^\s*(import|export)\b/m.test(body)) throw new Error(`${name}.js uses an import or export form this build does not handle`);
  bundle += `__modules['${name}'] = (() => {\n${body}\nreturn { ${names.join(', ')} };\n})();\n`;
  state.set(name, 'done');
}

await add('main');
const js = `(() => {\n'use strict';\nconst __modules = {};\n${bundle}})();`;
new vm.Script(js); // a syntax error must fail the build, not the player's browser

const css = await read('styles.css');
// The HTML parser would end the inlined code early at these sequences.
if (/<\/script|<!--/i.test(js) || /<\/style/i.test(css)) throw new Error('the sources contain </script, </style or <!--, which cannot be inlined');

const icon = encodeURIComponent((await read('favicon.svg')).trim());
let html = await read('index.html');
for (const [tag, inline] of [
  ['<link rel="stylesheet" href="styles.css">', `<style>\n${css}</style>`],
  ['href="favicon.svg"', `href="data:image/svg+xml,${icon}"`],
  ['<script type="module" src="src/main.js"></script>', `<script>\n${js}\n</script>`],
]) {
  if (!html.includes(tag)) throw new Error(`index.html no longer contains ${tag}`);
  html = html.replace(tag, () => inline);
}

await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/kopolo.html', root), html);
console.log(`dist/kopolo.html: ${Math.round(Buffer.byteLength(html) / 1024)} KB, ${state.size} modules`);
