/**
 * 厂商 / 模型族归类规则。
 *
 * 模型的 provider 只有一个（本例是转发用的 sk-local），45 个模型全平铺在
 * 一个组里。这里按模型 id 里的厂商特征串把它们再分组，让下拉菜单从一条
 * 长列表变成若干有标题的短列表。
 *
 * 规则按数组顺序求值，先命中者胜出。因此更具体的厂商模式要排在更宽泛的
 * 模式之前 —— 例如 `sn-glm-5-3` 同时含 `sn-`（商汤前缀）与 `glm`，把 GLM
 * 规则放在 SenseNova 之前，它会正确落进 GLM 组。
 */

/** @typedef {{ id: string, label: string, order: number }} ModelVendor */

/** 未命中任何规则的模型归入此组。 */
export const OTHER_VENDOR_ID = '__other__'

/**
 * 规则表：`[匹配模型 id 的正则, 分组 id, 显示名, 排序权重]`。
 *
 * 排序权重决定分组在下拉里的先后：数字越小越靠前，权重相同时按分组 id
 * 稳定排序。把最常用的厂商放在前面，减少日常滚动。
 */
const RULES = [
  [/(?:^|[-_/])deepseek/i, 'deepseek', 'DeepSeek 深度求索', 10],
  [/glm/i, 'glm', 'GLM 智谱', 20],
  [/kimi|moonshot/i, 'kimi', 'Kimi 月之暗面', 30],
  [/qwen|tongyi/i, 'qwen', 'Qwen 通义千问', 40],
  [/doubao|(?:^|[-_/])seed/i, 'doubao', 'Doubao 字节豆包', 50],
  [/minimax/i, 'minimax', 'MiniMax', 60],
  [/mimo/i, 'mimo', 'MiMo 小米', 70],
  [/step/i, 'step', 'Step 阶跃星辰', 80],
  [/sensenova|(?:^|[-_/])sn-/i, 'sensenova', 'SenseNova 商汤', 90],
  [/longcat/i, 'longcat', 'LongCat 美团', 100],
  [/gemini/i, 'gemini', 'Gemini Google', 110],
  [/(?:^|[-_/])hy[\d.]|hunyuan/i, 'hunyuan', 'Hunyuan 腾讯混元', 120],
  [/(?:^|[-_/])auto(?:$|[-_/])/i, 'auto', 'Auto 自动路由', 130],
]

/** 未归类分组。 */
const OTHER = { id: OTHER_VENDOR_ID, label: '其他', order: 900 }

/**
 * 解析一个模型 id 所属的厂商分组。
 * @param {string} modelId - provider 拥有的模型 id。
 * @returns {ModelVendor} 命中的分组，或兜底的「其他」。
 */
export function vendorOf(modelId) {
  const id = String(modelId ?? '')
  for (const [pattern, vendorId, label, order] of RULES) {
    if (pattern.test(id)) return { id: vendorId, label, order }
  }
  return OTHER
}

/**
 * 把一组模型按厂商归类。
 *
 * `models` 保持传入顺序（即 provider 目录顺序），只有分组之间重排。
 *
 * @param {ReadonlyArray<{ id: string }>} models - provider 的模型条目。
 * @returns {Array<{ id: string, label: string, order: number, models: Array<any> }>}
 *   非空分组，按 order 升序。
 */
export function groupByVendor(models) {
  const buckets = new Map()
  for (const model of models ?? []) {
    const vendor = vendorOf(model?.id)
    let bucket = buckets.get(vendor.id)
    if (bucket === undefined) {
      bucket = { ...vendor, models: [] }
      buckets.set(vendor.id, bucket)
    }
    bucket.models.push(model)
  }
  return [...buckets.values()].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id),
  )
}
