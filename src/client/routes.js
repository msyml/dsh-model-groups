/**
 * 同一模型的多条转发线路：合并、排序、选默认。
 *
 * ── 为什么需要这个 ──
 *
 * 同一个模型在端点里可能出现多条线路，价格差很大。实测你的 8 组模型平均价差
 * 2.90×，最大 8.33×：
 *
 *   Deepseek-V4.1-Flash  ×0.03(workbuddy-intl) … ×0.25(raccoon)   8.33×
 *   GLM-5.3-Flash        ×0.06(catpaw)         … ×0.20(raccoon)   3.33×
 *   Kimi-K3              ×0.94(catpaw)         … ×1.83(trae)      1.95×
 *
 * 平铺展示时它们彼此无关，随手选到贵的那条纯属运气。这里按「模型身份」聚拢，
 * 默认给最省的那条。
 *
 * 身份判定见 {@link identityOf}：用厂商 + 型号核心，而不是目录里的 `name`
 * （`name` 不可靠，会把同一个模型拆成多行）。
 */

import { vendorOf, coreOf } from './match.js'

/**
 * 取一个模型的「身份 key」。
 *
 * 用 **厂商 + 型号核心**（复用 match.js 的严格归一化），而不是目录里的 `name`。
 *
 * 原因是 `name` 不可靠 —— provider 配置里有的写规范名、有的直接照抄 id，
 * 于是**同一个模型会被拆成多行**。实测你的 45 个模型：
 *
 *   name 分组    → 32 组
 *   vendor+core  → 27 组     ← 多并掉的 5 组全是同一个模型
 *
 * 被 name 拆开、但其实同源的例子：
 *   `glm-5-3`(×0.75 raccoon) 与 `glm-5.3`(×0.44 catpaw)     点/横线写法不同
 *   `glm-5-3-flash`(×0.2)    与 `glm-5.3-flash`(×0.06)
 *   `deepseek-v4.1-flash`(×0.11) 与 `deepseek-v4-1-flash`(×0.25)
 *   `sensenova-6.8-flash`    与 `sensenova-6-8-flash`
 *
 * 不合并它们，就等于把「同一模型的更贵线路」伪装成另一个模型推荐给你 ——
 * 那正是本插件要解决的问题。
 *
 * 安全性：`coreOf` 会剥掉厂商前缀，单用它会误并（开发中曾把 `glm-5.3-flash`
 * 匹配到 `stepfun/step-5-preview`）。这里要求**厂商指纹也相同**，把这类错误
 * 挡在门外。厂商识别不出来时退回用 `name`。
 *
 * @param {{ id: string, name?: string }} model - 目录条目。
 * @returns {string} 分组键。
 */
export function identityOf(model) {
  const id = String(model?.id ?? '')
  const vendor = vendorOf(id)
  if (vendor !== null) {
    const core = coreOf(id)
    if (core !== '') return `${vendor}|${core}`
  }
  const name = typeof model?.name === 'string' ? model.name.trim() : ''
  return `name|${(name !== '' ? name : id).toLowerCase()}`
}

/**
 * 在一组同源线路里挑一个最适合当标题的名字。
 *
 * 组里可能混着规范名与 id 本身（`GLM-5.3` / `glm-5-3`），挑最像「给人看的」
 * 那个：优先不是 id 的、含大写的、含版本点的。
 *
 * @param {ReadonlyArray<{id: string, name?: string}>} routes - 同组线路。
 * @returns {string} 显示名。
 */
export function bestName(routes) {
  let best = ''
  let bestScore = -1
  for (const route of routes ?? []) {
    const name = typeof route?.name === 'string' ? route.name.trim() : ''
    if (name === '') continue
    let score = 0
    if (name.toLowerCase() !== String(route.id).toLowerCase()) score += 4
    if (/[A-Z]/.test(name)) score += 2
    if (name.includes('.')) score += 2
    score += Math.min(name.length, 40) / 100
    if (score > bestScore) {
      bestScore = score
      best = name
    }
  }
  if (best !== '') return best
  return routes?.[0]?.name ?? routes?.[0]?.id ?? ''
}

