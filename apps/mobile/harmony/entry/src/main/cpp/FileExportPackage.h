//
// 文件导出 TurboModule 的 C++ 转发壳（header-only）。
//
// RNOH 机制：JS 调 TurboModule 时，C++ TurboModuleFactory 先在 ArkTS
// 侧 hasModule 查到实例，再要求 C++ delegate 返回 ArkTSTurboModule
// 包装对象；缺 C++ 侧会直接 Fatal。本文件两者一并提供。
//
// 真正的保存逻辑在 ArkTS 侧（DocumentViewPicker + fileIo）完成，
// 此处只做方法元数据声明。方法名/参数个数必须与 ArkTS 类及 JS 调用一致。
// async/Promise 方法必须用 ARK_ASYNC_METHOD_METADATA（误用同步元数据会
// 走同步路径导致 ArkTS async 方法执行异常）。
//
#pragma once

#include "RNOH/Package.h"
#include "RNOH/ArkTSTurboModule.h"

namespace rnoh {

class FileExportTurboModule : public ArkTSTurboModule {
  public:
    FileExportTurboModule(const ArkTSTurboModule::Context ctx, const std::string name)
        : ArkTSTurboModule(ctx, name) {
      methodMap_ = {
          ARK_ASYNC_METHOD_METADATA(saveFileWithPicker, 2),
      };
    }
};

class FileExportPackage : public Package {
  public:
    FileExportPackage(Package::Context ctx) : Package(ctx) {}

    std::unique_ptr<TurboModuleFactoryDelegate> createTurboModuleFactoryDelegate() override {
      class Delegate : public TurboModuleFactoryDelegate {
        SharedTurboModule createTurboModule(Context ctx, const std::string &name) const override {
          if (name == "FileExport") {
            return std::make_shared<FileExportTurboModule>(ctx, name);
          }
          return nullptr;
        }
      };
      return std::make_unique<Delegate>();
    }
};

} // namespace rnoh
