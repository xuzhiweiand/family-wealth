import common from '@ohos.app.ability.common';
import {
  RNApp,
  RNPackage,
  RNPackageContext,
  RNInstanceOptions,
  ResourceJSBundleProvider,
} from '@rnoh/react-native-openharmony';

/**
 * RN 容器页。
 * - RNInstanceOptions（managed 模式）：由 RNOH 内部创建/销毁 RNInstance
 * - ResourceJSBundleProvider：从 rawfile 加载 metro 预打包的 harmony bundle
 * - appKey 与 index.js 中 AppRegistry.registerComponent 一致
 */
@Entry
@Component
struct Index {
  @State private isReady: boolean = false;
  private rnInstanceConfig: RNInstanceOptions | null = null;
  private jsBundleProvider: ResourceJSBundleProvider | null = null;

  aboutToAppear(): void {
    const uiContext: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
    this.rnInstanceConfig = {
      // 三方原生 RNOHPackage 在此注册；当前依赖均走 JS 平台 shim，无需原生包
      createRNPackages: (_ctx: RNPackageContext): RNPackage[] => {
        return [];
      },
    };
    this.jsBundleProvider = new ResourceJSBundleProvider(
      uiContext.resourceManager,
      'bundle/index.harmony.bundle',
      ['familywealth']
    );
    this.isReady = true;
  }

  build() {
    Column() {
      if (this.isReady) {
        RNApp({
          rnInstanceConfig: this.rnInstanceConfig!,
          appKey: 'familywealth',
          jsBundleProvider: this.jsBundleProvider!,
        })
          .width('100%')
          .height('100%')
      }
    }
    .width('100%')
    .height('100%')
  }
}
