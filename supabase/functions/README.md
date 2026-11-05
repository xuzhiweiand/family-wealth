# Supabase Edge Functions

W2 起逐步添加以下函数（见技术方案 §10.5）：

- `create-family/` — 邀请码生成与家庭创建
- `join-family/` — 邀请码兑换与 FDK 分发
- `alert-detector/` — 资产异动检测（CRON 每日触发）
- `sync-helper/` — 同步握手与冲突标记
- `huawei-auth/` — 华为账号授权登录（Account Kit 授权登录，v0.5.0）
- `submit-feedback/` — 用户反馈工单邮件通知（SMTP → 开发者邮箱，v0.5.0）

`huawei-auth` 需要以下环境变量：

```
HUAWEI_CLIENT_ID=       # AGC 应用 Client ID（必填）
HUAWEI_CLIENT_SECRET=   # AGC 应用 Client Secret（必填，仅存于服务端）
HUAWEI_REDIRECT_URI=    # 与授权请求一致的回调地址（可选）
```

`submit-feedback` 需要以下环境变量：

```
FEEDBACK_SMTP_HOST=     # 默认 smtp.163.com
FEEDBACK_SMTP_PORT=     # 默认 465（SSL）
FEEDBACK_SMTP_USER=     # 发信账号（163 邮箱地址）
FEEDBACK_SMTP_PASS=     # 163 邮箱客户端授权码（非登录密码）
FEEDBACK_TO=            # 收件邮箱，默认 xuzhiweiand@163.com
```

本地开发：

```bash
supabase functions serve huawei-auth --env-file ./supabase/.env.local
```

自托管部署（默认 compose 只启动 db/auth/rest/api-gw/studio/meta，`functions` 未启动，
此时 `/functions/v1/*` 会返回 503，客户端提示「服务未启用」）：

```bash
# 1. 上传函数代码
sudo mkdir -p /opt/supabase/docker/volumes/functions
sudo cp -r supabase/functions/huawei-auth /opt/supabase/docker/volumes/functions/

# 2. 写入华为凭据（值来自 AGC，Client ID 与 module.json5 metadata 保持一致）
sudo tee -a /opt/supabase/docker/.env >/dev/null <<'EOF'
HUAWEI_CLIENT_ID=
HUAWEI_CLIENT_SECRET=
HUAWEI_REDIRECT_URI=
EOF

# 3. 启动 functions 服务（会先启动依赖的 analytics）
cd /opt/supabase/docker && sudo docker compose up -d functions

# 4. 验证（应返回 JSON，而不是 404/503）
curl -i -X POST http://<服务器IP>:8000/functions/v1/huawei-auth \
  -H 'apikey: <ANON_KEY>' -H 'Authorization: Bearer <ANON_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"authorizationCode":"test","state":"test"}'
```

客户端调用 `huawei-auth` 前，需先执行 `supabase/migrations/20261104000000_huawei_auth.sql`
（创建 `profiles_huawei`），否则函数返回「请确认 profiles_huawei 迁移已执行」。

