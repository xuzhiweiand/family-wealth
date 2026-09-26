# RNOH 应用侧原生桥接：构建 librnoh_app.so
# napi 模块名 "rnoh_app" 注册于框架的 RNOHAppNapiBridge.cpp（该文件不编入 rnoh_core，
# 必须由应用侧编译进 librnoh_app.so，否则运行时报 libRNOHApp is undefined）
# 结构对齐 RNOH 0.77 官方 Sample 模板
cmake_minimum_required(VERSION 3.13)
project(rnapp)

set(CMAKE_SKIP_BUILD_RPATH TRUE)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# entry/oh_modules（ohpm 安装 RNOH 的位置）
set(OH_MODULE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../oh_modules")
set(RNOH_CPP_DIR "${OH_MODULE_DIR}/@rnoh/react-native-openharmony/src/main/cpp")

set(CMAKE_ASM_FLAGS "-Wno-error=unused-command-line-argument -Qunused-arguments")
set(CMAKE_CXX_FLAGS "-fstack-protector-strong -Wl,-z,relro,-z,now,-z,noexecstack -s -fPIE -pie")

set(WITH_HITRACE_SYSTRACE 1)
add_compile_definitions(WITH_HITRACE_SYSTRACE)

# RNOH 0.77.74 依赖 @ppd/ffrt（FFRT C++ 封装，header-only）：
# 框架 CMake 以 ffrt::ffrt_cpp 名称链接，但该目标需由应用侧提供。
# 采用 ffrt 文档的「显式管理」方式：INTERFACE 目标只暴露 include 路径，
# 实际实现在系统 libffrt.z.so（框架同时显式链接该库）。
set(FFRT_DIR "${OH_MODULE_DIR}/@ppd/ffrt")
add_library(ffrt_iface INTERFACE)
target_include_directories(ffrt_iface INTERFACE "${FFRT_DIR}/include")
add_library(ffrt::ffrt_cpp ALIAS ffrt_iface)

# 构建 RNOH 框架（rnoh_core / rnoh_core_package，暴露 INTERFACE 目标 rnoh）
add_subdirectory("${RNOH_CPP_DIR}" ./rn)

# 三方鸿蒙移植包（@react-native-ohos，对齐 RN 0.77）
# NODE_MODULES：仓库根 node_modules（gesture-handler CMake 据此探测 svg 版本）
set(NODE_MODULES "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../../node_modules")
set(OH_MODULES "${OH_MODULE_DIR}")

# 顺序约束：svg 先于 gesture-handler（gh CMake 探测 svg include 目录）
add_subdirectory("${OH_MODULE_DIR}/@react-native-ohos/react-native-reanimated/src/main/cpp" ./ohos-reanimated)
add_subdirectory("${OH_MODULE_DIR}/@react-native-ohos/react-native-safe-area-context/src/main/cpp" ./ohos-safearea)
add_subdirectory("${OH_MODULE_DIR}/@react-native-ohos/react-native-screens/src/main/cpp" ./ohos-screens)
add_subdirectory("${OH_MODULE_DIR}/@react-native-ohos/react-native-svg/src/main/cpp" ./ohos-svg)
add_subdirectory("${OH_MODULE_DIR}/@react-native-ohos/react-native-gesture-handler/src/main/cpp" ./ohos-gh)
add_subdirectory("${OH_MODULE_DIR}/@react-native-ohos/netinfo/src/main/cpp" ./ohos-netinfo)
add_subdirectory("${OH_MODULE_DIR}/@react-native-ohos/datetimepicker/src/main/cpp" ./ohos-datetimepicker)
add_subdirectory("${OH_MODULE_DIR}/@react-native-ohos/react-native-image-picker/src/main/cpp" ./ohos-imagepicker)
add_subdirectory("${OH_MODULE_DIR}/@react-native-ohos/react-native-get-random-values/src/main/cpp" ./ohos-grv)
add_subdirectory("${OH_MODULE_DIR}/@react-native-ohos/async-storage/src/main/cpp" ./ohos-asyncstorage)

# 应用侧桥接库：napi 模块 rnoh_app
add_library(rnoh_app SHARED
    "./PackageProvider.cpp"
    "${RNOH_CPP_DIR}/RNOHAppNapiBridge.cpp"
)
target_link_libraries(rnoh_app PUBLIC
    rnoh
    rnoh_reanimated
    rnoh_safe_area
    rnoh_screens
    rnoh_svg
    rnoh_gesture_handler
    rnoh_netinfo
    rnoh_datetime_picker
    rnoh_image_picker
    rnoh_get_random_values
    rnoh_async_storage
)
