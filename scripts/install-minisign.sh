#!/usr/bin/env bash
set -euo pipefail
# Ubuntu 22.04 没有 minisign 包；从固定的官方 Git 提交构建，避免依赖浮动下载的可执行文件。
revision=03ebc0dafb08a77e0548e9cbc4668a3588128de5
build_dir=$(mktemp -d)
trap 'rm -rf "$build_dir"' EXIT
git -C "$build_dir" init --quiet
git -C "$build_dir" fetch --quiet --depth 1 https://github.com/jedisct1/minisign.git "$revision"
git -C "$build_dir" checkout --quiet --detach FETCH_HEAD
test "$(git -C "$build_dir" rev-parse HEAD)" = "$revision"
cmake -S "$build_dir" -B "$build_dir/build" -DCMAKE_BUILD_TYPE=Release
cmake --build "$build_dir/build" --parallel 2
install -m 755 "$build_dir/build/minisign" "${1:?请提供可执行文件的安装目录}/minisign"
