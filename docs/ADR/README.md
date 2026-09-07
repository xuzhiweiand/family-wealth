# ADR — Architecture Decision Records

记录所有影响架构/技术栈/工程的重大决策。命名规范：`NNNN-标题.md`，例如 `0001-monorepo-选型.md`。

| # | 标题 | 状态 | 日期 |
|---|---|---|---|
| 0001 | Monorepo 选型（pnpm + workspaces） | ✅ Accepted | 2026-09-07 |
| 0002 | React Native + Expo Router 技术栈 | ✅ Accepted | 2026-09-07 |
| 0003 | 端到端加密（密码派生密钥 + AES-256-GCM 信封加密） | ✅ Accepted | 2026-09-07 |
| 0004 | Supabase 作为后端 + 端到端加密 | ✅ Accepted | 2026-09-07 |

W3 之前需补录的关键 ADR（D1-D4 决策落地后）：

- 0005 — UI 库：Tamagui vs NativeWind v4（D1）
- 0006 — 加密库：@noble/ciphers vs quick-crypto（D2）
- 0007 — 本地 DB：WatermelonDB vs expo-sqlite（D3）
- 0008 — OCR：端侧 vs 云侧（D4）