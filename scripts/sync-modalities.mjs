/**
 * 把「这个模型到底能不能看图」写成 DSH 认识的声明。
 *
 * ── 为什么需要这个脚本 ──
 *
 * DSH 已经内置完整的图片链路：composer 支持 Ctrl+V 粘贴图片 → 附件栏 → 上传 →
 * 会话里的 image content block → 适配器按各家协议发出。**缺的只有一步**：
 * 模型条目必须声明 `input: [text, image]`，否则 `dsh-llm-pi-ai` 会套用
 * `defaultInput = ['text']`，于是 prompt 准入阶段直接拒绝：
 *
 *   Model "deepseek-v4-1-flash" does not support image input.
 *   （reason: MODEL_DOES_NOT_SUPPORT_IMAGES）
 *
 * 本地转发端点（sk-local）不是 pi-ai 内置 catalog 里的 provider，45 条模型
 * 全部由 cordis.patch.yml 手写，因此**没有任何一行带 `input`** —— 图片一律被
 * 拒。本脚本把该字段补上。
 *
 * ── 为什么不能只信端点的 supports_images ──
 *
 * 实测端点会**少报**。2026-10-15 实测（scripts/vision-probe.png）：
 *
 *   | 模型 id                | 端点声明        | 实测看图 |
 *   |------------------------|-----------------|----------|
 *   | deepseek-v4.1-flash    | supports: true  | ✅ 能看   |
 *   | deepseek-v4-1-flash    | supports: false | ✅ 能看   |  ← 少报
 *   | glm-5.3                | supports: false | ❌ 不能看 |
 *
 * 少报是端点自己的保守声明（不同上游渠道能力不同）。所以本脚本**默认以实测
 * 为准**（`--probe`），端点元数据只作为探测失败时的兜底。
 *
 * ── 为什么不能反过来「全声明成能看图」 ──
 *
 * 过度声明会把不可用的图片放进**已经落盘**的消息里，之后每一轮都重发一次注定
 * 失败的请求（pi-ai 源码注释原话）。所以：探不通就退回端点元数据，元数据也没
 * 说支持就保持不声明。
 *
 * 用法：
 *   node scripts/sync-modalities.mjs --probe            # 实测 + 写回 patch
 *   node scripts/sync-modalities.mjs --check --probe    # 只看差异，不写
 *   node scripts/sync-modalities.mjs                    # 用缓存，不实测
 *   node scripts/sync-modalities.mjs --probe --prune    # 顺带删掉不能看图的线路
 *   node scripts/sync-modalities.mjs --patch <path> --base <url>
 *
 * `--prune` 把判定不是「能看图」的线路**整条删除**，这样模型选择器里只剩多模态
 * 模型（含判定未知的 —— 端点已经 404 的 auto/auto-fast 就属于这类）。删到还被
 * `model:` 引用的 id 时会拒绝执行，除非加 `--force`。
 *
 * 写回后**必须重启 DSH**：cordis.patch.yml 只在启动时读取。
 *
 * 退出码：0 成功；1 失败（端点不可达、patch 解析失败等）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchLocalCredits } from '../src/pricing.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const cacheFile = path.join(here, '..', 'modalities-cache.json')
const probeImage = path.join(here, 'vision-probe.png')

/** 探测图里的判别串：纯文本模型猜不到它。 */
const PROBE_SIGNATURE = '8341'

/**
 * 判定一次探测回答。
 *
 * 三态而不是布尔，因为「没答上来」不等于「看不见」：推理型模型在
 * `max_tokens` 被思考过程吃光时会返回空 content，上游 502 也只是线路抖动。
 * 把这两种当成「不能看图」会把声明从配置里删掉，等于把能看图的模型弄瞎。
 *
 *   yes     —— 说出了判别串，或同时提到 DSH 与图形/颜色：确实看到了像素
 *   no      —— 明确说看不到/图片未送达：确实不能看
 *   unknown —— 其它（空回答、答非所问、被截断）：无法判断，交给端点元数据兜底
 *
 * @param {string} reply - 模型回答（已把 reasoning_content 并入）。
 * @returns {'yes'|'no'|'unknown'}
 */
