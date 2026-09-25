import { RNAbility } from '@rnoh/react-native-openharmony';

/**
 * 应用入口。
 * RNAbility 负责创建 RNOHCoreContext、RNInstancesCoordinator、窗口与生命周期管理，
 * 并把 RNOHCoreContext 注入 AppStorage 供 RNApp 使用。
 */
export default class EntryAbility extends RNAbility {
  protected getPagePath(): string {
    return 'pages/Index';
  }
}
