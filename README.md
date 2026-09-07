# Family Wealth · 家庭资产管理 App

一个面向中国家庭的端到端加密资产管理移动 App。

## 项目特性

- **本地优先**：所有数据先入本地 SQLite，远端同步是「副作用」而非前提
- **端到端加密**：金额字段服务端看不到明文，家庭数据密钥本地派生
- **客户端聚合**：趋势图、净资产、分类对比全部在客户端计算
- **多人协作**：以家庭为单位，权限三级（Owner / Editor / Viewer）
- **多平台**：iOS / Android（M2 评估 HarmonyOS）

## Monorepo 结构

```
family-wealth/
├── apps/
│   └── mobile/                # Expo + React Native 应用
├── packages/
│   ├── shared-types/          # 跨端共享 TS 类型（加密 Envelope / 资产模型 / 权限）
│   ├── shared-utils/          # 跨端工具（金额格式化 / 校验）
│   ├── eslint-config/         # 共享 ESLint 规则
│   └── tsconfig/              # 共享 TSConfig
├── supabase/
│   ├── migrations/            # PostgreSQL 迁移
│   └── functions/             # Edge Functions（邀请兑换 / OCR / 推送）
├── docs/                      # ADR / runbook / API 文档
├── .github/workflows/         # CI
└── ...
```

## 关键文档

| 文档 | 说明 |
|---|---|
| [PRD v2.1](../documents/家庭资产管理App-需求定义.md) | 需求定义 |
| [数据模型 v1.0](../documents/数据模型设计.md) | 12 张表 + 加密策略 |
| [技术方案 v1.0](../documents/技术方案设计.md) | 架构 / API / 同步 / 性能预算 |
| [鸿蒙方案评估](../documents/鸿蒙适配方案评估.md) | 方案 C 渐进混合 |
| [`docs/ADR/`](./docs/ADR) | 重要技术决策记录 |
| [`docs/runbook/`](./docs/runbook) | 运维 SOP |

## 快速开始

需要 Node.js ≥ 22 与 pnpm ≥ 9.15。

```bash
# 安装依赖
pnpm install

# 启动移动端开发服务器（Expo）
pnpm mobile:start

# 类型检查 / 测试 / 代码风格
pnpm typecheck
pnpm test
pnpm lint
```

## 实施进度

- [x] **阶段 1：文档先行** — PRD / 数据模型 / 技术方案全部完成
- [x] **阶段 2：高保真原型** — `../prototype/index.html`（单文件 HTML）
- [ ] **阶段 3：项目初始化** — 当前阶段（W1）✅
- [ ] **阶段 4：MVP 开发**（W2-W11）
- [ ] **阶段 5：上架上线**（W12）

## License

私有项目，未经授权禁止使用。
