/// <reference types="expo/types" />

// 注意：env 变量注入由 Expo 在构建时处理，运行时通过 process.env.EXPO_PUBLIC_* 读取
declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_SUPABASE_URL?: string;
    EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
    EXPO_PUBLIC_SENTRY_DSN?: string;
    EXPO_PUBLIC_POSTHOG_API_KEY?: string;
    EXPO_PUBLIC_POSTHOG_HOST?: string;
    APP_ENV?: 'development' | 'staging' | 'production';
  }
}