function gradeReply(reply) {
  const flat = reply.replace(/\s/g, '')
  if (flat.includes(PROBE_SIGNATURE)) return 'yes'
  if (/DSH/i.test(flat) && /(PROBE|红|蓝|圆|方)/i.test(flat)) return 'yes'
  if (/(无法查看|看不到|无法看到|未收到图片|没有收到图片|未提供图片|无法识别|不支持的图片|不受支持|没有传到我|无法获取图片|图片未成功|未成功加载|无法读取图片|请上传图片|请提供图片|没有收到任何图片)/.test(flat)) {
    return 'no'
  }
  return 'unknown'
}

// ── 参数 ──────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
/** 读取 `--flag value` 形态的参数。 */
function option(name, fallback) {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback
}
const baseURL = option('base', process.env.DSH_MODALITY_BASE ?? 'http://127.0.0.1:3065/v1')
const profile = option('profile', process.env.DSH_PROFILE ?? 'desktop')
const dshHome = process.env.DSH_HOME ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh')
const patchFile = option('patch', path.join(dshHome, 'profiles', profile, 'cordis.patch.yml'))
const doProbe = argv.includes('--probe')
const checkOnly = argv.includes('--check')
// --prune：把「不是多模态」的线路整条删掉，保证模型选择器里选到的都能看图。
// 判定为未知的也算删（auto/auto-fast 在端点上已经 404）。
const doPrune = argv.includes('--prune')
const force = argv.includes('--force')
const probeConcurrency = Number(option('concurrency', '4'))

// ── patch 解析 ────────────────────────────────────────────────────────────

/**
 * 在 patch 文本里定位 llm-pi-ai 块内的全部模型条目。
 *
 * patch 是手写 YAML，带注释与空行 —— 用真正的 YAML 解析再回写会**吃掉注释**，
 * 所以这里按行定位、只改目标行。结构固定：
 *
 *   - id: llm-pi-ai            ← 顶层条目，缩进 0
 *     config:
 *       providers:
 *         sk-local:            ← 线路
 *           models:
 *             - id: hy3        ← 模型条目
 *               name: Hy3
 *
 * @param {string[]} lines - patch 文件按行切分的结果。
 * @returns {{entries: Array<{id: string, idLine: number, fieldIndent: number, endLine: number}>}}
 */
function findModelEntries(lines) {
  let blockStart = -1
  let blockEnd = lines.length
  for (let i = 0; i < lines.length; i++) {
    if (/^- id: llm-pi-ai\s*$/.test(lines[i])) {
      blockStart = i
      continue
    }
    // 顶层条目（缩进 0 的 `- `）标志上一个块结束。
    if (blockStart >= 0 && /^- /.test(lines[i])) {
      blockEnd = i
      break
    }
  }
  if (blockStart < 0) return { entries: [] }

  const entries = []
  let modelsIndent = -1
  for (let i = blockStart; i < blockEnd; i++) {
    const models = /^(\s*)models:\s*$/.exec(lines[i])
    if (models !== null) {
      modelsIndent = models[1].length
      continue
    }
    if (modelsIndent < 0) continue
    const idLine = /^(\s*)- id:\s*(\S+)\s*$/.exec(lines[i])
    if (idLine !== null && idLine[1].length > modelsIndent) {
      // 条目字段一直延伸到下一个同级 `- id:` 或缩进退回 models 之前。
      let end = i + 1
      while (end < blockEnd) {
        const line = lines[end]
        if (line.trim() === '') break
        const nextId = /^(\s*)- id:/.exec(line)
        const indent = line.length - line.trimStart().length
        if (nextId !== null && nextId[1].length === idLine[1].length) break
        if (indent <= modelsIndent) break
        end++
      }
      entries.push({
        id: idLine[2],
        idLine: i,
        fieldIndent: idLine[1].length + 2,
        endLine: end,
      })
    }
  }
  return { entries }
}

