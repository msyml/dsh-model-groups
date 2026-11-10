// 严格匹配器：别名 -> OpenRouter 规范模型
//
// 测试暴露的问题：把厂商前缀剥掉后做 startsWith 匹配，会让
//   glm-5.3-flash  (core=5-3-flash) 命中  stepfun/step-5-preview (core=5-preview)
// 展示错误的厂商价格比不显示更糟。因此改为严格规则：
//   1. 必须同厂商（厂商指纹一致）
//   2. 归一化后的型号必须完全相等，或仅在「快照日期后缀」上不同
//   3. 绝不做子串/startsWith 模糊匹配

/** 从 id 里识别厂商指纹；识别不出返回 null（则该模型不参与匹配）。 */
function vendorOf(id) {
  const s = String(id).toLowerCase()
  if (/deepseek/.test(s)) return 'deepseek'
  if (/glm|zhipu|chatglm/.test(s)) return 'zhipu'
  if (/kimi|moonshot/.test(s)) return 'moonshot'
  if (/qwen|tongyi/.test(s)) return 'qwen'
  if (/doubao|(^|[-_/])seed/.test(s)) return 'bytedance'
  if (/minimax/.test(s)) return 'minimax'
  if (/mimo/.test(s)) return 'xiaomi'
  if (/step/.test(s)) return 'stepfun'
  if (/sensenova/.test(s)) return 'sensenova'
  if (/longcat/.test(s)) return 'meituan'
  if (/gemini/.test(s)) return 'google'
  if (/(^|[-_/])hy[\d.]|hunyuan/.test(s)) return 'tencent'
  if (/claude/.test(s)) return 'anthropic'
  if (/gpt|openai/.test(s)) return 'openai'
  return null
}

/**
 * 去掉转发后缀、provider 段与厂商前缀，得到可比对的型号核心。
 *
 * 顺序很重要：OpenRouter 的 id 形如 `deepseek/deepseek-v4.1-flash`，
 * 厂商名出现两次（一次作 provider 段、一次作 id 前缀），所以必须先按 `/`
 * 取末段，再循环剥厂商前缀，直到不再变化。
 */
function coreOf(id) {
  let s = String(id).toLowerCase().trim()
  s = s.replace(/^~/, '')                    // `~vendor/model-latest` 别名前缀
  s = s.replace(/:.*$/, '')                  // `:batch` / `:free` 变体后缀
  s = s.replace(/^custom_model_/, '')
  // 转发层后缀：-solo / -sg / -official 等，可能叠加
  let prev
  do {
    prev = s
    s = s.replace(/-(solo|sg|official)$/, '')
  } while (s !== prev)
  s = s.replace(/[._]/g, '-')
  // 版本号可能紧贴厂商名：`qwen3.7-plus` 归一为 `qwen-3-7-plus`。这一步必须在
  // 剥厂商前缀**之前**做，否则 `qwen3-7-plus` 不匹配 `^qwen-`、前缀留下，
  // 与别名的 `3-7-plus` 对不上。
  s = s.replace(/([a-z])(?=\d)/g, '$1-')
  s = s.replace(/-+/g, '-')
  // provider 段：只保留最后一段（`deepseek/deepseek-v4.1-flash` -> `deepseek-v4.1-flash`）
  const slash = s.lastIndexOf('/')
  if (slash !== -1) s = s.slice(slash + 1)
  // 厂商前缀可以出现多次，循环剥净
  const VENDOR_PREFIX = /^(deepseek|glm|zhipu|chatglm|z-ai|kimi|moonshotai|moonshot|qwen|doubao|minimax|mimo|stepfun|step|sensenova|sn|longcat|gemini|hunyuan|claude|gpt|openai)-/
  do {
    prev = s
    s = s.replace(VENDOR_PREFIX, '')
  } while (s !== prev)
  s = s.replace(/-+/g, '-').replace(/^-|-$/g, '')
  return s
}

/** 去掉尾部快照日期，如 -0902 / -0813 / -20260910，便于同日期的不同快照互认。 */
function stripSnapshot(s) {
  return s.replace(/-\d{8}$/, '').replace(/-\d{4}$/, '')
}

/**
 * 严格匹配一个转发别名到候选集合。
 * @param {string} alias - provider 里的模型 id
 * @param {Array<{id: string}>} candidates - OpenRouter 模型列表
 * @returns {any|null} 唯一匹配；0 个或多个都返回 null（宁缺勿错）
 */
export function matchModel(alias, candidates) {
  const vendor = vendorOf(alias)
  if (vendor === null) return null
  const wanted = stripSnapshot(coreOf(alias))

  const hits = []
  for (const cand of candidates) {
    if (vendorOf(cand.id) !== vendor) continue
    const core = stripSnapshot(coreOf(cand.id))
    if (core === wanted) hits.push(cand)
  }
  if (hits.length === 0) return null
  // 多个命中（例如 :batch / :free 变体）时取「无变体后缀」的那个
  const plain = hits.filter((h) => !String(h.id).includes(':'))
  return plain.length > 0 ? plain[0] : hits[0]
}

export const __test__ = { vendorOf, coreOf, stripSnapshot }

// 分组也复用这两个函数：同一模型的各条转发线路 id 写法不同（点/横线、
// `sn-` 前缀），但「厂商 + 型号核心」是一致的。routes.js 借此把它们并成一组。
export { vendorOf, coreOf, stripSnapshot }
