// bare RN Metro 配置（原 expo/metro-config 等价物）
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

const projectRoot = __dirname;
// monorepo 根目录：解析 packages/* 别名
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = {
  // 1) 让 Metro 监视 monorepo 根目录（共享包变更触发 HMR）
  watchFolders: [monorepoRoot],
  resolver: {
    // 2) 在 monorepo 模式下启用节点模块解析（找 @family-wealth/*）
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(monorepoRoot, 'node_modules'),
    ],
    // 3) 让 metro 能解析 monorepo 里的 TS 源文件
    disableHierarchicalLookup: false,
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
