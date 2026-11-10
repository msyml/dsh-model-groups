# dsh-model-groups

按厂商分组、按转发线路合并的模型选择命令。用于 DSH Web GUI。

## 它解决什么问题

DSH 的模型目录只按 **provider** 分组。你在这一个 provider 下配了 45 个模型，
但它们其实是同一个模型的**多条转发线路**，价格差最高 8.33 倍：

| 模型 | 线路（倍率 / 渠道） | 价差 |
|---|---|---|
| DeepSeek-V4.1-Flash | ×0.03 腾讯国际 · ×0.08 字节 · ×0.11 腾讯 · ×0.25 商汤 ×2 | **8.33×** |
| GLM-5.3-Flash | ×0.06 catpaw · ×0.06 字节 · ×0.20 商汤 ×2 | **3.33×** |
| DeepSeek-V4-Flash | ×0.03 catpaw · ×0.10 字节 | **3.33×** |
| Kimi-K3 | ×0.94 catpaw · ×1.00 商汤 · ×1.83 字节 | **1.95×** |
| GLM-5.3 | ×0.44 catpaw · ×0.75 商汤 ×2 · ×0.78 字节 | **1.77×** |

平铺展示时它们彼此无关，随手选到贵的那条纯属运气。**8 组模型平均价差 2.90×。**

本插件把它们按模型聚拢、默认取最省，并给出价格分级与能力分级。

## 使用

| 命令 | 行为 |
|---|---|
| `/models` | **折叠态**，每个模型一行，默认取最省线路。27 行 |
| `/models-all` | **展开态**，列出每一条线路，从属关系用 `↳` 标出。45 行 |

折叠态实际长这样：

```
▸ GLM 智谱 · 4
   GLM-5.3           1M · 〔贵〕×0.440 · 〔顶〕IQ 44.8 · catpaw?        ⟨4线⟩
   GLM-5.3-Flash     1M · 〔省〕×0.060 · 〔优〕IQ 41.8 · 视频 · catpaw?  ⟨4线⟩
   GLM-5.3-FlashX    1M · 〔中〕×0.160 · catpaw?                        ⟨2线⟩
   GLM-5.2           1M · 〔奢〕×0.780 · 〔中〕IQ 33.7 · TRAE·字节
▸ SenseNova 商汤 · 2
   SenseNova-6.8-Flash  1M · 〔免〕×0 · 无工具 · 小浣熊·商汤            ⟨⚠2线⟩
```

展开态（`/models-all`）里同一模型的线路聚在一起：

```
▸ GLM-5.3 ●
    1M · 〔贵〕×0.440 · 〔顶〕IQ 44.8 · catpaw?
    　↳ glm-5.3-solo
        1M · 〔奢〕×0.780 · 〔顶〕IQ 44.8 · TRAE·字节
    　↳ glm-5-3
        1M · 〔奢〕×0.750 · 〔顶〕IQ 44.8 · 无工具 · 小浣熊·商汤
```

内置的 `/model` 与 composer 模型位**完全不受影响**。本插件是增量入口。

> 命令名不叫 `model`：已被内置插件占用，重名会注册冲突。

## 标记说明

### 上标 badge（独立文本位，不占 detail 宽度）

| 标记 | 含义 |
|---|---|
| `⚠` | 该线路**不支持工具调用** —— 编码 agent 里基本不可用 |
| `N线` | 该模型有 N 条线路，用 `/models-all` 展开 |

### detail 里的分级

**计费**（阈值按你实际模型的区间 0.03~1.83 标定，非全市场统计）：

| 标记 | 条件 |
|---|---|
| 〔免〕 | `= 0` |
| 〔省〕 | `≤ 0.08` |
| 〔中〕 | `≤ 0.3` |
| 〔贵〕 | `≤ 0.7` |
| 〔奢〕 | `> 0.7` |

**能力**（阈值按你实际命中的 IQ 19~46 标定）：

| 标记 | 条件 |
|---|---|
| 〔顶〕 | `IQ ≥ 43` |
| 〔优〕 | `≥ 38` |
| 〔中〕 | `≥ 30` |
| 〔弱〕 | `< 30` |