/** 该条目现有的 `input:` 行号，没有则 -1。 */
function existingInputLine(lines, entry) {
  for (let i = entry.idLine + 1; i < entry.endLine; i++) {
    if (/^\s*input:\s*/.test(lines[i])) return i
  }
  return -1
}

// ── 探测 ──────────────────────────────────────────────────────────────────

let probePayload = null
/** 读出探测图的 base64（只在真的探测时才需要）。 */
function probeDataURL() {
  if (probePayload === null) probePayload = fs.readFileSync(probeImage).toString('base64')
  return `data:image/png;base64,${probePayload}`
}

/**
 * 对一条线路做一次真实的看图请求。
 *
 * 判定只看图里那个判别串：文本模型猜不到 `8341`，能说出来就证明像素真的到达了
 * 模型。判定有疑问时返回 `images: null`（未知）而不是 false —— 见 gradeReply。
 *
 * @param {string} model - 线路里的模型 id。
 * @param {string} apiKey - 端点凭据。
 * @returns {Promise<{images: boolean|null, verdict: string, source: string, evidence: string}>}
 */
async function probeModel(model, apiKey) {
  const body = {
    model,
    // 推理型模型会把预算烧在思考上，太小会让 content 变成空串（实测 120 时
    // sensenova / glm-5-3 就是空回答）。给足预算，反正答案很短。
    max_tokens: 400,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: '只回答，不要解释：图中的文字是什么？两个图形分别是什么颜色？' },
          { type: 'image_url', image_url: { url: probeDataURL() } },
        ],
      },
    ],
  }
  const response = await fetch(`${baseURL.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`)
  const payload = JSON.parse(text)
  const message = payload?.choices?.[0]?.message ?? {}
  // 有的网关只回 reasoning_content；那是模型自己写的东西，同样算证据。
  const reply = [message.content, message.reasoning_content]
    .filter((part) => typeof part === 'string' && part !== '')
    .join('\n')
  const verdict = gradeReply(reply)
  return {
    images: verdict === 'yes' ? true : verdict === 'no' ? false : null,
    verdict,
    source: 'probe',
    evidence: reply.replace(/\s+/g, ' ').slice(0, 160),
  }
}

/** 有界并发地跑完一批探测，未知/失败的各重试一次。 */
async function probeAll(models, apiKey) {
  const results = new Map()
  const queue = models.map((model) => ({ model, attempt: 1 }))
  const workers = Array.from({ length: Math.max(1, probeConcurrency) }, async () => {
    for (;;) {
      const item = queue.shift()
      if (item === undefined) return
      const { model, attempt } = item
      let result
      try {
        result = await probeModel(model, apiKey)
      } catch (error) {
        result = {
          images: null,
          verdict: 'error',
          source: 'probe',
          evidence: error instanceof Error ? error.message : String(error),
        }
      }
      if (result.images === null && attempt < 2) {
        queue.push({ model, attempt: attempt + 1 })
        continue
      }
      results.set(model, { ...result, source: result.verdict === 'error' ? 'probe-failed' : 'probe' })
      const mark = result.images === true ? '✅ 能看图' : result.images === false ? '❌ 不能看' : '❔ 无法判断'
      console.log(`   ${mark}  ${model}  「${result.evidence.slice(0, 64)}」`)
    }
  })
  await Promise.all(workers)
  return results
}

// ── 主流程 ────────────────────────────────────────────────────────────────

if (!fs.existsSync(patchFile)) {
  console.error(`❌ 找不到 patch 文件: ${patchFile}`)
  process.exit(1)
}
const lines = fs.readFileSync(patchFile, 'utf8').split(/\r?\n/)
const { entries } = findModelEntries(lines)
if (entries.length === 0) {
  console.error('❌ 没在 patch 里找到 llm-pi-ai 的模型列表（结构变了？）')
  process.exit(1)
}
console.log(`📄 ${patchFile}`)
console.log(`   模型条目 ${entries.length} 条`)

