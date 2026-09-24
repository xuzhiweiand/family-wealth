// bare RN：dotenv 加载 .env（EXPO_PUBLIC_* 历史命名保持不变），
// transform-inline-environment-variables 在编译期内联 process.env，
// 使 src/services/supabase.ts 的 process.env.EXPO_PUBLIC_* 零改动可用。
require('dotenv').config();

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['@react-native/babel-preset'],
    plugins: [
      'transform-inline-environment-variables',
      // Tamagui 编译器
      // optimize 必须关闭：开启后静态视图抽取/扁平化会在 Paper（旧桥）架构下
      // 产生 view tag 失配，原生崩溃 "Trying to add unknown view tag"
      [
        '@tamagui/babel-plugin',
        {
          config: './tamagui.config.ts',
          components: ['tamagui'],
          optimize: false,
        },
      ],
      // Reanimated 必须放最后
      'react-native-reanimated/plugin',
    ],
  };
};
