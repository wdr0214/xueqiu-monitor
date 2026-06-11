param(
  [Parameter(Mandatory = $true)]
  [string]$NetlifyAuthToken,

  [Parameter(Mandatory = $true)]
  [string]$WechatAppId,

  [Parameter(Mandatory = $true)]
  [string]$WechatAppSecret,

  [Parameter(Mandatory = $true)]
  [string]$WechatToOpenId,

  [Parameter(Mandatory = $true)]
  [string]$WechatTemplateId,

  [string]$XueqiuCookie = "",
  [string]$SiteName = "xueqiu-zh188094-monitor"
)

$ErrorActionPreference = "Stop"

function Run-Netlify {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  & npx.cmd --yes netlify-cli @Args --auth $NetlifyAuthToken
  if ($LASTEXITCODE -ne 0) {
    throw "Netlify command failed: $($Args -join ' ')"
  }
}

Write-Host "Installing project dependencies..."
npm.cmd install

Write-Host "Running tests..."
npm.cmd test

Write-Host "Creating or linking Netlify site..."
Run-Netlify init --manual --name $SiteName

Write-Host "Setting Netlify environment variables..."
Run-Netlify env:set CUBE_SYMBOL "ZH188094"
Run-Netlify env:set TZ "Asia/Shanghai"
Run-Netlify env:set POLL_START "09:00:00"
Run-Netlify env:set POLL_END "15:30:00"
Run-Netlify env:set POLL_INTERVAL_MS "1000"
Run-Netlify env:set NETLIFY_RUN_SECONDS "25"
Run-Netlify env:set WECHAT_APP_ID $WechatAppId
Run-Netlify env:set WECHAT_APP_SECRET $WechatAppSecret
Run-Netlify env:set WECHAT_TO_OPENID $WechatToOpenId
Run-Netlify env:set WECHAT_TEMPLATE_ID $WechatTemplateId

if ($XueqiuCookie) {
  Run-Netlify env:set XUEQIU_COOKIE $XueqiuCookie
}

Write-Host "Deploying to production..."
Run-Netlify deploy --build --prod

Write-Host "Done."
