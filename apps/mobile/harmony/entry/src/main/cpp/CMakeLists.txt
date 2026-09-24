# RNOH 原生模块 CMake 配置
# 此文件用于构建鸿蒙原生 C++ 代码（RNOH 引擎桥接）

cmake_minimum_required(VERSION 3.16.0)
project(familywealth_rnoh)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# RNOH 头文件路径（由 DevEco Studio / ohpm 自动注入）
# include_directories(${RNOH_INCLUDE_DIRS})

# 源文件
# add_library(familywealth_rnoh SHARED
#     rnoh_bridge.cpp
# )

# 链接 RNOH 库
# target_link_libraries(familywealth_rnoh PUBLIC rnoh)
