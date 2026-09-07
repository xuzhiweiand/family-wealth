module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Tamagui 编译器：RN 端必须加，web 端可选
      [
        '@tamagui/babel-plugin',
        {
          config: './tamagui.config.ts',
          components: ['tamagui'],
          optimize: true,
        },
      ],
      // Reanimated 必须放最后
      'react-native-reanimated/plugin',
    ],
  };
};