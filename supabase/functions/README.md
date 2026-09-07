# Supabase Edge Functions

W2 起逐步添加以下函数（见技术方案 §10.5）：

- `create-family/` — 邀请码生成与家庭创建
- `join-family/` — 邀请码兑换与 FDK 分发
- `alert-detector/` — 资产异动检测（CRON 每日触发）
- `sync-helper/` — 同步握手与冲突标记

本地开发：

```bash
supabase functions serve create-family --env-file ./supabase/.env.local
```