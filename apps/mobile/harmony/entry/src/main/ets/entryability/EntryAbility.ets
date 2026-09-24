import UIAbility from '@ohos.app.ability.UIAbility';
import window from '@ohos.window';
import { RNOHCoreContext } from '@rnoh/react-native-openharmony';

export default class EntryAbility extends UIAbility {
  onCreate(want, launchParam) {
    // RNOH 初始化
    this.rnohCoreContext = new RNOHCoreContext(this.context);
  }

  onDestroy() {
    // 释放资源
  }

  onWindowStageCreate(windowStage: window.WindowStage) {
    // 主窗口创建，加载 RN 页面
    windowStage.loadContent('pages/Index', (err, data) => {
      if (err.code) {
        console.error('Failed to load the content. Cause: %{public}s', JSON.stringify(err) ?? '');
        return;
      }
      console.info('Succeeded in loading the content. Data: %{public}s', JSON.stringify(data) ?? '');
    });
  }

  onWindowStageDestroy() {
    // 主窗口销毁
  }

  onForeground() {
    // Ability 切换到前台
  }

  onBackground() {
    // Ability 切换到后台
  }
}
