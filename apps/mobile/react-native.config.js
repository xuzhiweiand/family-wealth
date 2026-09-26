/**
 * RN 0.77 autolinking 覆盖。
 *
 * 1. react-native-reanimated：本项目不直接/间接执行 reanimated，
 *    其 CMake/Ninja 在 Windows 上按绝对路径镜像生成深层目录，
 *    未开启 LongPathsEnabled 时稳定超 MAX_PATH(260) 导致 buildCMakeDebug 失败。
 *    排除后不影响 App 功能。
 *
 * 2. @react-native-ohos/*：这些是 HarmonyOS 移植包，内部同样包含
 *    android/ ios/ 目录（为了兼容多平台），在 Android 构建时会被
 *    autolink 插件同时纳入，导致与原版包（如 react-native-screens）
 *    的 org.linusu.BuildConfig 等类重复定义冲突。
 *    在 Android/iOS 构建中排除 ohos 包，鸿蒙构建不受影响。
 */
const ohosPackages = [
  '@react-native-ohos/async-storage',
  '@react-native-ohos/datetimepicker',
  '@react-native-ohos/netinfo',
  '@react-native-ohos/react-native-gesture-handler',
  '@react-native-ohos/react-native-get-random-values',
  '@react-native-ohos/react-native-image-picker',
  '@react-native-ohos/react-native-reanimated',
  '@react-native-ohos/react-native-safe-area-context',
  '@react-native-ohos/react-native-screens',
  '@react-native-ohos/react-native-svg',
];

const dependencies = {
  'react-native-reanimated': {
    platforms: {
      android: null,
      ios: null,
    },
  },
};

for (const pkg of ohosPackages) {
  dependencies[pkg] = {
    platforms: {
      android: null,
      ios: null,
    },
  };
}

module.exports = {
  dependencies,
};