> **为什么不用全市场分位**：OpenRouter 全库 IQ 是 3.8~57.6，用全局四分位
> （10/20/31）会把你几乎所有模型塞进最高档，分级失去意义。

### 能力警示

只标**异常/关键**的，不标普遍能力（29/43 支持图像，标了是噪声）：

| 标记 | 含义 |
|---|---|
| `无工具` | `supports_tool_call === false` —— **重要**，见下 |
| `无推理` | `supports_reasoning === false`（仅 2 个） |
| `视频` | `supports_video === true`（仅 4 个，罕见能力值得标） |

## ⚠️ 11 个模型不能调用工具

端点自己声明 `supports_tool_call: false` 的模型，**全部来自商汤渠道**：

```
glm-5-3  glm-5-3-flash  sn-glm-5-3  sn-glm-5-3-flash
sn-kimi-k3  sn-deepseek-v4-1-flash  deepseek-v4-1-flash
sn-sensenova-6-8-flash(-lite)  sensenova-6-8-flash(-lite)
```

在编码 agent 里这基本等于不可用。本插件：

1. 用 `⚠` badge 与 `无工具` 文字标出；
2. **默认线路优先选支持工具调用的那条**，再在其中取最省。

第 2 点是刻意偏离「无脑取最省」的：既然不能调工具的模型干不了活，把它选成默认
等于害你。实测在你的数据上商汤线路恰好也更贵（商汤 ×0.75 vs catpaw ×0.44），
两种规则结论一致；`GLM-5-3` 这种**全组都不能调工具**的，则退回取最省并打 `⚠`。

## 数据来源

### 源 A：本地转发端点的 `/v1/models`（首选）

```json
{"id":"glm-5.3","credits":"x0.44 credits","owned_by":"catpaw",
 "supports_tool_call":true,"supports_reasoning":true,"supports_video":false,
 "max_input_tokens":1000000,"max_output_tokens":100000}
```

`credits` 是**你这条转发线路的实际计费倍率**，比任何外部挂牌价都贴近真实成本，
所以优先显示为 `×0.44`。它以 provider 里的模型 id 为键，是**精确匹配**。

`parseCredits` 刻意保守：实测形态有 `x0.44` / `x0.44 credits` / `x0` /
`x0.00 credits` / `低` / `中` / 空串。只有能解析成数字的才当价格；`低`/`中`
**原样显示**，不臆测成数字；空值退回源 B。

### 源 B：OpenRouter 的 `/api/v1/models`（补充分数）

| 字段 | 展示为 |
|---|---|
| `artificial_analysis.intelligence_index` | `IQ 44.8` |
| `design_arena[].elo` | 无 IQ 时回退 `Elo 1184` |
| `pricing.*` | 源 A 无倍率时的兜底 `$0.079/$4.80` |

两个源**独立抓取**：任一失败都保留另一个的结果（`notes` 字段记录告警）。

### 刷新

宿主半边启动时检查缓存，过期（默认 **24 小时**）就后台重抓；之后每 24 小时再刷。
**无需配置计划任务。** 手动刷新：

```bash
node scripts/refresh-pricing.mjs
```

抓取失败不影响任何功能：沿用旧缓存，GUI 照常工作。

### 价格的含义

**显示的是你这条转发线路的计费倍率，不是美元账单。** 它用于横向比较模型贵不贵。
（本地无倍率时显示的 `$x/$y` 才是 OpenRouter 挂牌价。）

## 多模态：让 DSH 接受粘贴的图片

**DSH 本身早就支持粘贴图片**（composer 的 Ctrl+V、拖放、上传、附件栏、灯箱都在
`dsh-client-ui-conversation` / `dsh-attachment` / `dsh-client-ui-attachment` 里，
不需要任何插件）。但图片会被**准入阶段直接拒绝**：

```
Model "deepseek-v4-1-flash" does not support image input.
(reason: MODEL_DOES_NOT_SUPPORT_IMAGES)
```

原因在 `dsh-llm-pi-ai` 的模型解析：模型条目没写 `input` 时套用
`defaultInput = ['text']`。本地转发端点不在 pi-ai 内置 catalog 里，45 条模型全是
手写在 `cordis.patch.yml` 的，因此**没有一行带 `input`** —— 图片一律被拒。

