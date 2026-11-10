/**
 * 构建脚本：把 src/ 下的源码包装成 DSH 客户端插件的模块格式。
 *
 * DSH 的浏览器半边不是普通 ES module —— 它必须调用
 *   window.__ModuleLoader__.load({ id, factory: (require) => module.exports })
 * 并把依赖经 factory 收到的 `require` 解析（react、ui-primitives 等都由
 * 运行时提供，不打进包里）。
 *
 * 本脚本做两件事：
 *   1. 把 src/client/*.js 的 ESM 语法降级为 factory 内部可用的形式：
 *      - import 语句改写为 require(...) 的局部变量绑定
 *      - export 语句改写为 exports.<name> = <name>
 *   2. 拼出完整的 lib/client.js。
 *
 * 之所以自己写而不是引入 bundler：本插件的源码是扁平的少量文件，无第三方
 * 依赖，改写规则可枚举且可验证，避免为 300 行代码背一套构建工具链。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const PLUGIN_ID = 'dsh-model-groups'

/**
 * 把单个源文件的 ESM 语法转成 factory 内部形式。
 * @param {string} source - 源文件内容。
 * @param {string} file - 文件名，用于报错。
 * @returns {{ code: string, requires: Map<string, string> }} 转换后的代码与依赖映射。
 */
function transform(source, file) {
  /** @type {Map<string, string>} 裸模块说明符 -> 局部变量名 */
  const requires = new Map()
  let code = source

  // import { a, b as c } from 'spec'
  code = code.replace(
    /^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?\s*$/gm,
    (_match, bindings, spec) => {
      const local = localNameFor(spec, requires)
      const parts = bindings
        .split(',')
        .map((piece) => piece.trim())
        .filter((piece) => piece !== '')
        .map((piece) => {
          const asMatch = /^(\S+)\s+as\s+(\S+)$/.exec(piece)
          return asMatch === null ? piece : `${asMatch[1]}: ${asMatch[2]}`
        })
      if (parts.length === 0) return `const ${local} = require(${JSON.stringify(spec)});`
      return `const { ${parts.join(', ')} } = require(${JSON.stringify(spec)});`
    },
  )

  // import Default from 'spec'
  code = code.replace(
    /^import\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"];?\s*$/gm,
    (_match, name, spec) => `const ${name} = require(${JSON.stringify(spec)});`,
  )

  // import 'spec'
  code = code.replace(
    /^import\s*['"]([^'"]+)['"];?\s*$/gm,
    (_match, spec) => `require(${JSON.stringify(spec)});`,
  )

  // export const/let/function/class NAME
  code = code.replace(
    /^export\s+(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm,
    (_match, kind, name) => `${kind} ${name}`,
  )

  // 收集需要挂到 exports 上的顶层名字
  const exported = new Set()
  const exportList = /^export\s*\{([^}]*)\};?\s*$/gm
  let listMatch
  while ((listMatch = exportList.exec(source)) !== null) {
    for (const piece of listMatch[1].split(',')) {
      const trimmed = piece.trim()
      if (trimmed === '') continue
      const asMatch = /^(\S+)\s+as\s+(\S+)$/.exec(trimmed)
      exported.add(asMatch === null ? trimmed : `${asMatch[1]}:${asMatch[2]}`)
    }
  }
  code = code.replace(exportList, '')

  for (const re of [
    /^export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm,
  ]) {
    let m
    while ((m = re.exec(source)) !== null) exported.add(m[1])
  }

  const assignments = [...exported]
    .map((entry) => {
      const [localRaw, exportedRaw] = entry.includes(':') ? entry.split(':') : [entry, entry]
      const local = localRaw.trim()
      const name = (exportedRaw ?? local).trim()
      return `exports.${name} = ${local};`
    })
    .join('\n\t\t')

  return { code: `${code}\n\t\t${assignments}`, requires }
}

/**
 * 为裸模块说明符分配一个稳定的局部变量名。
 * @param {string} spec - 模块说明符。
 * @param {Map<string, string>} requires - 已分配的映射。
 * @returns {string} 局部变量名。
 */
function localNameFor(spec, requires) {
  const existing = requires.get(spec)
  if (existing !== undefined) return existing
  const base = spec.replace(/^@/, '').replace(/[^\w$]/g, '_')
  const name = `__${base}`
  requires.set(spec, name)
  return name
}

/**
 * 客户端半边要打进同一个 factory 的本地模块。
 *
 * 第一个是入口，其余是被它 import 的本地模块。每个本地模块都被包成一个
 * IIFE 形式的伪模块（`const __name = (() => { var exports = {}; ... })()`），
 * 入口里对它们的相对 import 改写为直接引用这些变量。
 *
 * 之所以自己写而不用 bundler：这里没有第三方依赖，改写规则可枚举、可验证，
 * 不值得为几百行代码背一套构建工具链。
 */
