import { RNApp } from '@rnoh/react-native-openharmony';

@Entry
@Component
struct Index {
  build() {
    Column() {
      // RNOH 容器：加载 React Native bundle
      RNApp({
        // RN bundle 路径（通过 metro 打包生成）
        bundlePath: 'bundle/index.harmony.bundle',
        // 应用名称（对应 AppRegistry.registerComponent）
        appName: 'familywealth',
        // 初始属性
        initialProps: {}
      })
        .width('100%')
        .height('100%')
    }
    .width('100%')
    .height('100%')
  }
}
