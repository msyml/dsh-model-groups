/**
 * dsh-model-groups —— 按厂商分组、按线路合并的模型选择命令（浏览器半边）。
 *
 * ══ 历史坑（务必保留）══
 *
 * 第一版试图接管 composer 的 `conversation.input.model` 席位。那是 single slot，
 * 被内置的 @deepseek-ai/dsh-client-ui-model-selection 占用，于是第一版禁用了
 * 内置插件。但 `modelDirectories` 服务**正是那个内置插件提供的**，禁用它就等于
 * 抽掉了自己依赖的服务：
 *
 *     dsh-model-groups: pending (waiting for service: modelDirectories)
 *     Error: web boot: 1 entry did not activate
 *
 * 整个 Web boot 失败。所以现在：不碰任何席位、不禁用任何插件、不注册服务，
 * 只注册命令，走 `commandUi` 的 popupSelect。
 *
 * ══ 弹窗的能力边界（决定了本文件的所有取舍）══
 *
 * popupSelect 的每个选项只有这些字段：`id` / `label` / `detail` / `group` /
 * `badge` / `active`。其中：
 *   - `detail` 与 `label` 都是**纯字符串**，插不进彩色 span（类名是构建时哈希的）；
 *   - `badge` 是**独立的第二个文本位**（渲染成上标 `<sup>`，8px），不占 detail
 *     宽度 —— 本插件用它承载「⚠无工具」与「N条线路」标记；
 *   - 弹窗是**扁平列表**，没有展开/子菜单机制，选项在打开时一次性算好。
 *
 * 最后一条决定了 P0 的实现方式：真正的「行内展开」做不到，所以分成两个命令 ——
 * `/models`（默认，每个模型一行、取最省线路）与 `/models-all`（展开，全部线路）。
 */

import { groupByVendor } from './vendors.js'
import { matchModel } from './match.js'
import { mergeRoutes, rateText } from './routes.js'
import { channelName } from './channels.js'

/** 交互所需的客户端服务 —— 全部由内置插件提供，不禁用任何行。 */
export const inject = ['commandUi', 'locale', 'modelDirectories', 'sessions']

const NS = 'modelGroups'

/** 折叠态命令：每个模型一行，默认取最省线路。 */
const COMMAND_MERGED = 'models'
/** 展开态命令：列出全部线路（含同模型的其它转发线）。 */
const COMMAND_ALL = 'models-all'

/** 宿主提供的价格/分数路由。 */
const PRICING_ROUTE = '/model-groups/pricing'

/**
 * 把 token 数压成便于扫读的短标签。
 * @param {number | undefined} value - 原始 token 数。
 * @returns {string} 如 `1M`、`200K`，无法计算时返回空串。
 */
