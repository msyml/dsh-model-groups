/**
 * 价格索引：合并两个数据源。
 *
 * ── 源 A：本地转发端点的 /v1/models（首选，反映**你实际被扣的**额度）──
 *
 *   {"id":"glm-5.3","credits":"x0.44 credits","owned_by":"catpaw",...}
 *
 * `credits` 是这条转发线路的计费倍率，`owned_by` 是上游渠道。它比任何外部
 * 挂牌价都更贴近你真实的成本，所以**优先用它**。而且它以 provider 里的模型
 * id 为键，是精确匹配 —— 不需要任何模糊匹配。
 *
 * ── 源 B：OpenRouter 的 /api/v1/models（补充能力分数）──
 *
 *   有成本之外的信息：artificial_analysis 的 intelligence / coding / agentic
 *   分数与 Design Arena 的 Elo。本地端点没有这些。
 *
 * 两个源独立抓取：任一失败都保留另一个的结果，绝不因一个源挂了就整体失败。
 */

import fs from 'node:fs'
import path from 'node:path'

/** OpenRouter 数据源。 */
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/models'

/** 默认缓存有效期：24 小时。 */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

/**
 * 解析本地端点 `credits` 字段。
 *
 * 取值形态很杂，实测见过：
 *   `x0.44`  `x0.44 credits`  `x0`  `x0 credits`  `x0.00`  `x0.00 credits`
 *   `低`     `中`             ``（空）
 *
 * 只有能解析成数字的才作为价格；「低/中」这类定性描述与空值一律返回 null
 * （交由分数或空显示处理），绝不臆测成数字。
 *
 * @param {unknown} raw - credits 原始值。
 * @returns {number|null} 倍率数值，或 null。
 */
export function parseCredits(raw) {
  if (typeof raw !== 'string') return null
  const m = /x\s*([0-9]+(?:\.[0-9]+)?)/i.exec(raw.trim())
  if (m === null) return null
  const value = Number(m[1])
  return Number.isFinite(value) ? value : null
}

/**
 * 抓本地转发端点的模型列表。
 *
 * 除计费倍率外，还抓取能力开关与上下文上限 —— 这些是端点独有、OpenRouter
 * 给不了的信息（尤其是 `supports_tool_call`：编码 agent 里不能调工具的模型
 * 基本没法用）。
 *
 * @param {string} baseURL - provider 的 baseURL，例如 http://127.0.0.1:3065/v1
 * @param {string|undefined} apiKey - 可选凭据（本地端点通常不需要）。
 * @returns {Promise<Map<string, object>>} 模型 id -> 本地线路信息。
 */
export async function fetchLocalCredits(baseURL, apiKey) {
  const url = `${String(baseURL).replace(/\/+$/, '')}/models`
  const headers = { accept: 'application/json' }
  if (typeof apiKey === 'string' && apiKey !== '') headers.authorization = `Bearer ${apiKey}`
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`本地端点 ${url} 返回 ${response.status}`)
  const payload = await response.json()
  const list = Array.isArray(payload?.data) ? payload.data : null
  if (list === null) throw new Error('本地端点响应里没有 data 数组')

  /** 布尔字段：只在存在时记录，避免把 undefined 混进 JSON。 */
  const bool = (value) => (typeof value === 'boolean' ? value : undefined)
  /** 数字字段：只在是正整数时记录。 */
  const count = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : undefined)

  const out = new Map()
  for (const entry of list) {
    if (typeof entry?.id !== 'string') continue
    const toolCall = bool(entry.supports_tool_call)
    const reasoning = bool(entry.supports_reasoning)
    const images = bool(entry.supports_images)
    const video = bool(entry.supports_video)
    const maxInput = count(entry.max_input_tokens)
    const maxOutput = count(entry.max_output_tokens)
    out.set(entry.id, {
      credits: parseCredits(entry.credits),
      ...(typeof entry.credits === 'string' && entry.credits.trim() !== ''
        ? { raw: entry.credits.trim() }
        : {}),
      ...(typeof entry.owned_by === 'string' && entry.owned_by !== ''
        ? { ownedBy: entry.owned_by }
        : {}),
      // 能力开关：只在端点明确给出布尔值时才记录。
      ...(toolCall === undefined ? {} : { toolCall }),
      ...(reasoning === undefined ? {} : { reasoning }),
      ...(images === undefined ? {} : { images }),
      ...(video === undefined ? {} : { video }),
      ...(maxInput === undefined ? {} : { maxInput }),
      ...(maxOutput === undefined ? {} : { maxOutput }),
      ...(typeof entry.name === 'string' && entry.name !== '' ? { name: entry.name } : {}),
    })
  }
  return out
}

/**
 * 把 OpenRouter 的一个模型条目压成索引项。
 * @param {any} model - OpenRouter 模型对象。
 * @returns {object|null} 精简条目；缺价格时返回 null。
 */
