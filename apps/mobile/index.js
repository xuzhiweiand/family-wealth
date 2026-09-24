/**
 * 应用入口（bare RN）
 *
 * require 顺序即模块求值顺序，不得调整：
 * 1. react-native-get-random-values —— @noble/hashes/crypto 在模块加载时
 *    一次性捕获 globalThis.crypto，polyfill 必须先于一切间接引用 noble
 *    的模块求值（沿用 entry.js 的时序约束）。
 * 2. react-native-gesture-handler —— 官方要求在入口最顶部加载。
 */
require('react-native-get-random-values');
// Hermes 不实现 URL.protocol（supabase-js 构造时依赖），
// 原由 Expo 运行时 polyfill，bare RN 下显式引入。
require('react-native-url-polyfill/auto');
// Hermes 不实现 TextEncoder/TextDecoder（@family-wealth/crypto 的
// envelope 编解码、sync codec 在模块加载与运行时都依赖），
// 原由 Expo winter 运行时 polyfill，缺失时解密静默失败
// （deserializeWrappedFDK 返回 null → recoverKeys 报 wrapped fdk malformed
// → FDK 缺失 → syncNow 静默跳过，表现为「登录后云端数据为空」）。
require('fast-text-encoding');
require('react-native-gesture-handler');

const { AppRegistry } = require('react-native');
const App = require('./App').default;

AppRegistry.registerComponent('familywealth', () => App);
