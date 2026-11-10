# 在新机器上安装 dsh-model-groups（/models 命令）
#
# 用法（目标机 PowerShell，不需要管理员）：
#   powershell.exe -ExecutionPolicy Bypass -File .\install.ps1
#
# 可选参数：
#   -Profile    profile 名，默认 desktop（DSH Desktop 用的就是它）
#   -DshHome    DSH 家目录，默认 $env:USERPROFILE\.dsh
#   -Repo       Git 仓库地址
#   -Ref        分支或 tag，默认 main
#   -SkipInstall  只放文件与改配置，不跑 pnpm install
#
# 脚本做四件事：
#   1. git clone 到 <profile>/vendor/dsh-model-groups
#   2. 用 scripts/register.mjs 在 package.json 里登记两处（保留原格式、不写 BOM）
#   3. pnpm install，让包进 node_modules
#   4. 自检
#
# 改动前自动备份 package.json，重复执行幂等。

[CmdletBinding()]
param(
  [string]$Profile = 'desktop',
  [string]$DshHome = (Join-Path $env:USERPROFILE '.dsh'),
  [string]$Repo = 'https://github.com/msyml/dsh-model-groups.git',
  [string]$Ref = 'main',
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'

function Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  [OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [!!] $m" -ForegroundColor Yellow }

# ── 定位 node 与 pnpm ─────────────────────────────────────────────────────
# DSH 自带一套 node + pnpm，目标机不一定装了。优先用系统 node（脚本要用），
# 装依赖时优先用 DSH 自己的 pnpm（版本与 profile 匹配）。
function Find-DshRuntime {
  $bases = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime'),
    (Join-Path $env:ProgramFiles 'DeepSeek Harness\resources\runtime'),
    (Join-Path ${env:ProgramFiles(x86)} 'DeepSeek Harness\resources\runtime')
  )
  foreach ($b in $bases) {
    if (-not (Test-Path $b)) { continue }
    $node = Join-Path $b 'primary-runtime\dependencies\node\bin\node.exe'
    $pnpm = Join-Path $b 'primary-runtime\dependencies\pnpm\bin\pnpm.cjs'
    if ((Test-Path $node) -and (Test-Path $pnpm)) {
      return [pscustomobject]@{ Node = $node; Pnpm = $pnpm }
    }
  }
  return $null
}

Step '前置检查'

$dshRt = Find-DshRuntime
if ($dshRt) { Ok "DSH 自带运行时：node $(& $dshRt.Node --version)，pnpm $(& $dshRt.Node $dshRt.Pnpm --version)" }
else { Warn '未找到 DSH 自带运行时，将依赖系统 node/pnpm' }

$nodeExe = $null
if (Get-Command node -ErrorAction SilentlyContinue) { $nodeExe = 'node'; Ok "系统 node $(node -v)" }
elseif ($dshRt) { $nodeExe = $dshRt.Node; Ok "改用 DSH 自带 node" }
else { throw '找不到 node。请安装 Node.js ≥ 20。' }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw '缺少 git，请先安装。' }
Ok "git $(git --version)"

if (-not (Test-Path $DshHome)) { throw "找不到 DSH 家目录：$DshHome" }
Ok "DSH 家目录 $DshHome"

$profileDir = Join-Path $DshHome "profiles\$Profile"
if (-not (Test-Path $profileDir)) {
  $avail = (Get-ChildItem (Join-Path $DshHome 'profiles') -Directory -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty Name) -join ', '
  throw "找不到 profile：$profileDir`n可用：$avail"
}
Ok "profile 目录 $profileDir"

$pkgJsonPath = Join-Path $profileDir 'package.json'
if (-not (Test-Path $pkgJsonPath)) { throw "profile 缺少 package.json：$pkgJsonPath" }
Ok 'package.json 存在'

# 内置 ui-model-selection 提供 modelDirectories 服务，缺了本插件会永远 pending
$builtin = Join-Path $profileDir 'node_modules\@deepseek-ai\dsh-client-ui-model-selection'
if (Test-Path $builtin) {
  Ok '内置 ui-model-selection 存在（modelDirectories 有提供者）'
} else {
  Warn "未在 $builtin 找到内置 ui-model-selection"
  Warn '它多半打包在 DSH 的 app.asar 里（正常）；若真缺失，装完 /models 不会出现。'
}

# ── 获取插件文件 ──────────────────────────────────────────────────────────
Step '获取插件文件'
$vendorDir = Join-Path $profileDir 'vendor\dsh-model-groups'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if (Test-Path (Join-Path $vendorDir '.git')) {
  Ok "已存在 git 仓库，拉取最新（$Ref）"
  Push-Location $vendorDir
  try {
    git fetch origin --quiet
    git checkout $Ref --quiet 2>&1 | Out-Null
    git reset --hard "origin/$Ref" --quiet
  } finally { Pop-Location }
} else {
  if (Test-Path $vendorDir) {
    $old = "$vendorDir.bak-$stamp"
    Move-Item $vendorDir $old
    Warn "已有非 git 的同名目录，移到 $(Split-Path $old -Leaf)"
  }
  New-Item -ItemType Directory -Path (Split-Path $vendorDir -Parent) -Force | Out-Null
  git clone --quiet --depth 1 --branch $Ref $Repo $vendorDir
  Ok "克隆 $Repo ($Ref)"
}

