//
// 华为账号登录 TurboModule 的 C++ 转发壳（header-only）。
//
// RNOH 机制：JS 调 TurboModule 时，C++ TurboModuleFactory 先在 ArkTS
// 侧 hasModule 查到实例，再要求 C++ delegate 返回 ArkTSTurboModule
// 包装对象；缺 C++ 侧会直接 Fatal。本文件两者一并提供。
//
// 授权流程在 ArkTS 侧（Account Kit AuthenticationController）完成，
// 此处只做方法元数据声明。异步方法必须用 ARK_ASYNC_METHOD_METADATA。
//
#pragma once

#include "RNOH/Package.h"
#include "RNOH/ArkTSTurboModule.h"

namespace rnoh {

class HuaweiAccountTurboModule : public ArkTSTurboModule {
  public:
    HuaweiAccountTurboModule(const ArkTSTurboModule::Context ctx, const std::string name)
        : ArkTSTurboModule(ctx, name) {
      methodMap_ = {
          ARK_ASYNC_METHOD_METADATA(login, 0),
      };
    }
};

class HuaweiAccountPackage : public Package {
  public:
    HuaweiAccountPackage(Package::Context ctx) : Package(ctx) {}

    std::unique_ptr<TurboModuleFactoryDelegate> createTurboModuleFactoryDelegate() override {
      class Delegate : public TurboModuleFactoryDelegate {
        SharedTurboModule createTurboModule(Context ctx, const std::string &name) const override {
          if (name == "HuaweiAccount") {
            return std::make_shared<HuaweiAccountTurboModule>(ctx, name);
          }
          return nullptr;
        }
      };
      return std::make_unique<Delegate>();
    }
};
} // namespace rnoh
