// 把 dsh-model-groups 登记进 DSH profile 的 package.json
//
// 用 Node 改而不是 PowerShell 的 ConvertTo-Json + Set-Content，原因：
//   1. Set-Content -Encoding UTF8 在 PowerShell 5.1 下**写 BOM**，
//      pnpm/Volta 解析 package.json 遇到 BOM 直接报
//      "Could not parse project manifest" —— 这是实测踩到的坑。
//   2. ConvertTo-Json 会重排整个文件（2 空格缩进变 4 空格），
//      制造与本次改动无关的 diff。
// 本脚本按原文件缩进风格做最小改写，并保留结尾换行与 LF/CRLF 习惯。
//
// 用法：node register.mjs <profileDir> [--check]

import fs from 'node:fs'
import path from 'node:path'

const SPEC = 'file:./vendor/dsh-model-groups'
const BUNDLE = 'dsh-model-groups'

const profileDir = process.argv[2]
const checkOnly = process.argv.includes('--check')

if (!profileDir) {
  console.error('用法：node register.mjs <profileDir> [--check]')
  process.exit(2)
}

const pkgPath = path.join(profileDir, 'package.json')
if (!fs.existsSync(pkgPath)) {
  console.error(`找不到 ${pkgPath}`)
  process.exit(1)
}

// 按二进制读，避免 BOM 与换行被 Node 的默认处理悄悄改掉
const rawBuf = fs.readFileSync(pkgPath)
const hadBom = rawBuf.length >= 3 && rawBuf[0] === 0xef && rawBuf[1] === 0xbb && rawBuf[2] === 0xbf
const raw = (hadBom ? rawBuf.subarray(3) : rawBuf).toString('utf8')
const eol = raw.includes('\r\n') ? '\r\n' : '\n'

let pkg
try {
  pkg = JSON.parse(raw)
} catch (error) {
  console.error(`package.json 不是合法 JSON：${error.message}`)
  process.exit(1)
}

if (hadBom) {
  console.warn('  注意：原文件带 UTF-8 BOM，本脚本会顺手去掉它（pnpm 无法解析带 BOM 的 manifest）')
}

// 探测原缩进：取第一个缩进行的空格数
const indentMatch = raw.match(/\n([ \t]+)"/)
const indent = indentMatch ? indentMatch[1].replace(/\t/g, '  ') : '  '

const changes = []

// ── dependencies ─────────────────────────────────────────────────────────
if (pkg.dependencies === null || typeof pkg.dependencies !== 'object') {
  pkg.dependencies = {}
}
const prevSpec = pkg.dependencies[BUNDLE]
if (prevSpec === SPEC) {
  changes.push(`dependencies 已是 ${SPEC}（无需改动）`)
} else if (prevSpec !== undefined) {
  pkg.dependencies[BUNDLE] = SPEC
  changes.push(`dependencies：${prevSpec} -> ${SPEC}`)
} else {
  pkg.dependencies[BUNDLE] = SPEC
  changes.push(`dependencies += ${BUNDLE}: ${SPEC}`)
}

// ── dsh.profile.bundles ──────────────────────────────────────────────────
if (!pkg.dsh || !pkg.dsh.profile || !Array.isArray(pkg.dsh.profile.bundles)) {
  console.error('package.json 缺少 dsh.profile.bundles 数组，结构与预期不符，已中止（原文件未改）')
  process.exit(1)
}
if (pkg.dsh.profile.bundles.includes(BUNDLE)) {
  changes.push('dsh.profile.bundles 已包含 dsh-model-groups（无需改动）')
} else {
  pkg.dsh.profile.bundles.push(BUNDLE)
  changes.push('dsh.profile.bundles += dsh-model-groups')
}

for (const line of changes) console.log(`  ${line}`)

if (checkOnly) {
  const done = prevSpec === SPEC && pkg.dsh.profile.bundles.includes(BUNDLE) && !hadBom
  console.log(done ? '  [OK] 配置已就绪' : '  [!!] 配置尚未就绪')
  process.exit(done ? 0 : 1)
}

// 只有当确有改动或需去 BOM 时才写盘
const needWrite = changes.some((c) => !c.includes('无需改动')) || hadBom
if (!needWrite) {
  console.log('  [OK] 无需写盘')
  process.exit(0)
}

// 备份
const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\..+$/, '')
const bakPath = `${pkgPath}.bak-modelgroups-${stamp}`
fs.copyFileSync(pkgPath, bakPath)
console.log(`  备份 -> ${path.basename(bakPath)}`)

// 保持原缩进与换行，**不带 BOM**
const out = JSON.stringify(pkg, null, indent) + eol
fs.writeFileSync(pkgPath, out, 'utf8')
console.log(`  已写回 ${path.basename(pkgPath)}（缩进 ${JSON.stringify(indent)}，${eol === '\r\n' ? 'CRLF' : 'LF'}，无 BOM）`)
