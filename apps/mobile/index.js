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
require('react-native-gesture-handler');

const { AppRegistry } = require('react-native');
const App = require('./App').default;

AppRegistry.registerComponent('familywealth', () => App);
