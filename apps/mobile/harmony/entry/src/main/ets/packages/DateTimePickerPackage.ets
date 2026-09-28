/**
 * 鸿蒙 DateTimePicker 组件包（ArkTS 侧注册）
 *
 * 背景：@react-native-ohos/datetimepicker 只提供了原生组件 RNDateTimePicker，
 * 但未提供 RNOHPackage（库未迁移到 autolinking）。仅 C++ 侧 PackageProvider
 * 注册会导致组件宿主 Stack 挂载但内部为空（页面表现为点日期无反应）。
 *
 * 按 RNOH 0.77 规范在此用 RNOHPackage + wrapBuilder 手动注册组件。
 */

import {
  RNOHPackage,
  ComponentBuilderContext,
} from '@rnoh/react-native-openharmony';
import {
  RNDateTimePicker,
  DATETIME_PICKER_VIEW_TYPE,
} from '@react-native-ohos/datetimepicker';

@Builder
function buildRNDateTimePicker(ctx: ComponentBuilderContext) {
  RNDateTimePicker({
    ctx: ctx.rnohContext,
    tag: ctx.descriptor.tag,
  });
}

export class DateTimePickerPackage extends RNOHPackage {
  createWrappedCustomRNComponentBuilderByComponentNameMap(): Map<
    string,
    WrappedBuilder<[ComponentBuilderContext]>
  > {
    const map = new Map<string, WrappedBuilder<[ComponentBuilderContext]>>();
    map.set(
      DATETIME_PICKER_VIEW_TYPE,
      wrapBuilder(buildRNDateTimePicker),
    );
    return map;
  }
}
