module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
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