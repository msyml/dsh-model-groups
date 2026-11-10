/**
 * 手动刷新价格/分数索引。
 *
 * 用法：
 *   node scripts/refresh-pricing.mjs
 *   node scripts/refresh-pricing.mjs http://127.0.0.1:3065/v1
 *
 * 平时不需要手动跑 —— 插件宿主半边在启动时和每隔 24 小时会自动刷新（它会从
 * 已加载的 provider 配置里自动找到回环地址的端点）。这个脚本用于：
 *   - 首次安装后生成 pricing-cache.json；
 *   - 想让 GUI 立刻拿到最新数据时手动补一次；
 *   - 排查「为什么 GUI 里没有价格」：单独跑一次能看到两个源的原始报错。
 *
 * 退出码：0 成功（至少一个源有数据），1 失败。
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { refresh, OPENROUTER_URL } from '../src/pricing.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const target = path.join(here, '..', 'pricing-cache.json')

// 第一个参数可选：本地转发端点的 baseURL。
const baseURL = process.argv[2] ?? 'http://127.0.0.1:3065/v1'

try {
  const index = await refresh(target, { baseURL })
  console.log(`✅ 已刷新 ${target}`)
  console.log(`   本地端点: ${index.sources.local ?? '(未指定)'}`)
  console.log(`   OpenRouter: ${OPENROUTER_URL}`)
  console.log(`   本地线路条数: ${index.localCount}`)
  console.log(`   分数条数: ${index.scoreCount}`)
  console.log(`   兜底价格条数: ${index.prices.length}`)
  console.log(`   时间: ${index.fetchedAt}`)
  if (index.notes.length > 0) {
    console.log('\n⚠️  抓取告警（对应源的数据未纳入）：')
    for (const note of index.notes) console.log(`   - ${note}`)
  }
  // 两个源都没数据才算失败。
  if (index.localCount === 0 && index.scoreCount === 0) {
    console.error('\n❌ 两个源都没有可用数据')
    process.exit(1)
  }
  process.exit(0)
} catch (error) {
  console.error(`❌ 刷新失败: ${error instanceof Error ? error.message : String(error)}`)
  console.error('   已有的 pricing-cache.json 未被修改。')
  process.exit(1)
}
