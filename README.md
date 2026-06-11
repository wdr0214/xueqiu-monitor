# 雪球组合调仓监控与微信服务号推送

这个项目用于监控雪球组合 `ZH188094` 的调仓动态，并在发现新调仓记录后通过微信服务号模板消息推送股票名称、调仓变化和调仓价格。

## 运行逻辑

- 运行时区固定为 `Asia/Shanghai`。
- 只在中国 A 股交易日 `09:00:00-15:30:00` 每秒轮询。
- 周六、周日自动跳过。
- 节假日和休市日从 `config/market-holidays.cn-a.json` 读取，后续每年按交易所公告更新。
- 默认先尝试免登录访问雪球；如果雪球返回登录态错误，把浏览器中的雪球 Cookie 填到 `XUEQIU_COOKIE`。
- 已通知过的调仓记录保存在 `data/state.json`，容器重启后不会重复推送。

## 云服务器部署

严格要求交易时间内每秒无间断监控时，推荐使用 Docker 云服务器部署。

1. 安装 Docker 和 Docker Compose。
2. 上传整个项目目录到服务器。
3. 复制配置文件：

```bash
cp .env.example .env
```

4. 编辑 `.env`，填入微信服务号参数：

```env
WECHAT_APP_ID=你的服务号AppID
WECHAT_APP_SECRET=你的服务号AppSecret
WECHAT_TO_OPENID=接收消息的OpenID
WECHAT_TEMPLATE_ID=模板消息ID
```

5. 启动：

```bash
docker compose up -d --build
```

6. 查看日志：

```bash
docker compose logs -f
```

## Netlify 部署

项目已经包含 Netlify 配置：

- `netlify.toml`
- `netlify/functions/monitor.mjs`
- `public/index.html`
- Netlify Blobs 状态存储

Netlify Scheduled Functions 按分钟触发，且单次函数不能长期常驻，所以它不能做到服务器进程那种 `09:00-15:30` 完全无间断每秒轮询。当前实现为：每分钟触发一次，在函数运行时间内每秒检查一次，默认运行 `25` 秒。

部署步骤：

1. 把本项目上传到 GitHub、GitLab 或 Bitbucket 仓库。
2. 在 Netlify 里新建站点并连接仓库。
3. 构建设置保持默认即可，项目已在 `netlify.toml` 中配置：

```toml
[build]
  publish = "public"
  functions = "netlify/functions"
```

4. 在 Netlify 项目设置的 Environment variables 里填入：

```env
CUBE_SYMBOL=ZH188094
TZ=Asia/Shanghai
POLL_START=09:00:00
POLL_END=15:30:00
POLL_INTERVAL_MS=1000
NETLIFY_RUN_SECONDS=25
WECHAT_APP_ID=你的服务号AppID
WECHAT_APP_SECRET=你的服务号AppSecret
WECHAT_TO_OPENID=接收消息的OpenID
WECHAT_TEMPLATE_ID=模板消息ID
XUEQIU_COOKIE=可选，雪球需要登录态时填写
```

5. 部署后，在 Netlify 的 Functions 日志里查看 `monitor` 是否按分钟运行。

如果你需要尽可能接近每秒，可以把 `NETLIFY_RUN_SECONDS` 设置为 `28`；不建议更高，避免触碰函数超时。

### 用脚本发布

如果在本机发布，先到 Netlify 创建 Personal access token，然后运行：

```powershell
.\scripts\deploy-netlify.ps1 `
  -NetlifyAuthToken "你的NetlifyToken" `
  -WechatAppId "你的服务号AppID" `
  -WechatAppSecret "你的服务号AppSecret" `
  -WechatToOpenId "接收消息的OpenID" `
  -WechatTemplateId "模板消息ID" `
  -XueqiuCookie "可选，雪球Cookie"
```

脚本会安装依赖、运行测试、创建或关联 Netlify 站点、设置环境变量并发布到生产环境。

## 微信模板字段

默认使用以下模板字段名：

- `stockName`：股票名称
- `rebalanceChange`：调仓变化
- `rebalancePrice`：调仓价格
- `remark`：备注

如果你的公众号模板字段名不同，在 `.env` 中修改：

```env
WECHAT_FIELD_STOCK_NAME=stockName
WECHAT_FIELD_CHANGE=rebalanceChange
WECHAT_FIELD_PRICE=rebalancePrice
WECHAT_FIELD_REMARK=remark
```

## 雪球 Cookie

如果日志出现 `Xueqiu requires login Cookie`，说明雪球拒绝了免登录接口请求。处理方式：

1. 在浏览器登录雪球。
2. 打开 `https://xueqiu.com/P/ZH188094`。
3. 从浏览器开发者工具复制请求 Cookie。
4. 写入 `.env`：

```env
XUEQIU_COOKIE=复制到的一整段Cookie
```

然后重启：

```bash
docker compose restart
```

## 本地测试

本项目不依赖第三方 npm 包。测试命令：

```bash
npm test
```

如果 Windows PowerShell 禁止运行 `npm.ps1`，可以使用：

```powershell
npm.cmd test
```

## 更新休市日

每年交易所发布休市安排后，更新 `config/market-holidays.cn-a.json` 的 `closedDates`。格式为：

```json
"2026-10-01"
```

只需要写工作日中的休市日；周六、周日程序会自动跳过。