/**
 * 一条线路是否支持工具调用。
 *
 * 端点没说（undefined）时乐观视为支持 —— 只标记明确说 `false` 的，
 * 避免因为缺字段就把能用的模型标成不可用。
 *
 * @param {object|undefined} info - 本地线路信息。
 * @returns {boolean} 是否支持。
 */
export function supportsTools(info) {
  return info?.toolCall !== false
}

/**
 * 线路排序：能用的优先，然后按价格从低到高。
 *
 * 排序规则（依次）：
 *   1. 支持工具调用的在前 —— 编码 agent 里不能调工具的模型基本没法用；
 *   2. 有已知价格的在前 —— 价格未知的不该冒充「最省」；
 *   3. 价格低的在前；
 *   4. 最后用 id 保证稳定顺序。
 *
 * @param {Array<object>} routes - 线路（目录条目）。
 * @param {Record<string, object>} local - 模型 id -> 本地信息。
 * @returns {Array<object>} 排序后的新数组。
 */
export function sortRoutes(routes, local) {
  const rate = (route) => {
    const value = local?.[route.id]?.credits
    return Number.isFinite(value) ? value : null
  }
  return routes.slice().sort((left, right) => {
    const lt = supportsTools(local?.[left.id]) ? 0 : 1
    const rt = supportsTools(local?.[right.id]) ? 0 : 1
    if (lt !== rt) return lt - rt

    const lr = rate(left)
    const rr = rate(right)
    if (lr === null && rr !== null) return 1
    if (lr !== null && rr === null) return -1
    if (lr !== null && rr !== null && lr !== rr) return lr - rr

    return String(left.id).localeCompare(String(right.id))
  })
}

/**
 * 把一组目录条目按模型身份合并成「模型 + 其全部线路」。
 *
 * @param {ReadonlyArray<object>} models - 同一 provider 下的目录条目。
 * @param {Record<string, object>} local - 模型 id -> 本地线路信息。
 * @returns {Array<{ key: string, name: string, routes: Array<object>, defaultRoute: object, hasMultiple: boolean, cheapest: object|null, dearest: object|null, spread: number|null }>}
 *   合并后的模型组，保持各组首次出现的顺序。
 */
export function mergeRoutes(models, local) {
  /** @type {Map<string, Array<object>>} */
  const buckets = new Map()
  for (const model of models ?? []) {
    const key = identityOf(model)
    const bucket = buckets.get(key)
    if (bucket === undefined) buckets.set(key, [model])
    else bucket.push(model)
  }

  const groups = []
  for (const [key, routes] of buckets) {
    const sorted = sortRoutes(routes, local)
    const priced = sorted.filter((route) => Number.isFinite(local?.[route.id]?.credits))
    // cheapest/dearest 只在「支持工具调用且价格已知」的子集里算，避免把一个
    // 不能用的线路当成「最省」推荐给用户。
    const usable = priced.filter((route) => supportsTools(local?.[route.id]))
    const pool = usable.length > 0 ? usable : priced
    const values = pool.map((route) => local[route.id].credits)
    const cheapest = pool.length > 0 ? pool.reduce((best, route) => (local[route.id].credits < local[best.id].credits ? route : best), pool[0]) : null
    const dearest = pool.length > 0 ? pool.reduce((worst, route) => (local[route.id].credits > local[worst.id].credits ? route : worst), pool[0]) : null
    const spread = values.length >= 2 ? Math.max(...values) / Math.min(...values) : null

    groups.push({
      key,
      name: bestName(routes),
      routes: sorted,
      defaultRoute: sorted[0],
      hasMultiple: sorted.length > 1,
      cheapest,
      dearest,
      spread: spread !== null && Number.isFinite(spread) && spread > 1 ? spread : null,
    })
  }
  return groups
}

/**
 * 生成本地价格信息的紧凑文本。
 *
 * @param {object|undefined} info - 本地线路信息。
 * @param {(value: number) => string} formatNumber - 数字美化函数。
 * @returns {string} 如 `0.44`；无价格返回空串。
 */
export function rateText(info, formatNumber) {
  if (info === undefined) return ''
  if (Number.isFinite(info.credits)) return formatNumber(info.credits)
  // 「低」「中」这类定性描述原样返回，不当数字。
  if (typeof info.raw === 'string' && /^[^\dx]/i.test(info.raw)) return info.raw
  return ''
}
