//
// RNOH 三方包注册
//
#include "RNOH/PackageProvider.h"

#include "ReanimatedPackage.h"
#include "SafeAreaViewPackage.h"
#include "ScreensPackage.h"
#include "SVGPackage.h"
#include "GestureHandlerPackage.h"
#include "RNCNetInfoPackage.h"
#include "DateTimePickerPackage.h"
#include "RNImagePickerPackage.h"
#include "GetRandomValuesPackage.h"
#include "AsyncStoragePackage.h"

using namespace rnoh;

std::vector<std::shared_ptr<Package>> PackageProvider::getPackages(Package::Context ctx) {
    return {
        std::make_shared<ReanimatedPackage>(ctx),
        std::make_shared<SafeAreaViewPackage>(ctx),
        std::make_shared<ScreensPackage>(ctx),
        std::make_shared<SVGPackage>(ctx),
        std::make_shared<GestureHandlerPackage>(ctx),
        std::make_shared<RNCNetInfoPackage>(ctx),
        std::make_shared<DateTimePickerPackage>(ctx),
        std::make_shared<RNImagePickerPackage>(ctx),
        std::make_shared<GetRandomValuesPackage>(ctx),
        std::make_shared<AsyncStoragePackage>(ctx),
    };
}
