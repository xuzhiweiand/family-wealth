/** @type {import('jest').Config} */
// 盘点口径按用户本地时区判定；固定时区保证 CI（常为 UTC）下断言稳定
process.env.TZ = 'Asia/Shanghai';

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js'],
  // 设备上由 metro resolveRequest 映射到鸿蒙 fork；测试用内存实现
  moduleNameMapper: {
    '^@react-native-async-storage/async-storage$': '<rootDir>/src/__mocks__/async-storage.ts',
  },
};
