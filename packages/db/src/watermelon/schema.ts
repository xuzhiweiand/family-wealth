/**
 * WatermelonDB schema（ADR-0007）
 *
 * 表与列对齐《数据模型设计.md》v1.0 §9，字段用 snake_case（WatermelonDB 惯例）。
 * 时间戳存 epoch ms（number），details 存 JSON 字符串（text），
 * 与 packages/db/src/mappers.ts 的原始行定义一致。
 *
 * ⚠️ 本文件依赖 @nozbe/watermelondb（native 模块），本机沙箱无法安装，
 *    未纳入 `tsc --noEmit`（见 packages/db/tsconfig.json 的 exclude）。
 *    需在真机 prebuild 后由 `pnpm install` 安装并验证。
 */

import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const appSchemaV1 = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: 'assets',
      columns: [
        { name: 'family_id', type: 'string', isIndexed: true },
        { name: 'owner_id', type: 'string' },
        { name: 'type', type: 'string', isIndexed: true },
        { name: 'name', type: 'string' },
        { name: 'current_amount', type: 'number' },
        { name: 'currency', type: 'string' },
        { name: 'visibility', type: 'string' },
        { name: 'details', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
        { name: 'deleted_at', type: 'number', isOptional: true },
      ],
    }),
    tableSchema({
      name: 'asset_snapshots',
      columns: [
        { name: 'asset_id', type: 'string', isIndexed: true },
        { name: 'family_id', type: 'string', isIndexed: true },
        { name: 'amount', type: 'number' },
        { name: 'currency', type: 'string' },
        { name: 'captured_at', type: 'number' },
        { name: 'source', type: 'string' },
      ],
    }),
  ],
});