# lib/ 是构建产物，必须随仓库提供，否则装上也跑不起来
$need = @('package.json', 'cordis.patch.yml', 'lib\index.js', 'lib\client.js', 'lib\pricing.js')
$missing = @($need | Where-Object { -not (Test-Path (Join-Path $vendorDir $_)) })
if ($missing.Count -gt 0) {
  throw "仓库缺少必要文件：$($missing -join ', ')。lib/ 应当已入库。"
}
Ok '必要文件齐全（含 lib/ 构建产物）'

# 宿主半边可加载性自检
$probe = (Join-Path $vendorDir 'lib\index.js') -replace '\\', '/'
$r = & $nodeExe -e "import('file:///$probe').then(m=>{if(typeof m.apply!=='function')throw new Error('no apply');console.log('OK '+Object.keys(m).join(','))}).catch(e=>{console.log('FAIL '+e.message);process.exit(1)})" 2>&1
if ("$r" -match '^OK') { Ok "宿主半边可加载：$r" }
else { throw "宿主半边加载失败：$r" }

# ── 登记到 package.json ───────────────────────────────────────────────────
Step '登记到 package.json'
$register = Join-Path $vendorDir 'scripts\register.mjs'
if (-not (Test-Path $register)) { throw "仓库缺少 scripts\register.mjs" }

$out = & $nodeExe $register $profileDir 2>&1
$out | ForEach-Object { "  $_" }
if ($LASTEXITCODE -ne 0) { throw "登记失败（退出码 $LASTEXITCODE）" }
Ok 'package.json 已更新（保留原缩进与换行，未写 BOM）'

# ── pnpm install ─────────────────────────────────────────────────────────
if ($SkipInstall) {
  Step '跳过安装（-SkipInstall）'
  Warn '文件与配置已就位，但 node_modules 里还没有实体。'
  Warn "请手动在 $profileDir 下执行一次 pnpm install"
} else {
  Step 'pnpm install'
  Push-Location $profileDir
  try {
    if ($dshRt) {
      Ok '用 DSH 自带 pnpm（版本与 profile 匹配）'
      & $dshRt.Node $dshRt.Pnpm install 2>&1 | ForEach-Object { "    $_" }
    } else {
      $pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue
      if (-not $pnpmCmd) { throw '系统没有 pnpm，也没找到 DSH 自带运行时。请先装 pnpm：npm i -g pnpm' }
      Ok "用系统 pnpm（$($pnpmCmd.Source)）"
      & $pnpmCmd.Source install 2>&1 | ForEach-Object { "    $_" }
    }
    if ($LASTEXITCODE -ne 0) { throw "pnpm install 失败（退出码 $LASTEXITCODE）" }
  } finally { Pop-Location }
  Ok '依赖安装完成'
}

# ── 结果自检 ─────────────────────────────────────────────────────────────
Step '安装结果自检'
$nm = Join-Path $profileDir 'node_modules\dsh-model-groups'
if (-not (Test-Path $nm)) {
  Warn 'node_modules\dsh-model-groups 不存在 —— install 没生效'
} else {
  Ok 'node_modules/dsh-model-groups 已就位'
  $lost = @($need | Where-Object { -not (Test-Path (Join-Path $nm $_)) })
  if ($lost.Count -eq 0) { Ok '运行时文件全部就位' } else { Warn "缺少：$($lost -join ', ')" }
}

# package.json 必须仍是无 BOM 的合法 JSON
$b = [System.IO.File]::ReadAllBytes($pkgJsonPath)
if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) {
  Warn 'package.json 带 UTF-8 BOM，pnpm 会解析失败 —— 请去掉 BOM 后重跑 install'
} else {
  Ok 'package.json 无 BOM'
}

Step '完成'
Write-Host @"
下一步：
  1. 完全退出 DSH（含托盘图标），再启动
     客户端半边打包在渲染进程里，热重载不一定覆盖
  2. 输入框敲  /models      折叠态（每模型一行，默认最省线路）
                /models-all  展开态（全部线路）
  3. 验证宿主路由（端口换成你的 GUI 端口）：
     Invoke-WebRequest http://127.0.0.1:64288/model-groups/pricing -UseBasicParsing
     返回 JSON 且 available:true = 宿主半边活着；404 = 没挂上
  4. 命令不出现时：启动日志搜 dsh-model-groups
     出现 pending (waiting for service: ...) = 内置 ui-model-selection 缺失

回滚：
  package.json 从  $profileDir\package.json.bak-modelgroups-*  恢复
  然后 cd "$profileDir"; pnpm install
"@ -ForegroundColor Gray
