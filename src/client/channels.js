/**
 * 渠道代号 → 可读名称。
 *
 * 端点的 `owned_by` 字段是各家 AI 软件的名称，但用的是代号（小写英文）。
 * 这些是各家的 AI 编程/办公客户端，作为模型的中转渠道出现。
 *
 * 已联网核实的五个（2026-10）：
 *   - trae        字节跳动的 AI 原生 IDE（Trae / The Real AI Engineer），trae.cn / trae.ai
 *   - qoder       阿里巴巴的智能体编程平台，qoder.com / aliyun.com/product/qoder
 *   - workbuddy   腾讯的全场景 AI 办公工作台（桌面 Agent），workbuddy.cn / 腾讯云产品页
 *   - raccoon     商汤科技的「小浣熊 Raccoon」（代码/办公小浣熊），xiaohuanxiong.com
 *                 ——这也解释了该渠道为何全是 `sn-`（SenseNova）前缀的模型
 *   - autoclaw    智谱 AI 的 AutoClaw（中文名「澳龙」，本地版 OpenClaw 客户端），autoclaw.zhipuai.cn
 *
 * 未能核实的一个：
 *   - catpaw      多次中文/英文检索均无对应产品。注意该渠道独家承载 `LongCat-2.0`
 *                 （美团的大模型），但**这只是线索，不足以断定 catpaw 就是美团的工具**，
 *                 所以不写猜测的名字，原样显示代号 + 问号。
 *
 * 表格之外的代号一律原样显示 —— 宁可显示代号，也不编造厂商。
 */

/** 代号 -> 显示名。 */
const CHANNEL_NAMES = {
  trae: 'TRAE·字节',
  qoder: 'Qoder·阿里',
  workbuddy: 'WorkBuddy·腾讯',
  'workbuddy-intl': 'WorkBuddy国际·腾讯',
  raccoon: '小浣熊·商汤',
  autoclaw: 'AutoClaw·智谱',
}

/** 已核实厂商的代号集合（用于决定是否加问号）。 */
const VERIFIED = new Set(Object.keys(CHANNEL_NAMES))

/**
 * 把渠道代号转成展示名。
 *
 * @param {string|undefined} code - 端点的 `owned_by`。
 * @returns {string} 展示名；未知代号原样返回并加 `?` 标记。
 */
export function channelName(code) {
  if (typeof code !== 'string' || code === '') return ''
  const known = CHANNEL_NAMES[code]
  if (known !== undefined) return known
  // 未核实的代号：原样显示 + ?，明确表示「不确定这是什么」。
  return `${code}?`
}

export { CHANNEL_NAMES, VERIFIED }
