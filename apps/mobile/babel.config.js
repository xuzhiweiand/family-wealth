// bare RN：dotenv 加载 .env（EXPO_PUBLIC_* 历史命名保持不变），
// transform-inline-environment-variables 在编译期内联 process.env，
// 使 src/services/supabase.ts 的 process.env.EXPO_PUBLIC_* 零改动可用。
require('dotenv').config();

// 鸿蒙打包时 babel 由 metro 以 --platform harmony 调起；
// reanimated 4（@react-native-ohos）必须配套其自带插件，否则 worklet
// 按 3.x 插件编译、4.x 运行时初始化不兼容。
const isHarmony =
  process.env.RN_PLATFORM === 'harmony' ||
  process.argv.some((a) => a.includes('harmony'));

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
      // Reanimated 必须放最后。
      // ohos reanimated 3.18.3 仅原生侧，无 babel plugin；直接用原版
      // react-native-reanimated 的 plugin（与 JS 侧版本一致）。
      'react-native-reanimated/plugin',
    ],
  };
};
