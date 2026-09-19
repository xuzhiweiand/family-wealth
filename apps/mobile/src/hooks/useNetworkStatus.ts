/**
 * 网络状态 hook
 *
 * 真机（prebuild 后）用 @react-native-community/netinfo 订阅状态；
 * 在 Expo Go / 未安装原生模块 / Web 上自动降级——
 *   - Web：读 navigator.onLine 并监听 online/offline
 *   - 其余情况：保守认为在线（本地优先架构下不影响读写）
 *
 * 原生模块用 try/lazy require 访问，避免模块缺失时一启动就抛错。
 */

import { useEffect, useState } from 'react';

type NetInfoModule = {
  addEventListener: (
    listener: (state: { isConnected: boolean | null }) => void,
  ) => () => void;
  fetch: () => Promise<{ isConnected: boolean | null }>;
};

let cachedModule: NetInfoModule | null | undefined;

function tryLoadNetInfo(): NetInfoModule | null {
  if (cachedModule !== undefined) return cachedModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-community/netinfo') as NetInfoModule;
    cachedModule = mod;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

function webOnline(): boolean {
  if (typeof navigator !== 'undefined' && 'onLine' in navigator) {
    return navigator.onLine;
  }
  return true;
}

export interface NetworkStatus {
  isConnected: boolean;
  /** 是否来自原生 NetInfo（false = 降级口径） */
  native: boolean;
}

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>(() => {
    const native = tryLoadNetInfo() !== null;
    return { isConnected: native ? true : webOnline(), native };
  });

  useEffect(() => {
    const netinfo = tryLoadNetInfo();
    if (netinfo) {
      let alive = true;
      void netinfo.fetch().then((s) => {
        if (alive) setStatus({ isConnected: s.isConnected ?? true, native: true });
      });
      const unsubscribe = netinfo.addEventListener((s) => {
        setStatus({ isConnected: s.isConnected ?? true, native: true });
      });
      return () => {
        alive = false;
        unsubscribe();
      };
    }

    if (typeof window !== 'undefined' && 'addEventListener' in window) {
      const goOnline = () => setStatus({ isConnected: true, native: false });
      const goOffline = () => setStatus({ isConnected: false, native: false });
      window.addEventListener('online', goOnline);
      window.addEventListener('offline', goOffline);
      return () => {
        window.removeEventListener('online', goOnline);
        window.removeEventListener('offline', goOffline);
      };
    }
    return undefined;
  }, []);

  return status;
}
