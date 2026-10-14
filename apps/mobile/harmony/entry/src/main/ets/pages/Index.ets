import common from '@ohos.app.ability.common';
import {
  RNApp,
  RNPackage,
  RNPackageContext,
  RNInstanceOptions,
  RNOHCoreContext,
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
// 应用自带：原生 PBKDF2（见 entry/src/main/ets/turbo）
import { CryptoPbkdf2Package } from '../turbo/CryptoPbkdf2Package';
// 应用自带：月末盘点提醒（见 entry/src/main/ets/turbo）
import { ReminderAgentPackage } from '../turbo/ReminderAgentPackage';
// 应用自带：文件导出「另存为」（见 entry/src/main/ets/turbo）
import { FileExportPackage } from '../turbo/FileExportPackage';
import { FileImportPackage } from '../turbo/FileImportPackage';
// 应用自带：库未提供 RNOHPackage，手动注册 DateTimePicker 组件
import { DateTimePickerPackage } from '../packages/DateTimePickerPackage';

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
  // RNAbility 启动时把 RNOHCoreContext 注入 AppStorage，页面借此拿到
  // dispatchBackPress（见官方脚手架 EntryIndex 模板）。
  @StorageLink('RNOHCoreContext') private rnohCoreContext: RNOHCoreContext | undefined = undefined;
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
          new CryptoPbkdf2Package(ctx),
          new ReminderAgentPackage(ctx),
          new FileExportPackage(ctx),
          new FileImportPackage(ctx),
          new DateTimePickerPackage(ctx),
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

  // 系统返回（左右边缘横滑手势 / 三键返回键）：先派发给 RN。
  // React Navigation 在二级页面会消费该事件并 pop 回上一页；
  // 只有导航栈为空（已在首页）时 RNOH 才走默认行为（回桌面）。
  // 不拦截的话，任何页面横滑都会被系统直接退到桌面。
  onBackPress(): boolean {
    if (this.rnohCoreContext) {
      this.rnohCoreContext.dispatchBackPress();
      return true;
    }
    return false;
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
