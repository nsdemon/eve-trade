# Run this to add, commit, and push any changes.
# Usage: .\push.ps1 "message"   or   .\push.ps1
cd $PSScriptRoot

Write-Host "=== Git status ===" -ForegroundColor Cyan
git status -s

$changes = git status --porcelain
if (-not $changes) {
    Write-Host "`nNothing to commit (working tree clean). Already up to date with remote." -ForegroundColor Yellow
    exit 0
}

$msg = $args[0]
if (-not $msg) { $msg = "Update" }

git add -A
git status -s
Write-Host "`nCommitting with message: $msg" -ForegroundColor Cyan
git commit -m $msg
git push origin main
Write-Host "`nDone. Pushed to GitHub." -ForegroundColor Green
