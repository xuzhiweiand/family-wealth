// bare RN Metro 配置（原 expo/metro-config 等价物）
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

const projectRoot = __dirname;
// monorepo 根目录：解析 packages/* 别名
const monorepoRoot = path.resolve(projectRoot, '../..');

// 判断当前是否为鸿蒙平台打包
// 注意：CLI 参数是空格分隔的独立 argv 项（'--platform', 'harmony'），
// 不能用 includes('--platform=harmony') 或 includes('--platform harmony') 判断
function detectPlatformArg() {
  const idx = process.argv.findIndex(
    (a) => a === '--platform' || a.startsWith('--platform='),
  );
  if (idx < 0) return undefined;
  const arg = process.argv[idx];
  return arg.includes('=') ? arg.split('=')[1] : process.argv[idx + 1];
}
const isHarmony =
  process.env.RN_PLATFORM === 'harmony' || detectPlatformArg() === 'harmony';

// RNOH 官方 metro 配置：提供 resolveRequest，将 react-native 重定向到
// @react-native-oh/react-native-harmony（含 .harmony.* 扩展优先解析和
// TextInput/ScrollView 等 delegate 的鸿蒙实现）
const { createHarmonyMetroConfig } = require('@react-native-oh/react-native-harmony/metro.config');
const harmonyConfig = isHarmony
  ? createHarmonyMetroConfig({
      reactNativeHarmonyPackageName: '@react-native-oh/react-native-harmony',
    })
  : {};

const config = {
  // 1) 让 Metro 监视 monorepo 根目录（共享包变更触发 HMR）
  watchFolders: [monorepoRoot],
  resolver: {
    // harmony 平台需保留 native 作为回退，确保 tamagui 等库的
    // .native.js 文件能被正确解析（否则会落到 web 版本导致运行时失败）
    ...(isHarmony && {
      platforms: ['harmony', 'native'],
    }),
    // 2) 在 monorepo 模式下启用节点模块解析（找 @family-wealth/*）
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(monorepoRoot, 'node_modules'),
    ],
    // 3) 让 metro 能解析 monorepo 里的 TS 源文件
    disableHierarchicalLookup: false,
  },
  // 鸿蒙平台使用 Hermes 引擎（与 Android 一致）
  transformer: {
    ...(isHarmony && {
      hermesParser: true,
    }),
  },
};

const merged = mergeConfig(getDefaultConfig(projectRoot), harmonyConfig, config);

if (isHarmony) {
  // 无鸿蒙原生实现的库：在 resolveRequest 最前端硬拦截，重定向到本地适配层
  // （extraNodeModules 指向目录的方式经实测不生效——harmony resolveRequest
  // 链 fallback 后 metro 未应用 extraNodeModules，仍命中 node_modules 真包，
  // 导致运行时 RNKeychainManager 为 null）
  const adapterFile = path.resolve(projectRoot, 'src/platforms/harmony/index.ts');
  const localAdapterModules = new Set([
    'react-native-keychain',
    '@react-native-ml-kit/text-recognition',
  ]);
  const harmonyResolveRequest = merged.resolver.resolveRequest;
  merged.resolver.resolveRequest = (ctx, moduleName, platform) => {
    if (platform === 'harmony' && localAdapterModules.has(moduleName)) {
      return { filePath: adapterFile, type: 'sourceFile' };
    }
    return harmonyResolveRequest(ctx, moduleName, platform);
  };
}

module.exports = merged;
