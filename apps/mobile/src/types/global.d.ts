/**
 * bare RN 下的 process.env 最小类型声明
 * （原由 expo-env.d.ts 经 expo/types 提供；babel 插件
 * transform-inline-environment-variables 编译期内联，运行时无 process）。
 */
declare var process: {
  env: Record<string, string | undefined>;
};

/**
 * 本项目只安装鸿蒙移植包 @react-native-ohos/async-storage（其 package.json
 * 用 harmony.alias 声明了原名；metro harmony 解析时自动重定向，见
 * @react-native-oh/react-native-harmony 的 alias 机制）。
 * 类型层补同名模块声明、复用移植包类型；Android 端另装原包时此声明
 * 仅在 harmony 构建路径被命中（d.ts 不影响运行时解析）。
 */
declare module '@react-native-async-storage/async-storage' {
  export { default } from '@react-native-ohos/async-storage';
  export * from '@react-native-ohos/async-storage';
}
