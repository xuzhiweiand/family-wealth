# API 设计

自动生成（OpenAPI 3.1）将在 W3 由 Supabase 生成 `supabase/.temp/api-schema.json` 后追加。

## REST 端点速查（见《技术方案设计》§10.1）

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/rest/v1/assets?family_id=eq.{id}` | 拉取家庭资产列表 |
| POST | `/rest/v1/assets` | 创建资产 |
| PATCH | `/rest/v1/assets?id=eq.{id}` | 更新资产 |
| DELETE | `/rest/v1/assets?id=eq.{id}` | 软删除 |
| GET | `/rest/v1/asset_snapshots?asset_id=in.{ids}` | 拉取快照（趋势图） |
| POST | `/rest/v1/rpc/create_family` | 调用 RPC 创建家庭 |

## Realtime 频道

| 频道 | 用途 |
|---|---|
| `family:{id}:assets` | 资产 CRUD 实时同步 |
| `family:{id}:members` | 成员变更通知 |
| `user:{id}:alerts` | 异动提醒推送 |

详细 schema 与字段见 `supabase/migrations/`（W3 起逐步提交）。