修法是给能看图的线路补一行声明：

```yaml
- id: deepseek-v4-1-flash
  input: [text, image]      # ← 补这一行
  name: Deepseek-V4.1-Flash
  contextWindow: 1000000
  maxTokens: 128000
```

### 为什么必须实测，不能直接抄端点的 `supports_images`

**端点会少报，偶尔也会多报。** 2026-10-15 实测 45 条线路：

| 模型 id | 端点声明 | 实测 |
|---|---|---|
| `deepseek-v4.1-flash` | true | ✅ 能看 |
| `deepseek-v4-1-flash`（默认模型） | **false** | ✅ **能看**（少报） |
| `sn-deepseek-v4-1-flash` | false | ✅ 能看（少报） |
| `glm-5-3-flash` / `glm-5-3-flash-solo` | false | ✅ 能看（少报） |
| `sensenova-6-8-flash(-lite)` | false | ✅ 能看（少报） |
| `sn-glm-5-3` | **true** | ❌ **看不见**（多报） |
| `glm-5.3` / `glm-5-3` / `deepseek-v4-flash` / `deepseek-v4-pro` | false | ❌ 看不见 |

结论：**以实测为准**，端点元数据只在探测失败时兜底。最终 33 条能看图（全部保留）、
12 条不能或无法确认（已用 `--prune` 删除）。

> 反过来「全声明成能看图」是危险的：pi-ai 源码注释说得很明白 —— 过度声明会把图片
> 放进**已经落盘**的消息里，之后每一轮都重发一次注定失败的请求。

### 用法

```bash
node scripts/sync-modalities.mjs --probe            # 实测 45 条线路并写回 patch
node scripts/sync-modalities.mjs --check --probe    # 只看差异
node scripts/sync-modalities.mjs                    # 用缓存，不重新实测
node scripts/sync-modalities.mjs --probe --prune    # 顺带删掉不能看图的线路
```

`--prune` = **只留多模态**：判定不是「能看图」的线路整条删除，模型选择器里就只剩
能看图的模型（判定未知的也删，`auto`/`auto-fast` 这类端点上已 404 的正在此列）。
删到仍被 `model:` 引用的 id 时脚本会拒绝执行，除非加 `--force`。

> 注意：删掉的模型 id 若被某个历史会话记为「当前模型」，那个会话再打开时需要重选
> 模型。脚本只做静态引用检查（配置文件里的 `model:`），管不到会话状态 ——
> 可以这样查：
>
> ```powershell
> Select-String -Path "$env:USERPROFILE\.dsh\storages\session_projcache\sessions\*.json" -Pattern '"model"\s*:\s*"<模型id>"'
> ```

- 判定是三态的：`yes` / `no` / `unknown`。**空回答、被截断、上游 502 一律算
  unknown**，退回端点元数据 —— 把「没答上来」当成「看不见」会把能看图的模型弄瞎。
- 探测图是 `scripts/vision-probe.png`（`DSH-8341` + 红圆 + 蓝方）。判别串必须让
  纯文本模型猜不到，所以用它而不是「红/蓝」这类可猜的答案。
- 只改 `input:` 行，patch 里的注释与其它内容原样保留；比较走行级定位，不做 YAML
  回写（回写会吃掉注释）。写回前自动备份 `.bak-modalities-<时间戳>`。
- 实测结果缓存到 `modalities-cache.json`，带端点 URL；端点换了缓存自动失效。

**改完立即生效**：`dsh-hmr` 监听 profile 的 `cordis.patch.yml`，pi-ai 适配器每次
请求都重读当前 profile，所以不需要重启 DSH。

### 排查

三者是**不同的检查**，别混为一谈：

| 现象 | 含义 | 检查 |
|---|---|---|
| `read_image` 报 `does not declare image input` | 当前模型没声明 `input` | 本脚本 |
| 贴图后提示「模型不支持图片」 | 同上，只是发生在 prompt 准入 | 本脚本 |
| 模型收到图但说「不支持的图片」 | 端点/上游确实不支持该线路 | `--probe` |

