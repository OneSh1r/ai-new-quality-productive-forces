$ErrorActionPreference = "Stop"

$siteRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8080
$url = "http://127.0.0.1:$port/"

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  Write-Host "未找到 Python。请安装 Python 3，或在当前目录运行任意静态文件服务器。" -ForegroundColor Red
  Read-Host "按 Enter 退出"
  exit 1
}

Write-Host ""
Write-Host "可视化导论 · 本地课程" -ForegroundColor Green
Write-Host "地址: $url"
Write-Host "关闭此窗口即可停止服务器。"
Write-Host ""

Start-Process $url
Set-Location $siteRoot
python -m http.server $port --bind 127.0.0.1
