//
// 月末盘点提醒 TurboModule 的 C++ 转发壳（header-only）。
//
// RNOH 机制：JS 调 TurboModule 时，C++ TurboModuleFactory 先在 ArkTS
// 侧 hasModule 查到实例，再要求 C++ delegate 返回 ArkTSTurboModule
// 包装对象；缺 C++ 侧会直接 Fatal。本文件两者一并提供。
//
// 真正的提醒调度在 ArkTS 侧（reminderAgentManager）完成，此处只做
// 方法元数据声明。方法名/参数个数必须与 ArkTS 类及 JS 调用一致。
//
#pragma once

#include "RNOH/Package.h"
#include "RNOH/ArkTSTurboModule.h"

namespace rnoh {

class ReminderAgentTurboModule : public ArkTSTurboModule {
  public:
    ReminderAgentTurboModule(const ArkTSTurboModule::Context ctx, const std::string name)
        : ArkTSTurboModule(ctx, name) {
      methodMap_ = {
          ARK_ASYNC_METHOD_METADATA(publishCalendarReminder, 5),
          ARK_ASYNC_METHOD_METADATA(cancelReminder, 1),
          ARK_ASYNC_METHOD_METADATA(cancelAllReminders, 0),
          ARK_ASYNC_METHOD_METADATA(requestCalendarPermission, 0),
          ARK_ASYNC_METHOD_METADATA(checkCalendarPermission, 0),
          ARK_ASYNC_METHOD_METADATA(getScheduledReminders, 0),
      };
    }
};

class ReminderAgentPackage : public Package {
  public:
    ReminderAgentPackage(Package::Context ctx) : Package(ctx) {}

    std::unique_ptr<TurboModuleFactoryDelegate> createTurboModuleFactoryDelegate() override {
      class Delegate : public TurboModuleFactoryDelegate {
        SharedTurboModule createTurboModule(Context ctx, const std::string &name) const override {
          if (name == "ReminderAgent") {
            return std::make_shared<ReminderAgentTurboModule>(ctx, name);
          }
          return nullptr;
        }
      };
      return std::make_unique<Delegate>();
    }
};

} // namespace rnoh