## 渠道代号 → 可读名

端点的 `owned_by` 是各家 AI 软件的名称。已联网核实的（2026-10）：

| 代号 | 名称 | 出处 |
|---|---|---|
| `trae` | TRAE·字节 | 字节跳动的 AI 原生 IDE，trae.cn / trae.ai |
| `qoder` | Qoder·阿里 | 阿里巴巴智能体编程平台，qoder.com、阿里云产品页 |
| `workbuddy` | WorkBuddy·腾讯 | 腾讯全场景 AI 办公工作台（桌面 Agent），workbuddy.cn |
| `workbuddy-intl` | WorkBuddy国际·腾讯 | 同上国际版 |
| `raccoon` | 小浣熊·商汤 | 商汤「小浣熊 Raccoon」，xiaohuanxiong.com。**这解释了该渠道为何全是 `sn-`（SenseNova）前缀** |
| `autoclaw` | AutoClaw·智谱 | 智谱 AI 的 AutoClaw「澳龙」（本地版 OpenClaw 客户端），autoclaw.zhipuai.cn |

**未能核实**：`catpaw`。中英文检索 6 次均无对应产品。注意该渠道独家承载
`LongCat-2.0`（美团的大模型），但**这只是线索，不足以断定 catpaw 是美团的工具**。
因此原样显示为 `catpaw?` —— 问号明确表示「不确定这是什么」，而不是编一个厂商名。
表格之外的代号同样原样显示 + `?`。

## 实现约束（决定了设计取舍）

popupSelect 的选项只有这些字段：`id` / `label` / `detail` / `group` / `badge` /
`active`。由此带来三条硬约束：

1. **`detail` 与 `label` 都是纯字符串**，类名是构建时哈希的（`EhuiKa_detail`），
   插不进彩色 span → 所以用**文字分级标记**代替颜色。
2. **`badge` 是独立的第二文本位**（上标 `<sup>`，8px），不占 detail 宽度 →
   用它承载 `⚠` 与 `N线`，零宽度成本。
3. **弹窗是扁平列表，没有展开/子菜单机制**，选项在打开时一次性算好 →
   「行内展开」做不到，于是拆成 `/models` 与 `/models-all` 两个命令。

`detail` 是单行 `text-overflow: ellipsis`，所以顺序按「越靠前越重要」排：
`上下文 · 计费 · 能力 · 警示 · 渠道`，渠道最不重要、放最后，被截断也不影响判断。
折叠态去掉了冗余的模型 id（label 已有名字），省约 23 字符宽。

## 模型身份的判定

用**厂商 + 型号核心**（`match.js` 的严格归一化），而不是目录里的 `name`。

`name` 不可靠 —— 配置里有的写规范名、有的照抄 id，于是同一个模型被拆成多行：

| 分组键 | 组数 |
|---|---|
| 按目录 `name` | 32 |
| 按 `vendor+core` | **27** |

被 `name` 拆开、其实同源的例子：`glm-5-3`(×0.75) 与 `glm-5.3`(×0.44)、
`glm-5-3-flash`(×0.2) 与 `glm-5.3-flash`(×0.06)、`deepseek-v4.1-flash`(×0.11)
与 `deepseek-v4-1-flash`(×0.25)、`sensenova-6.8-flash` 与 `sensenova-6-8-flash`。

不合并它们，就等于把「同一模型的更贵线路」伪装成另一个模型推荐给你。

**安全性**：`coreOf` 会剥掉厂商前缀，单用它会误并（开发中曾把 `glm-5.3-flash`
匹配到 `stepfun/step-5-preview`，那会把 GLM 标成 StepFun 的价格）。所以要求
**厂商指纹也必须相同**。厂商识别不出时退回按 `name` 分组。

> 顺带一提：这个判定同时也用于「厂商分组」。分类必须传**真实模型 id**，
> 不能传合并键（`zhipu|5-3`）—— 否则 GLM / 豆包 / MiMo 会全部掉进「其他」。

## 崩溃史与教训（务必先读）

### 坑一：禁用内置插件 → Web 端无法启动

