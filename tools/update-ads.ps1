# update-ads.ps1 — push the in-game billboard ads LIVE (instant, no redeploy/commit).
#
# 1) Edit tools/ads-live.json (each entry is a plain string OR an object:
#       { "text":"...", "color":"#ffd23f", "imageUrl":"https://...", "clickLink":"https://..." })
# 2) Run from the project folder:
#       .\tools\update-ads.ps1 -Token "<your-admin-token>"
#
# The token is your Worker ADS_ADMIN_TOKEN (passed at runtime so it never lands in the repo).

param(
  [Parameter(Mandatory=$true)][string]$Token,
  [string]$File = "$PSScriptRoot\ads-live.json",
  [string]$Api  = "https://xzilla-leaderboard.kombainain.workers.dev/ads"
)

if (-not (Test-Path $File)) { Write-Error "Ads file not found: $File"; exit 1 }
$body = Get-Content -Raw -Path $File

try {
  $res = Invoke-RestMethod -Method Post -Uri $Api -Headers @{ "x-admin-token" = $Token } -ContentType "application/json" -Body $body
  Write-Host ("Updated " + $res.count + " ads. Live config now:") -ForegroundColor Green
  Invoke-RestMethod -Uri $Api | ConvertTo-Json -Depth 6
} catch {
  Write-Error ("Update failed: " + $_.Exception.Message)
  exit 1
}
