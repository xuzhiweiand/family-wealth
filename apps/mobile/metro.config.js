// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
// monorepo 根目录：解析 packages/* 别名
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1) 让 Metro 监视 monorepo 根目录（共享包变更触发 HMR）
config.watchFolders = [monorepoRoot];

// 2) 在 monorepo 模式下启用节点模块解析（找 @family-wealth/*）
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// 3) 让 metro 能解析 monorepo 里的 TS 源文件
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
