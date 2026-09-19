/**
 * 自定义入口
 *
 * 必须先于任何间接引用 @noble/* 的模块求值：
 * @noble/hashes/crypto 在模块加载时一次性捕获 globalThis.crypto，
 * 而 expo-router 按路由树加载，(tabs) 组（其 stores 间接引入 noble）
 * 的求值早于根 _layout —— 所以 polyfill 放在 _layout 顶部仍可能太晚。
 * 在入口最前面 require 可保证全局 crypto 先就位。
 */
require('react-native-get-random-values');
require('expo-router/entry');
