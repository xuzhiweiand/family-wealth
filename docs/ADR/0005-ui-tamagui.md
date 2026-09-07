# ADR-0005: UI 实现选择 Tamagui 而非 NativeWind v4

**状态**: Accepted  
**日期**: 2026-09-07  
**决策人**: 用户 + WorkBuddy  
**对应技术方案**: §21 D1

## 背景

RN 应用需选 UI 实现方案。候选：

- **Tamagui** — 编译时静态优化 + 跨平台（web/native）+ theme tokens
- **NativeWind v4** — Tailwind 风格 utility class + 运行时

## 决策

**采用 Tamagui**。

## 评估

| 维度 | Tamagui | NativeWind v4 | 倾向 |
|---|---|---|---|
| 性能（动画/列表） | ⭐⭐⭐⭐⭐ 编译时静态分析 | ⭐⭐⭐ 运行时 | Tamagui |
| 主题/设计系统 | design tokens 体系，SSR 友好 | className 拼装 | Tamagui |
| 包体积 | 编译器裁剪 | 全部 utility 进 bundle | Tamagui |
| 学习曲线 | ⭐⭐⭐ 概念稍多（theme/styled/Slot） | ⭐⭐⭐⭐ 开发者熟悉 | NativeWind |
| Web 兼容（未来） | ✅ 一次写跨端 | ✅ | 平 |
| 生态成熟度 | 2024-2025 高速发展，文档完善 | Tailwind 复用度高 | 平 |

## 理由

1. **性能基线**——金融 App 长列表是核心场景，60fps 是硬指标，编译时静态化优势明显
2. **设计系统早建**——金融产品对色彩、圆角、间距一致性要求高，design tokens 后续扩鸿蒙版可复用
3. **不影响构建复杂度**——Tamagui 编译器 babel plugin 配置一次，复用 RN babel.config.js

## 折中

- 接受学习曲线，所有组件统一 `styled()` 写法 + theme tokens
- 招新同学前在 `docs/runbook/ui-style.md` 写 1 页速查表

## 后果

- ✅ 编译产物小、动画流畅
- ✅ 设计 token 可复用到未来 web 端
- ⚠️ 项目必须配 `tamagui.config.ts` 与 babel plugin
- ⚠️ 部分三方库组件需包一层 styled 适配

## 验证

- W2 末在 `apps/mobile/app/index.tsx` 改写为 Tamagui 组件并通过 typecheck