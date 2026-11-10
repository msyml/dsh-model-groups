/**
 * dsh-model-groups 的宿主半边。
 *
 * 职责只有一件：把价格/分数索引通过一个只读 HTTP 路由喂给浏览器半边。
 * 浏览器读不了磁盘，所以这一步必须由宿主完成。
 *
 * 设计约束（吸取第一版的教训）：
 *   - **不注册任何服务**，只注册一条路由 —— 不会让别的插件等不到依赖；
 *   - **不在 apply() 里 await 网络 IO**：启动时只读磁盘缓存，抓取放后台，
 *     失败只记日志。数据源挂了也不能影响 DSH 启动；
 *   - 路由失败一律降级为空索引，绝不抛给上层。
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readCache, refresh, DEFAULT_TTL_MS } from './pricing.js'

/** 路由路径。 */
const ROUTE_PATH = '/model-groups/pricing'

/**
 * 宿主半边依赖的服务。
 *
 * **必须声明 `webServer`**：不声明就直接调 `ctx.webServer.register(...)`，
 * Cordis 不会把这个服务注入进来，`ctx.webServer` 为 undefined，路由注册
 * 静默失败 —— 现象是前端拿到 404、脚注显示「数据不可用」，而日志里没有任何
 * 报错。这正是本插件第二版踩的坑。
 *
 * `logger` 不在此列：它是根上下文自带的，且下面用可选链调用。
 */
export const inject = ['webServer']

/**
 * 缓存文件位置：插件包根目录下的 pricing-cache.json。
 * @returns {string} 绝对路径。
 */
function cachePath() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  // lib/index.js -> 包根
  return path.join(here, '..', 'pricing-cache.json')
}

/**
 * 从已加载的 provider 配置里解析出「本地转发端点」。
 *
 * 插件的宿主半边能拿到 `llm` 服务与 settings 文档。这里找 baseURL 指向
 * 回环地址（127.0.0.1 / localhost）的 provider —— 那才是用户自己的转发端点，
 * 它的 /v1/models 带 credits 计费倍率。
 *
 * 找不到就返回空对象，价格源退化为只用 OpenRouter。
 *
 * @param {any} ctx - 宿主根上下文。
 * @returns {{ baseURL?: string, apiKey?: string }} 端点信息。
 */
function localEndpointOf(ctx) {
  // settings 里的 provider 配置是首选来源。
  try {
    const settings = ctx.get?.('settings')
    const described = settings?.describe?.({ redactSecrets: true })
    const namespaces = Array.isArray(described) ? described : []
    for (const ns of namespaces) {
      const providers = ns?.value?.providers
      if (providers === null || typeof providers !== 'object') continue
      for (const profile of Object.values(providers)) {
        const baseURL = profile?.baseURL
        if (typeof baseURL !== 'string' || baseURL === '') continue
        if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(baseURL)) continue
        return {
          baseURL,
          // 凭据可能是 env 引用，这里只做尽力而为的取值。
          ...(typeof profile?.apiKey === 'string' && profile.apiKey !== ''
            ? { apiKey: profile.apiKey }
            : {}),
        }
      }
    }
  } catch {
    // 读配置失败不是致命问题：退化为只用 OpenRouter。
  }
  return {}
}

/**
 * 宿主插件主体。
 * @param {any} ctx - 宿主根上下文。
 */
export function apply(ctx) {
  const target = cachePath()
  /** 内存里的当前索引，路由直接读它。 */
  let current = readCache(target).index

  /** 当前已知的本地端点；可能随后续刷新变化。 */
  const endpoint = localEndpointOf(ctx)

  // 启动时若缓存缺失或过期，后台补一次。刻意不 await：抓取失败绝不能拖住启动。
  void (async () => {
    try {
      const cached = readCache(target)
      if (cached.index === null || cached.stale) {
        current = await refresh(target, endpoint)
        ctx.logger?.info?.(
          `dsh-model-groups: 价格索引已更新（本地线路 ${current.localCount} 条，分数 ${current.scoreCount} 条）`,
        )
      }
    } catch (error) {
      ctx.logger?.warn?.(
        `dsh-model-groups: 价格索引刷新失败，沿用缓存（${error instanceof Error ? error.message : String(error)}）`,
      )
    }
  })()

  // 每隔 TTL 再刷一次，保持数据新鲜。
  const timer = setInterval(() => {
    void (async () => {
      try {
        current = await refresh(target, localEndpointOf(ctx))
      } catch {
        // 静默：定时刷新失败不该刷屏，下次再试。
      }
    })()
  }, DEFAULT_TTL_MS)
  // 不要因为这个定时器让进程无法退出。
  if (typeof timer.unref === 'function') timer.unref()

  ctx.effect(() => () => clearInterval(timer), 'dsh-model-groups: pricing refresh timer')

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_PATH,
        handler: (req, res) => {
          // 只读：其它方法一律拒绝。
          if (req.method !== undefined && req.method !== 'GET' && req.method !== 'HEAD') {
            res.statusCode = 405
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
            return
          }
          // 每次请求都重读磁盘：后台刷新换了文件，前端下次打开就能拿到新的。
          let index = current
          try {
            const onDisk = readCache(target, Number.POSITIVE_INFINITY).index
            if (onDisk !== null) index = onDisk
          } catch {
            // 读盘失败就用内存里的，仍可能为 null。
          }
          const body = JSON.stringify({
            ok: true,
            ...(index === null
              ? { available: false }
              : {
                  available: true,
                  fetchedAt: index.fetchedAt,
                  local: index.local ?? {},
                  scores: index.scores ?? [],
                  prices: index.prices ?? [],
                  notes: index.notes ?? [],
                  localCount: index.localCount ?? 0,
                  scoreCount: index.scoreCount ?? 0,
                }),
          })
          res.statusCode = 200
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.end(body)
        },
      }),
    'dsh-model-groups: pricing route',
  )
}

export { ROUTE_PATH }