// 1. 端点元数据（兜底）
let relay = new Map()
try {
  relay = await fetchLocalCredits(baseURL)
  console.log(`🔎 端点 ${baseURL} 声明 ${relay.size} 个模型`)
} catch (error) {
  console.log(`⚠️  端点元数据抓取失败（不影响实测）: ${error instanceof Error ? error.message : String(error)}`)
}

// 2. 缓存
let cache = { version: 1, baseURL, models: {} }
if (fs.existsSync(cacheFile)) {
  try {
    cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
    if (cache.baseURL !== baseURL) {
      console.log(`ℹ️  缓存来自 ${cache.baseURL}，与当前端点不同 —— 忽略缓存`)
      cache = { version: 1, baseURL, models: {} }
    }
  } catch {
    console.log('ℹ️  缓存损坏，重新开始')
  }
}
cache.baseURL = baseURL

// 3. 实测
if (doProbe) {
  const apiKey = readApiKey()
  const targets = entries.map((entry) => entry.id)
  console.log(`\n🔬 实测 ${targets.length} 条线路的看图能力（并发 ${probeConcurrency}）…`)
  const probed = await probeAll(targets, apiKey)
  for (const [id, result] of probed) cache.models[id] = { ...result, at: new Date().toISOString() }
}

// 4. 决策
const wanted = new Map()
const report = { image: [], text: [], unknown: [] }
for (const entry of entries) {
  const probed = cache.models[entry.id]
  const declared = relay.get(entry.id)?.images
  let images = null
  let source = 'none'
  if (probed !== undefined && probed.images !== null && probed.images !== undefined) {
    images = probed.images
    source = 'probe'
  } else if (declared !== undefined) {
    images = declared
    source = 'relay'
  }
  wanted.set(entry.id, images)
  ;(images === true ? report.image : images === false ? report.text : report.unknown).push({
    ...entry,
    source,
  })
}

// 5. 生成编辑（自下而上，行号才不会漂）
const pruned = doPrune ? entries.filter((entry) => wanted.get(entry.id) !== true) : []
const prunedIds = new Set(pruned.map((entry) => entry.id))

// 安全闸：别把还被引用的模型删掉（例如 agent-default-model 指向它）。
// 只找 models 列表之外的 `model: <id>`，列表自身的 `- id:` 不算引用。
if (pruned.length > 0) {
  const dangling = []
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*model:\s*(\S+)\s*$/.exec(lines[i])
    if (match !== null && prunedIds.has(match[1])) dangling.push(`第 ${i + 1} 行: ${lines[i].trim()}`)
  }
  if (dangling.length > 0) {
    console.error('\n❌ 有其它配置项引用着待删除的模型，拒绝执行：')
    for (const line of dangling) console.error(`   ${line}`)
    if (!force) {
      console.error('   先改掉那些引用，或确认无误后加 --force 强制执行。')
      process.exit(1)
    }
    console.error('   （--force：仍要删除）')
  }
}

const edits = []
for (const entry of entries) {
  if (prunedIds.has(entry.id)) {
    // 整条删掉：idLine 到 endLine 就是这条线路的全部行。
    edits.push({ kind: 'prune', at: entry.idLine, to: entry.endLine, id: entry.id })
    continue
  }
  const images = wanted.get(entry.id)
  const existing = existingInputLine(lines, entry)
  const pad = ' '.repeat(entry.fieldIndent)
  if (images === true) {
    const line = `${pad}input: [text, image]`
    if (existing < 0) edits.push({ kind: 'insert', at: entry.idLine + 1, line, id: entry.id })
    else if (lines[existing].trim() !== 'input: [text, image]') {
      edits.push({ kind: 'replace', at: existing, line, id: entry.id })
    }
  } else if (existing >= 0) {
    // 不再支持图像（或探测判定不能看）→ 删掉声明，回到默认的纯文本。
    edits.push({ kind: 'remove', at: existing, id: entry.id })
  }
}

