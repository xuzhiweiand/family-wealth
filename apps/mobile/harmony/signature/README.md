# 鸿蒙签名文件存放目录

此目录用于存放鸿蒙应用签名所需的安全文件，**已加入 .gitignore，不会提交到版本库**。

## 所需文件

| 文件 | 说明 | 获取方式 |
|------|------|----------|
| `familywealth.p12` | 密钥库文件（PKCS12 格式） | DevEco Studio → Build → Generate Key and CSR |
| `familywealth.cer` | 数字证书 | 华为开发者联盟 → 证书管理 |
| `familywealth.p7b` | 签名后的 Profile 文件 | 华为开发者联盟 → Profile 管理 |

## 配置步骤

1. 在 [华为开发者联盟](https://developer.huawei.com/consumer/cn/) 创建应用
2. 生成密钥库和 CSR（DevEco Studio 内置工具）
3. 上传 CSR 获取数字证书（.cer）
4. 创建 Profile 并下载（.p7b）
5. 将三个文件放入本目录
6. 确认 `build-profile.json5` 中的 `signingConfigs` 配置正确

## 参考文档

- [HarmonyOS 签名指南](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-signing)
- [RNOH 官方文档](https://gitee.com/openharmony-sig/react-native-harmony)
