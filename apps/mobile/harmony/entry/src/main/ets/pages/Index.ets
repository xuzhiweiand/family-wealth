import common from '@ohos.app.ability.common';
import {
  RNApp,
  RNPackage,
  RNPackageContext,
  RNInstanceOptions,
  ResourceJSBundleProvider,
} from '@rnoh/react-native-openharmony';

// 三方鸿蒙原生包的 ArkTS 侧 Package（提供 TurboModule / 原生组件构建器）。
// 必须在此注册，否则 C++ 侧创建 TurboModule 时会报
// "Couldn't find Turbo Module on the ArkTs side"。
import { ReanimatedPackage } from '@react-native-ohos/react-native-reanimated/src/main/ets/ReanimatedPackage';
import { SafeAreaViewPackage } from '@react-native-ohos/react-native-safe-area-context/src/main/ets/SafeAreaViewPackage';
import ScreensPackage from '@react-native-ohos/react-native-screens';
import { SvgPackage } from '@react-native-ohos/react-native-svg/src/main/ets/SvgPackage';
import GestureHandlerPackage from '@react-native-ohos/react-native-gesture-handler';
import NetInfoPackage from '@react-native-ohos/netinfo';
import ImagePickerPackage from '@react-native-ohos/react-native-image-picker';
import GetRandomValuesPackage from '@react-native-ohos/react-native-get-random-values';
import { AsyncStoragePackage } from '@react-native-ohos/async-storage/src/main/ets/AsyncStoragePackage';

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
      // 三方原生 RNOHPackage 在此注册（ArkTS 侧），与 C++ PackageProvider 对应。
      createRNPackages: (ctx: RNPackageContext): RNPackage[] => {
        return [
          new ReanimatedPackage(ctx),
          new SafeAreaViewPackage(ctx),
          new ScreensPackage(ctx),
          new SvgPackage(ctx),
          new GestureHandlerPackage(ctx),
          new NetInfoPackage(ctx),
          new ImagePickerPackage(ctx),
          new GetRandomValuesPackage(ctx),
          new AsyncStoragePackage(ctx),
        ];
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
