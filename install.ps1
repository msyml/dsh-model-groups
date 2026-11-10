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
#
# 脚本做四件事：
#   1. git clone 到 <profile>/vendor/dsh-model-groups
#   2. 在 <profile>/package.json 的 dependencies 登记 file:./vendor/dsh-model-groups
#   3. 在 <profile>/package.json 的 dsh.profile.bundles 登记 dsh-model-groups
#   4. pnpm install，让包进 node_modules
#
# 改动前备份 package.json，失败可回滚。重复执行是安全的（幂等）。

[CmdletBinding()]
param(
  [string]$Profile = 'desktop',
  [string]$DshHome = (Join-Path $env:USERPROFILE '.dsh'),
  [string]$Repo = 'https://github.com/msyml/dsh-model-groups.git',
  [string]$Ref = 'main'
)

$ErrorActionPreference = 'Stop'

function Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  [OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [!!] $m" -ForegroundColor Yellow }

# ── 前置检查 ──────────────────────────────────────────────────────────────
Step '前置检查'

foreach ($cmd in @('git', 'node')) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "缺少 $cmd，请先安装。" }
}
Ok "git $(git --version) / node $(node -v)"

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
  Warn "未找到 $builtin"
  Warn '若它被打包在 DSH 的 app.asar 里则属正常；若真缺失，装完 /models 不会出现。'
}

# ── 备份 ─────────────────────────────────────────────────────────────────
Step '备份 package.json'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$bak = "$pkgJsonPath.bak-modelgroups-$stamp"
Copy-Item $pkgJsonPath $bak
Ok "备份到 $(Split-Path $bak -Leaf)"

# ── 克隆到 vendor ────────────────────────────────────────────────────────
Step '获取插件文件'
$vendorDir = Join-Path $profileDir 'vendor\dsh-model-groups'

if (Test-Path (Join-Path $vendorDir '.git')) {
  Ok "已存在 git 仓库，改为拉取最新（$Ref）"
  Push-Location $vendorDir
  try {
    git fetch origin --quiet
    git checkout $Ref --quiet 2>&1 | Out-Null
    git pull --ff-only origin $Ref --quiet
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

# 产物完整性：lib/ 必须随仓库提供，否则装上也跑不起来
$need = @('package.json', 'cordis.patch.yml', 'lib\index.js', 'lib\client.js', 'lib\pricing.js')
$missing = @($need | Where-Object { -not (Test-Path (Join-Path $vendorDir $_)) })
if ($missing.Count -gt 0) {
  throw "仓库缺少必要文件：$($missing -join ', ')。lib/ 是构建产物，应当已入库。"
}
Ok '必要文件齐全（含 lib/ 构建产物）'

# 宿主半边可加载性自检
$probe = (Join-Path $vendorDir 'lib\index.js') -replace '\\', '/'
$r = & node -e "import('file:///$probe').then(m=>{if(typeof m.apply!=='function')throw new Error('no apply');console.log('OK '+Object.keys(m).join(','))}).catch(e=>{console.log('FAIL '+e.message);process.exit(1)})" 2>&1
if ("$r" -match '^OK') { Ok "宿主半边可加载：$r" }
else { throw "宿主半边加载失败：$r" }

# ── 登记到 package.json ───────────────────────────────────────────────────
Step '登记到 package.json'
$pkg = Get-Content $pkgJsonPath -Raw | ConvertFrom-Json

if (-not $pkg.PSObject.Properties.Name.Contains('dependencies')) {
  $pkg | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) -Force
}
$spec = 'file:./vendor/dsh-model-groups'
if ($pkg.dependencies.PSObject.Properties.Name.Contains('dsh-model-groups')) {
  $prev = $pkg.dependencies.'dsh-model-groups'
  $pkg.dependencies.'dsh-model-groups' = $spec
  Ok "dependencies 已有该项（$prev），更新为 $spec"
} else {
  $pkg.dependencies | Add-Member -NotePropertyName 'dsh-model-groups' -NotePropertyValue $spec -Force
  Ok "dependencies += dsh-model-groups: $spec"
}

$bundles = $pkg.dsh.profile.bundles
if (-not $bundles) { throw 'package.json 缺少 dsh.profile.bundles，结构与预期不符，已中止。' }
if (@($bundles) -contains 'dsh-model-groups') {
  Ok 'dsh.profile.bundles 已包含 dsh-model-groups'
} else {
  $pkg.dsh.profile.bundles = @(@($bundles) + 'dsh-model-groups')
  Ok 'dsh.profile.bundles += dsh-model-groups'
}

# ConvertTo-Json 默认深度 2 会截断 dsh.profile 这类嵌套，必须给足
$pkg | ConvertTo-Json -Depth 32 | Set-Content $pkgJsonPath -Encoding UTF8
Ok 'package.json 已写回'

# ── pnpm install ─────────────────────────────────────────────────────────
Step 'pnpm install'
$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpm) {
  # DSH 自带一份 pnpm，借它的 node
  $rt = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime'
  $dshNode = Join-Path $rt 'bin\node.exe'
  if (Test-Path $dshNode) {
    Ok "系统无 pnpm，改用 DSH 自带运行时：$dshNode"
    Warn '请手动在 profile 目录执行一次 pnpm install（可用 DSH 的 pnpm）'
  }
  throw '  pnpm 不在 PATH 里。装一个：npm i -g pnpm，或 corepack enable pnpm'
}

Push-Location $profileDir
try {
  & pnpm install 2>&1 | ForEach-Object { "    $_" }
  if ($LASTEXITCODE -ne 0) { throw "pnpm install 失败（退出码 $LASTEXITCODE）" }
} finally { Pop-Location }
Ok '依赖安装完成'

# ── 结果自检 ─────────────────────────────────────────────────────────────
Step '安装结果自检'
$nm = Join-Path $profileDir 'node_modules\dsh-model-groups'
if (-not (Test-Path $nm)) {
  Warn 'node_modules\dsh-model-groups 不存在 —— install 没生效'
} else {
  Ok 'node_modules\dsh-model-groups 已就位'
  $lost = @($need | Where-Object { -not (Test-Path (Join-Path $nm $_)) })
  if ($lost.Count -eq 0) { Ok '运行时文件全部就位' } else { Warn "缺少：$($lost -join ', ')" }
}

Step '完成'
Write-Host @"
下一步：
  1. 完全退出 DSH（含托盘图标），再启动 —— 客户端半边打包在渲染进程里，热重载不一定覆盖
  2. 输入框敲  /models      折叠态（每模型一行，默认最省线路）
                /models-all  展开态（全部线路）
  3. 验证宿主路由（端口换成你的 GUI 端口）：
     Invoke-WebRequest http://127.0.0.1:64288/model-groups/pricing -UseBasicParsing
     返回 JSON 且 available:true = 宿主半边活着；404 = 没挂上
  4. 命令不出现时：启动日志搜 dsh-model-groups，
     出现 pending (waiting for service: ...) = 内置 ui-model-selection 缺失

回滚：
  Copy-Item "$bak" "$pkgJsonPath" -Force
  然后 cd "$profileDir"; pnpm install
"@ -ForegroundColor Gray
