# eBay Client Secret 안전 입력기
# - 새로 Rotate한 Cert ID(Client Secret)를 .env 에만 저장합니다.
# - 화면에 값을 출력하지 않고, 깃에도 올라가지 않습니다(.env는 .gitignore).
# 실행: 프로젝트 폴더에서  powershell -ExecutionPolicy Bypass -File tools\set-ebay-secret.ps1

$ErrorActionPreference = 'Stop'
$envPath = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
if (-not (Test-Path $envPath)) {
  Write-Host '.env 파일이 없습니다. 먼저 .env를 만들어 주세요.' -ForegroundColor Red
  exit 1
}

$sec = Read-Host '새로 Rotate한 eBay Cert ID(Client Secret)를 붙여넣고 Enter' -AsSecureString
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
$plain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

if ([string]::IsNullOrWhiteSpace($plain)) { Write-Host '입력값이 비었습니다. 중단합니다.' -ForegroundColor Red; exit 1 }

$lines = Get-Content $envPath
$found = $false
$out = foreach ($l in $lines) {
  if ($l -match '^EBAY_CLIENT_SECRET=') { $found = $true; "EBAY_CLIENT_SECRET=$plain" }
  else { $l }
}
if (-not $found) { $out = $out + "EBAY_CLIENT_SECRET=$plain" }
$out | Set-Content -Path $envPath -Encoding utf8

$plain = $null
Write-Host 'OK: .env에 Secret을 저장했습니다. (값은 표시하지 않음)' -ForegroundColor Green
Write-Host '이제 가격 수집을 진행하면 됩니다.'