console.log(`\n📊 判定：能看图 ${report.image.length} · 不能看 ${report.text.length} · 未知 ${report.unknown.length}`)
if (doPrune) console.log(`   保留 ${entries.length - pruned.length} 条 · 删除 ${pruned.length} 条（只留能看图的）`)
else console.log('   （未知的保持不声明；加 --prune 可把不能看图的整条删掉）')
if (report.image.length > 0) {
  console.log('\n能看图：')
  for (const e of report.image) console.log(`   ✅ ${e.id.padEnd(34)} [${e.source}]`)
}
if (report.text.length > 0) {
  console.log('\n不能看图（不声明，DSH 会拒绝贴图并提示换模型）：')
  for (const e of report.text) console.log(`   ❌ ${e.id.padEnd(34)} [${e.source}]`)
}
if (report.unknown.length > 0) {
  console.log('\n未知（不加声明；想确定就加 --probe）：')
  for (const e of report.unknown) console.log(`   ❔ ${e.id}`)
}

if (edits.length === 0) {
  console.log('\n✨ patch 已经是正确的，无需改动。')
} else {
  const inserted = edits.filter((edit) => edit.kind === 'insert').length
  const replaced = edits.filter((edit) => edit.kind === 'replace').length
  const removed = edits.filter((edit) => edit.kind === 'remove').length
  const prunedCount = edits.filter((edit) => edit.kind === 'prune').length
  console.log(`\n✏️  改动：补声明 ${inserted} · 改声明 ${replaced} · 去声明 ${removed}` + (doPrune ? ` · 删线路 ${prunedCount}` : ''))
  for (const edit of edits) {
    if (edit.kind === 'prune') {
      console.log(`   删线路  ${edit.id.padEnd(34)} （${edit.to - edit.at} 行）`)
    } else if (edit.kind === 'remove') {
      console.log(`   去声明  ${edit.id.padEnd(34)} ${lines[edit.at].trim()}`)
    } else {
      console.log(`   ${edit.kind.padEnd(7)} ${edit.id.padEnd(34)} ${edit.line.trim()}`)
    }
  }
}

if (!checkOnly && edits.length > 0) {
  const next = [...lines]
  for (const edit of edits.sort((a, b) => b.at - a.at)) {
    if (edit.kind === 'insert') next.splice(edit.at, 0, edit.line)
    else if (edit.kind === 'replace') next[edit.at] = edit.line
    else if (edit.kind === 'prune') next.splice(edit.at, edit.to - edit.at)
    else next.splice(edit.at, 1)
  }
  const backup = `${patchFile}.bak-modalities-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`
  fs.copyFileSync(patchFile, backup)
  fs.writeFileSync(patchFile, next.join('\n'))
  console.log(`\n✅ 已写回 ${patchFile}`)
  console.log(`   备份 ${backup}`)
  console.log('\n⚠️  重启 DSH 后生效（cordis.patch.yml 只在启动时读取）。')
} else if (checkOnly && edits.length > 0) {
  console.log('\n（--check：未写回）')
}

if (doProbe) {
  fs.writeFileSync(cacheFile, `${JSON.stringify(cache, null, 2)}\n`)
  console.log(`💾 实测结果已缓存到 ${cacheFile}`)
}

/** 端点凭据：优先环境变量，其次 .credentials.yaml 的 refs 段。 */
function readApiKey() {
  if (process.env.SK_LOCAL_API_KEY) return process.env.SK_LOCAL_API_KEY
  const credentials = path.join(dshHome, '.credentials.yaml')
  if (fs.existsSync(credentials)) {
    const match = /^\s*SK_LOCAL_API_KEY:\s*(\S+)\s*$/m.exec(fs.readFileSync(credentials, 'utf8'))
    if (match !== null) return match[1].replace(/^["']|["']$/g, '')
  }
  // 本地转发端点通常不校验凭据，缺了也给个占位值。
  return 'sk-local'
}
