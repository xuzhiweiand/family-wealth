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

# 构建 RNOH 框架（rnoh_core / rnoh_core_package，暴露 INTERFACE 目标 rnoh）
add_subdirectory("${RNOH_CPP_DIR}" ./rn)

# 应用侧桥接库：napi 模块 rnoh_app
add_library(rnoh_app SHARED
    "./PackageProvider.cpp"
    "${RNOH_CPP_DIR}/RNOHAppNapiBridge.cpp"
)
target_link_libraries(rnoh_app PUBLIC rnoh)
