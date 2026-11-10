window.__ModuleLoader__.load({
	id: "dsh-model-groups",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });


		// ── vendors.js ─────────────────────────────────────────────
		const __vendors = (() => {
			var exports = {};
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
	const OTHER_VENDOR_ID = '__other__'

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
	function vendorOf(modelId) {
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
	function groupByVendor(models) {
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

			exports.OTHER_VENDOR_ID = OTHER_VENDOR_ID;
			exports.vendorOf = vendorOf;
			exports.groupByVendor = groupByVendor;
			return exports;
		})();

		// ── match.js ─────────────────────────────────────────────
		const __match = (() => {
			var exports = {};
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
	function matchModel(alias, candidates) {
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

	const __test__ = { vendorOf, coreOf, stripSnapshot }

	// 分组也复用这两个函数：同一模型的各条转发线路 id 写法不同（点/横线、
	// `sn-` 前缀），但「厂商 + 型号核心」是一致的。routes.js 借此把它们并成一组。

			exports.vendorOf = vendorOf;
			exports.coreOf = coreOf;
			exports.stripSnapshot = stripSnapshot;
			exports.matchModel = matchModel;
			exports.__test__ = __test__;
			return exports;
		})();

		// ── routes.js ─────────────────────────────────────────────
		const __routes = (() => {
			var exports = {};
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

	const { vendorOf, coreOf } = __match;
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
	function identityOf(model) {
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
	function bestName(routes) {
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
	function supportsTools(info) {
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
	function sortRoutes(routes, local) {
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
	function mergeRoutes(models, local) {
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
	function rateText(info, formatNumber) {
	  if (info === undefined) return ''
	  if (Number.isFinite(info.credits)) return formatNumber(info.credits)
	  // 「低」「中」这类定性描述原样返回，不当数字。
	  if (typeof info.raw === 'string' && /^[^\dx]/i.test(info.raw)) return info.raw
	  return ''
	}

			exports.identityOf = identityOf;
			exports.bestName = bestName;
			exports.supportsTools = supportsTools;
			exports.sortRoutes = sortRoutes;
			exports.mergeRoutes = mergeRoutes;
			exports.rateText = rateText;
			return exports;
		})();

		// ── channels.js ─────────────────────────────────────────────
		const __channels = (() => {
			var exports = {};
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
	function channelName(code) {
	  if (typeof code !== 'string' || code === '') return ''
	  const known = CHANNEL_NAMES[code]
	  if (known !== undefined) return known
	  // 未核实的代号：原样显示 + ?，明确表示「不确定这是什么」。
	  return `${code}?`
	}


			exports.CHANNEL_NAMES = CHANNEL_NAMES;
			exports.VERIFIED = VERIFIED;
			exports.channelName = channelName;
			return exports;
		})();

		// ── index.js ─────────────────────────────────────────────
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
		
		const { groupByVendor } = __vendors;
		const { matchModel } = __match;
		const { mergeRoutes, rateText } = __routes;
		const { channelName } = __channels;
		/** 交互所需的客户端服务 —— 全部由内置插件提供，不禁用任何行。 */
		const inject = ['commandUi', 'locale', 'modelDirectories', 'sessions']
		
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
		function apply(ctx) {
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
		
				exports.inject = inject;
				exports.apply = apply;

		return module.exports;
	}
});