function formatTokens(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return ''
  if (value >= 1_000_000) {
    const millions = value / 1_000_000
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`
  }
  if (value >= 1000) return `${Math.round(value / 1000)}K`
  return String(value)
}

/**
 * 数字美化：去掉多余的零。
 * @param {number} value - 数值。
 * @returns {string|null} 展示串；非有限数返回 null。
 */
function trimNumber(value) {
  if (!Number.isFinite(value)) return null
  if (value === 0) return '0'
  if (value < 0.01) return value.toFixed(4)
  if (value < 1) return value.toFixed(3)
  if (value < 100) return value.toFixed(2)
  return String(Math.round(value)).replace(/0+$/, '').replace(/\.$/, '')
}

/**
 * 计费分级。
 *
 * 阈值按**你实际模型的区间**（0.03 ~ 1.83）标定，而非全市场统计 —— 全市场
 * 四分位会把你的模型全塞进同一档，失去区分度。标签用一个字，因为 detail 是
 * 单行 ellipsis 截断的，每个字都要省。
 *
 * @param {number} credits - 计费倍率。
 * @returns {{ id: string, label: string }|null} 分级；非有限数返回 null。
 */
function priceTierOf(credits) {
  if (!Number.isFinite(credits)) return null
  if (credits === 0) return { id: 'free', label: '免' }
  if (credits <= 0.08) return { id: 'cheap', label: '省' }
  if (credits <= 0.3) return { id: 'mid', label: '中' }
  if (credits <= 0.7) return { id: 'high', label: '贵' }
  return { id: 'premium', label: '奢' }
}

/**
 * 能力分级。
 *
 * 同样按你实际命中的区间（IQ 19 ~ 46）标定；OpenRouter 全库是 3.8 ~ 57.6，
 * 用全局四分位会让你几乎所有模型都落进最高档。
 *
 * @param {number} iq - intelligence index。
 * @returns {{ id: string, label: string }|null} 分级；非有限数返回 null。
 */
function iqTierOf(iq) {
  if (!Number.isFinite(iq)) return null
  if (iq >= 43) return { id: 'top', label: '顶' }
  if (iq >= 38) return { id: 'good', label: '优' }
  if (iq >= 30) return { id: 'mid', label: '中' }
  return { id: 'low', label: '弱' }
}

/**
 * 价格/分数缓存的客户端状态。
 *
 * 刻意不阻塞：拉不到就返回 null，模型选择功能完全不受影响。
 */
const pricingState = {
  /** @type {any|null} */
  index: null,
  /** @type {Promise<any>|null} */
  inflight: null,
  /** 最近一次失败时间，用于冷却，避免反复重试打爆宿主。 */
  failedAt: 0,
}

/** 失败后的重试间隔。 */
const RETRY_MS = 5 * 60 * 1000

/**
 * 拉取价格/分数索引（带失败冷却与并发去重）。
 * @returns {Promise<any|null>} 索引；不可用时为 null。
 */
function loadPricing() {
  if (pricingState.index !== null) return Promise.resolve(pricingState.index)
  if (pricingState.inflight !== null) return pricingState.inflight
  if (Date.now() - pricingState.failedAt < RETRY_MS) return Promise.resolve(null)

  pricingState.inflight = (async () => {
    try {
      const response = await fetch(PRICING_ROUTE, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json()
      if (payload?.available !== true) {
        pricingState.failedAt = Date.now()
        return null
      }
      pricingState.index = {
        fetchedAt: payload.fetchedAt,
        local: payload.local ?? {},
        scores: Array.isArray(payload.scores) ? payload.scores : [],
        prices: Array.isArray(payload.prices) ? payload.prices : [],
        notes: Array.isArray(payload.notes) ? payload.notes : [],
        localCount: payload.localCount ?? 0,
        scoreCount: payload.scoreCount ?? 0,
      }
      return pricingState.index
    } catch {
      pricingState.failedAt = Date.now()
      return null
    } finally {
      pricingState.inflight = null
    }
  })()
  return pricingState.inflight
}

/** 一行的 id 编码，与内置选择器同构：`provider/model`。 */
function rowId(providerId, modelId) {
  return `${providerId}/${modelId}`
}

/** 匹配结果缓存：`${缓存版本}|${模型id}` -> 条目或 null。 */
const lookupCache = new Map()

/**
 * 在分数表里按严格规则查一个模型（记忆化）。
 *
 * 分数来自 OpenRouter，id 是规范形式，所以需要 match.js 的严格匹配：
 * 同厂商 + 型号完全相等，绝不做子串匹配（否则 GLM 会匹配到 StepFun）。
 *
 * @param {string} modelId - provider 里的模型 id。
 * @param {any} index - 合并索引。
 * @returns {any|null} 命中的分数条目。
 */
function lookupScore(modelId, index) {
  const scores = index?.scores
  if (!Array.isArray(scores) || scores.length === 0) return null
  const key = `score|${index.fetchedAt ?? ''}|${modelId}`
  if (lookupCache.has(key)) return lookupCache.get(key)
  const hit = matchModel(modelId, scores)
  lookupCache.set(key, hit)
  return hit
}

/**
 * 在 OpenRouter 挂牌价表里按严格规则查一个模型（记忆化）。
 * @param {string} modelId - provider 里的模型 id。
 * @param {any} index - 合并索引。
 * @returns {any|null} 命中的价格条目。
 */
function lookupPrice(modelId, index) {
  const prices = index?.prices
  if (!Array.isArray(prices) || prices.length === 0) return null
  const key = `price|${index.fetchedAt ?? ''}|${modelId}`
  if (lookupCache.has(key)) return lookupCache.get(key)
  const hit = matchModel(modelId, prices)
  lookupCache.set(key, hit)
  return hit
}

/**
 * 编出一条线路的展示事实串。
 *
 * 顺序刻意安排为「越靠前越重要」，因为 detail 是单行 ellipsis 截断的：
 *   上下文 · 计费档+倍率 · 能力档+IQ · 能力警示 · 渠道
 *
 * 缺失的项直接不出现 —— 宁可不显示，也不猜。
 *
 * @param {any} route - 目录条目（一条线路）。
 * @param {any} pricing - 价格缓存（含 local/scores/prices）。
 * @param {(key: string, vars?: any) => string} t - 本地化函数。
 * @param {boolean} showId - 是否显示线路 id（展开态需要，折叠态冗余）。
 * @returns {string} 事实串。
 */
function routeDetail(route, pricing, t, showId) {
  const parts = []
  if (showId) parts.push(route.id)

  const context = formatTokens(route.contextWindow)
  if (context !== '') parts.push(context)

  const index = pricing?.index
  const info = index?.local?.[route.id]

  // 计费：优先本地倍率（你实际被扣的），本地没有才用 OpenRouter 挂牌价兜底。
  const rate = rateText(info, trimNumber)
  if (rate !== '') {
    const tier = priceTierOf(info?.credits)
    parts.push(`${tier === null ? '' : `〔${tier.label}〕`}×${rate}`)
  } else {
    const price = lookupPrice(route.id, index)
    if (price !== null) {
      const input = trimNumber(price.inPerM)
      const output = trimNumber(price.outPerM)
      if (input !== null && output !== null) parts.push(`$${input}/$${output}`)
    }
  }

  // 能力分数：来自 OpenRouter，严格匹配。
  const score = lookupScore(route.id, index)
  if (score !== null) {
    if (Number.isFinite(score.intelligence)) {
      const tier = iqTierOf(score.intelligence)
      parts.push(`${tier === null ? '' : `〔${tier.label}〕`}IQ ${score.intelligence}`)
    } else if (Number.isFinite(score.arenaElo)) {
      parts.push(`Elo ${score.arenaElo}`)
    }
  }

  // 能力警示：只标「异常/关键」的，不标普遍能力（多数模型都支持图像，标了是噪声）。
  if (info?.toolCall === false) parts.push(t('cap.noTools'))
  if (info?.reasoning === false) parts.push(t('cap.noReasoning'))
  if (info?.video === true) parts.push(t('cap.video'))

  // 渠道可读名放最后：最不重要，被截断也不影响判断。
  const channel = channelName(info?.ownedBy)
  if (channel !== '') parts.push(channel)

  return parts.filter((part) => part !== '').join(' · ')
}

/**
 * 生成一行的 badge（上标，独立于 detail，不占宽度）。
 *
 * 承载两类标记：
 *   - `⚠` 该线路不支持工具调用（编码 agent 里基本不可用）；
 *   - `N线` 该模型有多条线路，可用 `/models-all` 展开。
 *
 * @param {object} group - mergeRoutes 产出的模型组。
 * @param {any} pricing - 价格缓存。
 * @param {boolean} showRouteCount - 是否显示线路数（展开态不需要）。
 * @returns {string|undefined} badge 文本。
 */
function badgeOf(group, pricing, showRouteCount) {
  const info = pricing?.index?.local?.[group.defaultRoute?.id]
  const marks = []
  if (info?.toolCall === false) marks.push('⚠')
  if (showRouteCount && group.hasMultiple) marks.push(`${group.routes.length}线`)
  return marks.length === 0 ? undefined : marks.join('')
}

/**
 * 把目录快照摊成带厂商分组的 popup 行。
 *
 * 两级分组：先按厂商（GLM / DeepSeek / …），组内再按模型合并线路。
 *
 * @param {any} snapshot - ModelDirectory 的 store 快照。
 * @param {(key: string, vars?: any) => string} t - 本地化函数。
 * @param {any} pricing - 价格/分数缓存。
 * @param {{ expanded: boolean }} options - 展开态还是折叠态。
 * @returns {Array<any>} popup 选项行。
 */
function optionsOf(snapshot, t, pricing, options) {
  const expanded = options?.expanded === true
  const rows = []

  for (const provider of snapshot.groups ?? []) {
    const groups = mergeRoutes(provider.models ?? [], pricing?.index?.local ?? {})
    // 分类要用**真实的模型 id**，不能用合并键 —— 合并键形如 `zhipu|5-3`，而
    // vendors.js 的规则是按 id 里的特征串（`glm` / `doubao` / `kimi` …）匹配的。
    // 传合并键会让 GLM / 豆包 / MiMo 全部掉进「其他」。
    // 组内所有线路同厂商（identityOf 已保证），所以取第一条的 id 即可代表整组。
    const classified = groups.map((g) => ({ id: g.routes[0]?.id ?? g.key, group: g }))
    for (const vendor of groupByVendor(classified)) {
      for (const wrapped of vendor.models) {
        const group = wrapped.group
        const isCurrent = snapshot.current !== null
          && snapshot.current.provider === provider.id
          && group.routes.some((route) => route.id === snapshot.current.model)

        // 折叠态：只出默认（最省）线路一行。
        // 展开态：默认线路一行，其余线路紧随其后，用 ↳ 表明从属关系。
        const shown = expanded ? group.routes : [group.defaultRoute]

        shown.forEach((route, order) => {
          const isDefault = route.id === group.defaultRoute.id
          // 展开态里非默认线路把 id 放在 label 上（`↳ glm-5.3-solo`），
          // 所以 detail 里不再重复 —— 既不冗余，也把宽度留给价格/分数。
          const detail = routeDetail(route, pricing, t, false)
          // badge 只挂在每个模型的**第一行**（默认线路）上，避免展开态里
          // 每条线路都重复一个 ⚠ / N线。
          const badge = order === 0
            ? badgeOf(group, pricing, !expanded)
            : undefined
          rows.push({
            id: rowId(provider.id, route.id),
            // 展开态的非默认线路加缩进箭头，让「这是同一模型的另一条线」一目了然。
            label: order === 0 ? group.name : `　↳ ${route.id}`,
            detail,
            group: {
              name: `${provider.id}:${vendor.id}`,
              label: `${vendor.label} · ${vendor.models.length}`,
            },
            ...badge === undefined ? {} : { badge },
            ...isCurrent && isDefault ? { active: true } : {},
          })
        })
      }
    }
  }

  // 目录加载失败的 provider 也要可见，否则用户会以为模型凭空消失。
  for (const failure of snapshot.failures ?? []) {
    rows.push({
      id: `failure/${failure.id}`,
      label: failure.name ?? failure.id,
      detail: t('option.loadError', { message: failure.message }),
    })
  }

  // 数据来源脚注：让用户随时知道价格是不是实时的、什么时候抓的。
  rows.push({
    id: 'pricing/footer',
    label: t('footer.source'),
    detail: pricingFooter(pricing, t),
  })
  if (pricing?.index !== null && pricing?.index !== undefined) {
    rows.push({
      id: 'pricing/legend',
      label: t('footer.legendLabel'),
      detail: legendText(t),
    })
  }
  return rows
}

/**
 * 生成价格脚注的文字。
 * @param {{ index: any|null }} pricing - 价格缓存。
 * @param {(key: string, vars?: any) => string} t - 本地化函数。
 * @returns {string} 脚注描述。
 */
function pricingFooter(pricing, t) {
  const index = pricing?.index
  const fetchedAt = index?.fetchedAt
  if (typeof fetchedAt !== 'string') return t('footer.unavailable')
  const at = new Date(fetchedAt)
  if (Number.isNaN(at.getTime())) return t('footer.unavailable')
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
  return t('footer.fetchedAt', {
    at: stamp,
    routes: index.localCount ?? 0,
    scores: index.scoreCount ?? 0,
  })
}

/**
 * 生成分级图例。
 * 分级是自定义阈值，不解释就会被误读。
 * @param {(key: string, vars?: any) => string} t - 本地化函数。
 * @returns {string} 图例文字。
 */
function legendText(t) {
  return t('footer.legend')
}

/**
 * 把一个 popup 行 id 还原成模型选择。
 * @param {any} snapshot - ModelDirectory 的 store 快照。
 * @param {string} id - 被选中的行 id。
 * @returns {any} 选择对象；失败行或过期 id 返回 undefined。
 */
function selectionOf(snapshot, id) {
  for (const provider of snapshot.groups ?? []) {
    for (const model of provider.models ?? []) {
      if (rowId(provider.id, model.id) !== id) continue
      const isCurrent = snapshot.current?.provider === provider.id
        && snapshot.current?.model === model.id
      const reasoningEffort = isCurrent
        ? snapshot.current?.reasoningEffort ?? model.reasoning?.defaultEffort
        : model.reasoning?.defaultEffort
      return {
        provider: provider.id,
        model: model.id,
        ...reasoningEffort === undefined ? {} : { reasoningEffort },
      }
    }
  }
  return undefined
}

/** 本插件的本地化词典。 */
const zh = {
  'command.label': '模型（按厂商分组）',
  'command.description': '选择本会话使用的模型：按厂商分组，同模型的线路已合并，默认取最省',
  'commandAll.label': '模型（全部线路）',
  'commandAll.description': '同上，但展开显示同一模型的每一条转发线路',
  'search.placeholder': '搜索模型',
  'search.empty': '没有匹配的模型',
  'empty.models': '没有可用模型',
  'option.loadError': '加载失败：{message}',
  'cap.noTools': '无工具',
  'cap.noReasoning': '无推理',
  'cap.video': '视频',
  'footer.source': '倍率来自本地端点，分数来自 OpenRouter',
  'footer.fetchedAt': '抓取于 {at} · 线路 {routes} 条 · 分数 {scores} 条',
  'footer.unavailable': '价格数据暂不可用（不影响模型选择）',
  'footer.legendLabel': '分级说明',
  'footer.legend': '计费〔免〕0 ·〔省〕≤0.08 ·〔中〕≤0.3 ·〔贵〕≤0.7 ·〔奢〕>0.7　｜　能力〔顶〕IQ≥43 ·〔优〕≥38 ·〔中〕≥30 ·〔弱〕<30　｜　⚠=该线路无工具调用 · N线=该模型有N条线路（/models-all 展开）',
}

const en = {
  'command.label': 'Models (grouped by vendor)',
  'command.description': 'Pick this conversation\u2019s model, grouped by vendor; routes merged, cheapest by default',
  'commandAll.label': 'Models (all routes)',
  'commandAll.description': 'Same, but expands every forwarding route of each model',
  'search.placeholder': 'Search models',
  'search.empty': 'No matching model',
  'empty.models': 'No models available',
  'option.loadError': 'Failed to load: {message}',
  'cap.noTools': 'no tools',
  'cap.noReasoning': 'no reasoning',
  'cap.video': 'video',
  'footer.source': 'Rate from local endpoint, scores from OpenRouter',
  'footer.fetchedAt': 'Fetched {at} \u00b7 {routes} routes \u00b7 {scores} scores',
  'footer.unavailable': 'Price data unavailable (model selection is unaffected)',
  'footer.legendLabel': 'Tier legend',
  'footer.legend': 'Rate: Free 0 \u00b7 Cheap \u22640.08 \u00b7 Mid \u22640.3 \u00b7 High \u22640.7 \u00b7 Lux >0.7  |  Ability: Top IQ\u226543 \u00b7 Good \u226538 \u00b7 Mid \u226530 \u00b7 Low <30  |  \u26a0=no tool calls \u00b7 N=route count (/models-all)',
}

/**
 * 客户端插件主体：注册词典，然后注册两个命令（折叠 / 展开）。
 * @param {any} ctx - 客户端根上下文。
 */
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-model-groups: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.inject(['commandUi', 'modelDirectories'], (scope) => {
    const command = scope.get('commandUi')
    const models = scope.modelDirectories
    const sessions = scope.sessions

    // 与内置 /model 用同一个可用性判断：定向 subagent 会话不公开模型选择。
    const routable = (session) => sessions.subagentAddress(session.sessionId) === undefined

    /**
     * 注册一个模型命令。
     * @param {string} name - 命令名。
     * @param {boolean} expanded - 是否展开全部线路。
     * @param {string} labelKey - 标题词典键。
     * @param {string} descKey - 描述词典键。
     */
    const register = (name, expanded, labelKey, descKey) => {
      scope.effect(
        () =>
          command.register({
            name,
            label: () => t(labelKey),
            description: () => t(descKey),
            available: (session) => routable(session),
            ui: {
              kind: 'popupSelect',
              searchMode: 'fuzzy-label',
              searchLabels: () => ({
                placeholder: t('search.placeholder'),
                empty: t('empty.models'),
                noResults: t('search.empty'),
              }),
              options: async (session) => {
                if (!routable(session)) {
                  throw new Error('model selection is unavailable for addressed subagent sessions')
                }
                const directory = models.directoryFor(session.sessionId)
                // 价格是装饰性的：拉不到就照常出列表，绝不让它拖垮命令。
                const pricing = await loadPricing()
                return optionsOf(await directory.load(), t, { index: pricing }, { expanded })
              },
              onSelect: async (option, session) => {
                if (!routable(session)) {
                  throw new Error('model selection is unavailable for addressed subagent sessions')
                }
                // 脚注、图例与失败行不是模型，不能提交。
                if (option.id.startsWith('pricing/') || option.id.startsWith('failure/')) return
                const directory = models.directoryFor(session.sessionId)
                const selection = selectionOf(directory.store.getSnapshot(), option.id)
                if (selection === undefined) {
                  throw new Error('this provider\u2019s catalog failed to load \u2014 pick a model from a loaded group')
                }
                const result = await directory.select(selection)
                if (!result.ok) {
                  if (result.error.code === 'session/writer-held') throw new Error(t('error.sessionInUse'))
                  throw result.error
                }
              },
            },
          }),
        `dsh-model-groups: ${name} command`,
      )
    }

    register(COMMAND_MERGED, false, 'command.label', 'command.description')
    register(COMMAND_ALL, true, 'commandAll.label', 'commandAll.description')
  })
}