function toEntry(model) {
  const pricing = model?.pricing ?? {}
  const prompt = Number(pricing.prompt)
  const completion = Number(pricing.completion)
  // 负数与缺失都表示「无公开价格」（例如路由器类模型是 -1），跳过。
  if (!Number.isFinite(prompt) || !Number.isFinite(completion) || prompt < 0 || completion < 0) {
    return null
  }
  const aa = model?.benchmarks?.artificial_analysis ?? {}
  const arena = Array.isArray(model?.benchmarks?.design_arena) ? model.benchmarks.design_arena : []
  const arenaElo = arena.length > 0
    ? Math.max(...arena.map((row) => Number(row?.elo)).filter((v) => Number.isFinite(v)))
    : undefined

  return {
    id: model.id,
    name: model.name,
    // 每百万 token 的美元价（OpenRouter 给的是每 token）
    inPerM: Number((prompt * 1e6).toFixed(6)),
    outPerM: Number((completion * 1e6).toFixed(6)),
    ...(Number.isFinite(Number(aa.intelligence_index)) ? { intelligence: Number(aa.intelligence_index) } : {}),
    ...(Number.isFinite(Number(aa.coding_index)) ? { coding: Number(aa.coding_index) } : {}),
    ...(Number.isFinite(Number(aa.agentic_index)) ? { agentic: Number(aa.agentic_index) } : {}),
    ...(arenaElo === undefined ? {} : { arenaElo }),
  }
}

/**
 * 抓取 OpenRouter 的模型索引。
 * @returns {Promise<Array<object>>} 精简条目数组。
 */
async function fetchOpenRouter() {
  const response = await fetch(OPENROUTER_URL, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`OpenRouter 返回 ${response.status} ${response.statusText}`)
  const payload = await response.json()
  if (!Array.isArray(payload?.data)) throw new Error('OpenRouter 响应里没有 data 数组')
  const entries = []
  for (const model of payload.data) {
    const entry = toEntry(model)
    if (entry !== null) entries.push(entry)
  }
  return entries
}

/**
 * 生成完整索引：本地计费 + OpenRouter 价格/分数，二者合并。
 *
 * @param {{ baseURL?: string, apiKey?: string }} localEndpoint - 本地转发端点信息。
 * @returns {Promise<object>} 索引对象（可直接 JSON 序列化）。
 */
export async function fetchIndex(localEndpoint = {}) {
  const notes = []

  // 两个源独立抓取：任一失败都保留另一个的结果。
  let openRouter = []
  try {
    openRouter = await fetchOpenRouter()
  } catch (error) {
    notes.push(`OpenRouter: ${error instanceof Error ? error.message : String(error)}`)
  }

  let local = new Map()
  if (typeof localEndpoint.baseURL === 'string' && localEndpoint.baseURL !== '') {
    try {
      local = await fetchLocalCredits(localEndpoint.baseURL, localEndpoint.apiKey)
    } catch (error) {
      notes.push(`本地端点: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // 分数按规范 id 索引，供客户端匹配时查。
  const scores = openRouter
    .filter((e) => e.intelligence !== undefined || e.arenaElo !== undefined)
    .map((e) => ({
      id: e.id,
      ...(e.intelligence === undefined ? {} : { intelligence: e.intelligence }),
      ...(e.coding === undefined ? {} : { coding: e.coding }),
      ...(e.agentic === undefined ? {} : { agentic: e.agentic }),
      ...(e.arenaElo === undefined ? {} : { arenaElo: e.arenaElo }),
    }))

  // 本地线路信息直接以 provider 里的 id 为键 —— 这是**精确**匹配，无需模糊。
  // 键名用 `local`（而不叫 credits），因为它现在不止含计费倍率，还有能力开关。
  const localOut = {}
  for (const [id, info] of local) localOut[id] = info

  return {
    fetchedAt: new Date().toISOString(),
    sources: {
      local: typeof localEndpoint.baseURL === 'string' ? localEndpoint.baseURL : null,
      openRouter: OPENROUTER_URL,
    },
    notes,
    localCount: Object.keys(localOut).length,
    scoreCount: scores.length,
    local: localOut,
    scores,
    // 保留 OpenRouter 的价格条目，供没有本地倍率的模型兜底显示。
    prices: openRouter.map((e) => ({ id: e.id, inPerM: e.inPerM, outPerM: e.outPerM })),
  }
}

/**
 * 抓取并写入缓存文件；失败时抛出，由调用方决定是否容忍。
 * @param {string} target - 目标 JSON 路径。
 * @param {{ baseURL?: string, apiKey?: string }} localEndpoint - 本地转发端点信息。
 * @returns {Promise<object>} 写入的索引。
 */
export async function refresh(target, localEndpoint = {}) {
  const index = await fetchIndex(localEndpoint)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  // 先写临时文件再改名，避免读到写了一半的文件。
  const tmp = `${target}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(index))
  fs.renameSync(tmp, target)
  return index
}

/**
 * 读取缓存，判断是否过期。
 * @param {string} target - 缓存路径。
 * @param {number} ttlMs - 有效期。
 * @returns {{ index: object|null, stale: boolean, ageMs: number|null }}
 */
export function readCache(target, ttlMs = DEFAULT_TTL_MS) {
  let raw
  try {
    raw = fs.readFileSync(target, 'utf8')
  } catch {
    return { index: null, stale: true, ageMs: null }
  }
  let index
  try {
    index = JSON.parse(raw)
  } catch {
    return { index: null, stale: true, ageMs: null }
  }
  const fetchedAt = Date.parse(index?.fetchedAt ?? '')
  if (!Number.isFinite(fetchedAt)) return { index: null, stale: true, ageMs: null }
  const ageMs = Date.now() - fetchedAt
  return { index, stale: ageMs > ttlMs, ageMs }
}

export { DEFAULT_TTL_MS, OPENROUTER_URL }
