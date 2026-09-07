/**
 * WatermelonDB 实现入口（供 mobile 在 prebuild 后使用）
 *
 * 用法：
 *   import { Database } from '@nozbe/watermelondb';
 *   import { appSchemaV1, AssetModel, AssetSnapshotModel,
 *            WatermelonAssetRepository, WatermelonSnapshotRepository } from '@family-wealth/db/watermelon';
 *
 *   const db = new Database({ adapter, modelClasses: [AssetModel, AssetSnapshotModel] });
 *   const assets = new WatermelonAssetRepository(db);
 *
 * ⚠️ 本目录依赖 @nozbe/watermelondb（native），未纳入 typecheck，
 *    见 packages/db/tsconfig.json 的 exclude。
 */

export * from './schema';
export * from './models';
export * from './repository';