const ENTRY = 'index.js'
const LOCAL_MODULES = ['vendors.js', 'match.js', 'routes.js', 'channels.js']

/** 本地模块名 -> 变量名，例如 `vendors.js` -> `__vendors`。 */
const localVarOf = (file) => `__${file.replace(/\.js$/, '').replace(/[^\w$]/g, '_')}`

let body = ''
const allRequires = new Map()
/** 已被内联的本地模块名（用于跨模块引用的合法性检查与断言）。 */
const inlined = new Set()

/**
 * 把一个源文件里对其它本地模块的相对 import 改写为直接引用已内联的变量。
 *
 * 关键：本地模块之间也会互相 import（routes.js → match.js），所以**每个**
 * 模块都要走这一步，不能只改入口。漏掉的话会在包里留下
 * `require("./match.js")` —— 那是运行时没有的模块，加载即抛。
 *
 * 依赖必须先于使用者出现在 LOCAL_MODULES 里（match.js 在 routes.js 前）。
 *
 * @param {string} source - 源文件内容。
 * @param {string} self - 当前文件名（跳过自引用）。
 * @returns {string} 改写后的源码。
 */
function inlineLocalImports(source, self) {
  let out = source
  for (const file of LOCAL_MODULES) {
    if (file === self) continue
    const re = new RegExp(
      `^import\\s*\\{([^}]*)\\}\\s*from\\s*['"]\\./${file.replace(/\./g, '\\.')}['"];?\\s*$`,
      'gm',
    )
    out = out.replace(re, (_m, bindings) => {
      const parts = bindings.split(',').map((p) => p.trim()).filter(Boolean)
      return `const { ${parts.join(', ')} } = ${localVarOf(file)};`
    })
  }
  return out
}

// 先内联被依赖的本地模块（顺序即依赖顺序）。
for (const file of LOCAL_MODULES) {
  const source = fs.readFileSync(path.join(root, 'src', 'client', file), 'utf8')
  const rewritten = inlineLocalImports(source, file)
  const { code, requires } = transform(rewritten, file)
  for (const [spec, name] of requires) allRequires.set(spec, name)
  body += `\n\t\t// ── ${file} ─────────────────────────────────────────────\n`
  body += `\t\tconst ${localVarOf(file)} = (() => {\n\t\t\tvar exports = {};\n\t\t${code.replace(/^(?!$)/gm, '\t')}\n\t\t\treturn exports;\n\t\t})();\n`
  inlined.add(file)
}

// 再处理入口。
{
  const source = fs.readFileSync(path.join(root, 'src', 'client', ENTRY), 'utf8')
  const rewritten = inlineLocalImports(source, ENTRY)
  const { code, requires } = transform(rewritten, ENTRY)
  for (const [spec, name] of requires) allRequires.set(spec, name)
  body += `\n\t\t// ── ${ENTRY} ─────────────────────────────────────────────\n`
  body += `\t\t${code.replace(/\n/g, '\n\t\t')}\n`
}

// 断言：包里不得残留任何相对模块的 require —— 那会在运行时抛「模块不存在」。
const leftover = [...allRequires.keys()].filter((spec) => spec.startsWith('.'))
if (leftover.length > 0) {
  throw new Error(
    `构建失败：${leftover.join(', ')} 是本地相对模块，必须内联而不是 require。`
    + ` 检查 LOCAL_MODULES 的顺序（被依赖者必须在前）。`,
  )
}

const requireLines = [...allRequires.entries()]
  .map(([spec, name]) => `\t\tconst ${name} = require(${JSON.stringify(spec)});`)
  .join('\n')

const out = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(PLUGIN_ID)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${requireLines}
${body}
\t\treturn module.exports;
\t}
});
`

const libDir = path.join(root, 'lib')
fs.mkdirSync(libDir, { recursive: true })
fs.writeFileSync(path.join(libDir, 'client.js'), out)

// ── 宿主半边 ────────────────────────────────────────────────────────────
// 宿主半边是普通 Node ESM，由 Loader 直接 import。它 import 了 ./pricing.js，
// 而 lib/ 下只有 index.js，所以把 pricing.js 原样复制过去保持相对导入成立。
fs.copyFileSync(path.join(root, 'src', 'pricing.js'), path.join(libDir, 'pricing.js'))
fs.copyFileSync(path.join(root, 'src', 'index.js'), path.join(libDir, 'index.js'))

console.log(`built lib/client.js (${out.length} bytes), lib/index.js, lib/pricing.js`)