第一版试图接管 composer 的 `conversation.input.model` 席位。那是 single slot，
被内置的 `@deepseek-ai/dsh-client-ui-model-selection` 占用，于是第一版禁用了它。
但 `modelDirectories` 服务**正是那个插件提供的**，禁用等于抽掉自己依赖的服务：

```
Error: web boot: 1 entry did not activate
dsh-model-groups: pending (waiting for service: modelDirectories)
```

现在：不碰任何席位、不禁用任何插件、不注册服务。

### 坑二：宿主半边未声明 `inject` → 路由静默 404

宿主半边调用了 `ctx.webServer.register(...)`，却没有
`export const inject = ['webServer']`。Cordis 不注入未声明的服务，
`ctx.webServer` 为 undefined，**静默失败** —— 不抛异常、不打日志，
只是那条路由不存在。

诊断方法：直接探测路由。

```powershell
Invoke-WebRequest http://127.0.0.1:19387/model-groups/pricing
# 404 = 宿主没注册成功，而不是数据抓取失败
```

### 坑三：本地模块互相 import → 打包残留 `require("./match.js")`

构建脚本只在**入口**文件里改写相对 import，漏了本地模块之间的引用
（`routes.js` → `match.js`），于是包里留下 `require("./match.js")`，加载即抛。

现在构建脚本对每个模块都改写，并**在构建期断言**包里不得残留相对模块的
`require`，再犯会直接让构建失败。

## 安装

`lib/` 已随仓库提供构建产物，**装到别的机器不需要构建**，只要有 Node ≥ 20。

### 方式 A：一键脚本（推荐，跨机器迁移用这个）

```powershell
# 下载仓库后，在仓库目录里执行
powershell.exe -ExecutionPolicy Bypass -File .\install.ps1
```

脚本会依次完成：克隆到 `vendor/` → 登记 `package.json` 两处 → `pnpm install` → 自检。
改动前自动备份 `package.json`，**重复执行是幂等的**（无改动时不写盘、不堆备份）。

可选参数：

| 参数 | 默认 | 说明 |
|---|---|---|
| `-Profile` | `desktop` | profile 名。DSH Desktop 用的就是它 |
| `-DshHome` | `$env:USERPROFILE\.dsh` | DSH 家目录 |
| `-Repo` | 本仓库地址 | 换 fork 时用 |
| `-Ref` | `main` | 分支或 tag |
| `-SkipInstall` | 关 | 只放文件与改配置，不跑 `pnpm install` |

### 方式 B：手工三步

```powershell
# 1. 克隆到 profile 的 vendor 目录
$profile = "$env:USERPROFILE\.dsh\profiles\desktop"
git clone https://github.com/msyml/dsh-model-groups.git "$profile\vendor\dsh-model-groups"

# 2. 登记 package.json 两处（用仓库自带的 Node 脚本，见下方「为什么不用手改」）
node "$profile\vendor\dsh-model-groups\scripts\register.mjs" $profile

# 3. 装进 node_modules
cd $profile
pnpm install
```

也可以完全手工改 `package.json`，**两处都要加**：

```jsonc
{
  "dependencies": {
    "dsh-model-groups": "file:./vendor/dsh-model-groups"
  },
  "dsh": {
    "profile": {
      "bundles": [
        // ...原有项
        "dsh-model-groups"
      ]
    }
  }
}
```

`pnpm install` 之后 `node_modules/dsh-model-groups` 会出现（`nodeLinker: hoisted`
下是实体目录拷贝，不是符号链接）。然后**完全退出 DSH 再启动**。

### 为什么不用 PowerShell 手改 package.json

两个实测踩到的坑：

1. **`Set-Content -Encoding UTF8` 在 Windows PowerShell 5.1 下写 BOM。**
   pnpm / Volta 解析带 BOM 的 `package.json` 直接报
   `Could not parse project manifest`，安装失败。DSH 自己的 `package.json` 是无 BOM 的。
2. **`ConvertTo-Json` 会重排整个文件**（2 空格缩进变 4 空格），
   制造与本次改动无关的巨大 diff。

所以仓库提供 `scripts/register.mjs`：按二进制读、探测原缩进与换行、做最小改写、
显式不带 BOM 写回；原文件带 BOM 时顺手去掉。它也可以单独用来检查现状：

