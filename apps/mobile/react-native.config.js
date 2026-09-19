/**
 * RN 0.76 autolinking 覆盖。
 *
 * 为什么排除 react-native-reanimated：
 * 本项目代码不直接/间接执行 reanimated（expo-router 将其列为 optional peer，
 * 全应用唯一的 require 位于 testing-library/jest mock，不会进 bundle；
 * native-stack 走 react-native-screens 的原生动画）。
 * 而 reanimated 3.16 的 CMake/Ninja 在 Windows 上会按绝对路径镜像生成
 * .cxx/.../C_/Users/<user>/WorkBuddy/2026-09-05-14-35-28/... 深层目录，
 * 在未开启系统 LongPathsEnabled 的机器上稳定超过 MAX_PATH(260) 导致
 * buildCMakeDebug 失败。排除 autolinking 后不编译其 C++，不影响 App 功能。
 * 若日后启用 reanimated 动画：开启 Windows 长路径支持后移除此文件。
 */
module.exports = {
  dependencies: {
    'react-native-reanimated': {
      platforms: {
        android: null,
        ios: null,
      },
    },
  },
};
