# Argon2 reference implementation (P-H-C, CC0 / Apache 2.0) behind a tiny JNI
# entry point. Built from source with the app's NDK so the library is aligned
# for 16 KB memory pages (required by Google Play for Android 15+).
cmake_minimum_required(VERSION 3.22)
project(bsnative C)

add_library(bsnative SHARED
  bsnative_jni.c
  argon2/src/argon2.c
  argon2/src/core.c
  argon2/src/encoding.c
  argon2/src/ref.c
  argon2/src/thread.c
  argon2/src/blake2/blake2b.c
)
target_include_directories(bsnative PRIVATE argon2/include argon2/src)
# One lane only (parallelism 1): no threads are ever started.
target_compile_definitions(bsnative PRIVATE ARGON2_NO_THREADS)
target_compile_options(bsnative PRIVATE -O3 -fvisibility=hidden)
target_link_options(bsnative PRIVATE "-Wl,-z,max-page-size=16384")
