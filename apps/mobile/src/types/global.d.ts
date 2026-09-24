/**
 * bare RN 下的 process.env 最小类型声明
 * （原由 expo-env.d.ts 经 expo/types 提供；babel 插件
 * transform-inline-environment-variables 编译期内联，运行时无 process）。
 */
declare var process: {
  env: Record<string, string | undefined>;
};
