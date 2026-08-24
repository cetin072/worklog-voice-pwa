$ErrorActionPreference = "Stop"

$Repo = "cetin072/worklog-voice-pwa"
$SiteId = "1ab24b2c-a3e7-479f-8c1b-bbd0a567a25d"

Write-Host ""
Write-Host "=== 업무기록 PWA 자동 설정/배포 ===" -ForegroundColor Cyan
Write-Host ""

function Require-Command($name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "$name 명령을 찾을 수 없습니다. 설치 후 다시 실행해주세요."
    }
}

Require-Command "git"
Require-Command "gh"
Require-Command "node"
Require-Command "npm"

Write-Host "[1/7] GitHub 로그인 확인"
gh auth status | Out-Host

if (-not (Test-Path ".git")) {
    git init | Out-Host
    git branch -M main | Out-Host
}

Write-Host "[2/7] GitHub 전용 저장소 준비"
$repoExists = $true
try {
    gh repo view $Repo --json name 2>$null | Out-Null
} catch {
    $repoExists = $false
}

if (-not $repoExists) {
    gh repo create $Repo --private --source . --remote origin | Out-Host
} else {
    $remote = git remote get-url origin 2>$null
    if (-not $remote) {
        git remote add origin "https://github.com/$Repo.git"
    }
}

Write-Host "[3/7] 소스 커밋/푸시"
git add .
$hasChanges = git status --porcelain
if ($hasChanges) {
    git commit -m "feat: initial worklog voice PWA" | Out-Host
}
git push -u origin main | Out-Host

Write-Host "[4/7] Netlify CLI 로그인/연결"
npx --yes netlify-cli status 2>$null | Out-Host
if ($LASTEXITCODE -ne 0) {
    Write-Host "브라우저에서 Netlify 로그인을 완료해주세요." -ForegroundColor Yellow
    npx --yes netlify-cli login | Out-Host
}
npx --yes netlify-cli link --id $SiteId | Out-Host

Write-Host "[5/7] Notion 토큰 입력"
Write-Host "토큰은 화면에 표시되지 않고 GitHub에도 저장되지 않습니다." -ForegroundColor Yellow
$secure = Read-Host "Notion 업무기록 PWA 액세스 토큰" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    if ([string]::IsNullOrWhiteSpace($token)) { throw "토큰이 비어 있습니다." }

    Write-Host "[6/7] Netlify 비밀 환경변수 등록"
    npx --yes netlify-cli env:set NOTION_TOKEN "$token" --scope functions | Out-Host
} finally {
    if ($ptr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
    $token = $null
}

Write-Host "[7/7] Production 배포"
npm install | Out-Host
npx --yes netlify-cli deploy --prod | Out-Host

Write-Host ""
Write-Host "=== 완료 ===" -ForegroundColor Green
Write-Host "사이트: https://worklog-voice-pwa.netlify.app"
Write-Host ""
Read-Host "Enter를 누르면 종료합니다"
