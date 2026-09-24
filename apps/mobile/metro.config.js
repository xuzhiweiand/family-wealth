// bare RN Metro 配置（原 expo/metro-config 等价物）
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

const projectRoot = __dirname;
// monorepo 根目录：解析 packages/* 别名
const monorepoRoot = path.resolve(projectRoot, '../..');

// 判断当前是否为鸿蒙平台打包
const isHarmony = process.env.RN_PLATFORM === 'harmony' || process.argv.includes('--platform=harmony') || process.argv.includes('--platform harmony');

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
    // 4) 鸿蒙平台特定模块重定向
    ...(isHarmony && {
      extraNodeModules: {
        // 将特定模块重定向到鸿蒙适配层
        'react-native-keychain': path.resolve(projectRoot, 'src/platforms/harmony'),
        '@react-native-ml-kit/text-recognition': path.resolve(projectRoot, 'src/platforms/harmony'),
        'react-native-image-picker': path.resolve(projectRoot, 'src/platforms/harmony'),
      },
    }),
  },
  // 鸿蒙平台使用 Hermes 引擎（与 Android 一致）
  transformer: {
    ...(isHarmony && {
      hermesParser: true,
    }),
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
