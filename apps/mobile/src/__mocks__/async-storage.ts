/**
 * AsyncStorage 的内存实现，仅供 jest 单测使用。
 * 设备上由 metro resolveRequest 将 '@react-native-async-storage/async-storage'
 * 映射到鸿蒙/Android 真包（见 metro.config.js）。
 */

const store = new Map<string, string>();

const AsyncStorage = {
  getItem: jest.fn(async (key: string): Promise<string | null> => store.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string): Promise<void> => {
    store.set(key, value);
  }),
  removeItem: jest.fn(async (key: string): Promise<void> => {
    store.delete(key);
  }),
  clear: jest.fn(async (): Promise<void> => {
    store.clear();
  }),
  /** 测试辅助：重置全部内容与调用记录 */
  __reset(): void {
    store.clear();
    jest.clearAllMocks();
  },
};

export default AsyncStorage;
