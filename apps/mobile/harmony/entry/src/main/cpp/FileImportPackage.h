//
// 文件导入 TurboModule 的 C++ 转发壳（header-only）。
//
// RNOH 机制：JS 调 TurboModule 时，C++ TurboModuleFactory 先在 ArkTS
// 侧 hasModule 查到实例，再要求 C++ delegate 返回 ArkTSTurboModule
// 包装对象；缺 C++ 侧会直接 Fatal。本文件两者一并提供。
//
// 真正的文件选择/读取在 ArkTS 侧（DocumentViewPicker 选择模式）完成，
// 此处只做方法元数据声明。异步方法必须用 ARK_ASYNC_METHOD_METADATA。
//
#pragma once

#include "RNOH/Package.h"
#include "RNOH/ArkTSTurboModule.h"

namespace rnoh {

class FileImportTurboModule : public ArkTSTurboModule {
  public:
    FileImportTurboModule(const ArkTSTurboModule::Context ctx, const std::string name)
        : ArkTSTurboModule(ctx, name) {
      methodMap_ = {
          ARK_ASYNC_METHOD_METADATA(pickFileWithPicker, 0),
      };
    }
};

class FileImportPackage : public Package {
  public:
    FileImportPackage(Package::Context ctx) : Package(ctx) {}

    std::unique_ptr<TurboModuleFactoryDelegate> createTurboModuleFactoryDelegate() override {
      class Delegate : public TurboModuleFactoryDelegate {
        SharedTurboModule createTurboModule(Context ctx, const std::string &name) const override {
          if (name == "FileImport") {
            return std::make_shared<FileImportTurboModule>(ctx, name);
          }
          return nullptr;
        }
      };
      return std::make_unique<Delegate>();
    }
};

} // namespace rnoh