```powershell
node scripts/register.mjs "$env:USERPROFILE\.dsh\profiles\desktop" --check
```

### 方式 C：手工放包

1. 把包放到 `$DSH_HOME/profiles/<profile>/node_modules/dsh-model-groups/`
2. 在 profile 的 `package.json` 里登记 `dependencies` 与 `dsh.profile.bundles`
3. 重启 DSH

### 所有方式都要注意

**不要**在 `cordis.patch.yml` 里禁用任何行。包内自带的 `cordis.patch.yml` 会被
DSH 当作 profile bundle 层自动应用，它只做一件事：`insert` 一条 `id: model-groups`
的插件行。**profile 自己的 `cordis.patch.yml` 不需要改**。

### 迁移到另一台机器时的差异点

| 项目 | 说明 |
|---|---|
| `lib/` 构建产物 | 已入库，无需在目标机构建 |
| `pricing-cache.json` | **不入库**。目标机首次启动时按它自己的转发端点自动重建；缺失时 `readCache` 返回 `index: null`，插件退化为「无倍率」而不是崩溃 |
| 本地转发端点 | 宿主半边自动从 settings 里找 `baseURL` 指向回环地址的 provider。找不到就退化为只用 OpenRouter（有价格分数、没有倍率） |
| `modalities-cache.json` | 仅 `scripts/sync-modalities.mjs --probe` 用，运行时不读 |
| 插件自身的 `package.json` | `dependencies` 为空，`peerDependencies` 由 DSH 运行时提供，无需安装 |
| pnpm | 目标机没有 pnpm 也能装：脚本会优先用 DSH 自带的那套（`resources\runtime\primary-runtime\dependencies\` 下的 node + pnpm） |

### 装完怎么验证

```powershell
# 1. 宿主路由是否注册（端口换成你的 GUI 端口）
Invoke-WebRequest http://127.0.0.1:64288/model-groups/pricing -UseBasicParsing
# 返回 JSON 且 available:true = 宿主半边活着；404 = 宿主没挂上
```

2. 在对话输入框敲 `/models`（折叠态）和 `/models-all`（展开态）
3. 命令没出现时按顺序查：
   - 启动日志里搜 `dsh-model-groups`，出现 `pending (waiting for service: ...)`
     说明内置 `ui-model-selection` 缺失（它提供 `modelDirectories` 服务）
   - `package.json` 的 `dependencies` 和 `dsh.profile.bundles` **两处**都要有它
   - 客户端半边打包在渲染进程里，必须**完全退出** DSH 再启动，热重载不一定覆盖

## 卸载

1. 从 `package.json` 的 `dependencies` **和** `dsh.profile.bundles` 删掉
   `dsh-model-groups`（**两处都要删**，只删一处会留下悬空引用）
2. 删除 `node_modules/dsh-model-groups`
3. 重启 DSH

`cordis.patch.yml` 无需改动。

## 构建

```bash
node scripts/build.mjs            # 构建 lib/
node scripts/refresh-pricing.mjs  # 手动刷新价格缓存
node scripts/sync-modalities.mjs --probe   # 实测看图能力并写回 cordis.patch.yml
```

构建脚本把 ESM 源码包装成 DSH 客户端插件的模块格式
（`window.__ModuleLoader__.load({ id, factory })`）。客户端**运行时零依赖** ——
不 require 任何外部模块，因此不存在「等待某个服务」而挂起的可能。

源码结构：

| 文件 | 职责 |
|---|---|
| `src/client/index.js` | 命令注册与行渲染 |
| `src/client/routes.js` | 线路合并、排序、选默认（纯函数） |
| `src/client/match.js` | 与 OpenRouter 的严格匹配 + 型号归一化（纯函数） |
| `src/client/vendors.js` | 厂商分组规则（纯函数） |
| `src/client/channels.js` | 渠道代号 → 可读名 |
| `src/pricing.js` | 两个数据源的抓取与缓存 |
| `src/index.js` | 宿主半边：只读路由 |
| `scripts/sync-modalities.mjs` | 实测看图能力 → 写回 `cordis.patch.yml` 的 `input:` 声明 |
