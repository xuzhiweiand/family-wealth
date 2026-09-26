//
// 原生 PBKDF2 TurboModule 的 C++ 转发壳（header-only）。
//
// RNOH 机制：JS 调 TurboModule 时，C++ TurboModuleFactory 先在 ArkTS
// 侧 hasModule 查到实例，再要求 C++ delegate 返回 ArkTSTurboModule
// 包装对象；缺 C++ 侧会直接 Fatal。本文件两者一并提供。
//
// 真正的 PBKDF2 运算在 ArkTS 侧（cryptoFramework）完成，此处只做
// 方法元数据声明。方法名/参数个数必须与 ArkTS 类及 JS 调用一致。
//
#pragma once

#include "RNOH/Package.h"
#include "RNOH/ArkTSTurboModule.h"

namespace rnoh {

class CryptoPbkdf2TurboModule : public ArkTSTurboModule {
  public:
    CryptoPbkdf2TurboModule(const ArkTSTurboModule::Context ctx, const std::string name)
        : ArkTSTurboModule(ctx, name) {
      methodMap_ = {
          ARK_ASYNC_METHOD_METADATA(derive, 4),
      };
    }
};

class CryptoPbkdf2Package : public Package {
  public:
    CryptoPbkdf2Package(Package::Context ctx) : Package(ctx) {}

    std::unique_ptr<TurboModuleFactoryDelegate> createTurboModuleFactoryDelegate() override {
      class Delegate : public TurboModuleFactoryDelegate {
        SharedTurboModule createTurboModule(Context ctx, const std::string &name) const override {
          if (name == "CryptoPbkdf2") {
            return std::make_shared<CryptoPbkdf2TurboModule>(ctx, name);
          }
          return nullptr;
        }
      };
      return std::make_unique<Delegate>();
    }
};

} // namespace rnoh
