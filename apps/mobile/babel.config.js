module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
    plugins: [
      // 注意：react-native-reanimated/plugin 必须放在最后
      'react-native-reanimated/plugin',
    ],
  };
};
