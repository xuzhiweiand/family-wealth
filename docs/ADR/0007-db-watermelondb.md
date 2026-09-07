# ADR-0007: 本地数据库采用 WatermelonDB（懒加载 + 同步引擎预留）

**状态**: Accepted  
**日期**: 2026-09-07  
**对应技术方案**: §9、§21 D3

## 背景

App 需离线优先（见技术方案 §13），本地需存储：

- 11 类资产记录
- 资产快照（百万级，趋势图查询）
- 家庭、成员、邀请码

需选 RN 端本地数据库方案。

## 决策

**WatermelonDB**（懒加载 + 同步引擎预留）。

## 评估

| 候选 | 优点 | 缺点 |
|---|---|---|
| **WatermelonDB** | 懒加载专为 RN 设计、同步引擎兼容 Supabase、内置 schema/migrations | 概念稍多（Model/Query/Writer） |
| expo-sqlite | 系统原生 SQLite、性能最佳 | 需自己实现 Query Builder 与同步层 |
| rxdb | 功能最强（CQRS、冲突解决开箱） | 体积大、依赖 RxJS，RN 性能不稳 |

## 理由

1. **百万级快照** — WatermelonDB 懒加载按需取，趋势图查询不会一次拉全表
2. **同步兼容** — 官方适配 Supabase（PostgreSQL logical replication）
3. **schema/migrations** — 后续表结构调整有规范流程
4. **active record 模式** — Model 类与数据模型一一对应，业务层易理解

## 抽象层

为避免 WatermelonDB native 依赖绑死在 RN 主线程，包一层 Repository 接口：

```ts
// packages/db/src/repository.ts
export interface AssetRepository {
  findById(id: string): Promise<Asset | null>;
  list(filter?: AssetFilter): Promise<Asset[]>;
  upsert(asset: Asset): Promise<void>;
  delete(id: string): Promise<void>;
  observeAll(filter?: AssetFilter): Observable<Asset[]>;
}
```

W2 实现 `InMemoryAssetRepository`（mock，便于单测），W3 接入 WatermelonDB 真实实现。

## 后果

- ✅ 性能适合百万级快照
- ✅ 同步层对接 Supabase 有现成方案
- ⚠️ 团队需学 WatermelonDB 概念（一次性成本）
- ⚠️ native 库对 Expo Go 不友好，需 prebuild

## 验证

- W2 实现 `InMemoryAssetRepository` + 8+ 单测
- W3 在真机 prebuild 上接入 WatermelonDB，验证 10 万快照懒加载 < 100ms