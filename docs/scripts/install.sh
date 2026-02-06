#!/bin/bash

set -euo pipefail
IFS=$'\n\t'

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

print_info() {
    echo -e "${GREEN}[信息] $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}[警告] $1${NC}"
}

print_error() {
    echo -e "${RED}[错误] $1${NC}"
}

exit_on_error() {
    print_error "$1"
    exit 1
}

trap 'print_error "脚本发生未处理错误，请检查输出"; exit 1' ERR

COMMAND=""
REQUESTED_VERSION="${GP_VERSION:-latest}"
BUNDLED_NODE_VERSION="${GP_NODE_VERSION:-v20.11.0}"
REQUIRED_NODE_VERSION=20
PNPM_VERSION=9.0.0
PROJECT_REPO="MortarHQ/GhostPing"
MANIFEST_URL="https://raw.githubusercontent.com/${PROJECT_REPO}/master/docs/releases/versions.json"
CURRENT_DIR="$(pwd)"
INSTALL_ROOT="${CURRENT_DIR}/ghostping"
NODE_ROOT="${INSTALL_ROOT}/node"
VERSIONS_ROOT="${INSTALL_ROOT}/versions"
MANIFEST_CACHE="${INSTALL_ROOT}/versions.json"

print_usage() {
    cat <<EOF
用法:
  bash install.sh [start|dev] [-v|--version <version|latest>] [-n|--node-version <nodeVersion>]

参数:
  start|dev                 可选，安装完成后直接启动
  -v, --version             指定 GhostPing 版本，默认 latest
  -n, --node-version        指定 Node 版本，默认 v20.11.0
  -h, --help                显示此帮助
EOF
}

parse_args() {
    while [ "$#" -gt 0 ]; do
        case "$1" in
            start|dev)
                if [ -n "${COMMAND}" ]; then
                    exit_on_error "命令重复：${COMMAND} 与 $1"
                fi
                COMMAND="$1"
                shift
                ;;
            -v|--version)
                [ "$#" -ge 2 ] || exit_on_error "$1 缺少版本参数"
                REQUESTED_VERSION="$2"
                shift 2
                ;;
            -n|--node-version)
                [ "$#" -ge 2 ] || exit_on_error "$1 缺少 Node 版本参数"
                BUNDLED_NODE_VERSION="$2"
                shift 2
                ;;
            -h|--help)
                print_usage
                exit 0
                ;;
            *)
                exit_on_error "未知参数: $1"
                ;;
        esac
    done
}

parse_args "$@"

if [[ "${BUNDLED_NODE_VERSION}" != v* ]]; then
    BUNDLED_NODE_VERSION="v${BUNDLED_NODE_VERSION}"
fi

print_info "此脚本将创建目录：${INSTALL_ROOT}"
mkdir -p "${INSTALL_ROOT}" "${NODE_ROOT}" "${VERSIONS_ROOT}"

case "$(uname -s)" in
Linux*) OS=linux ;;
Darwin*) OS=darwin ;;
*) exit_on_error "不支持的操作系统。" ;;
esac

ARCH="$(uname -m)"
case "${ARCH}" in
x86_64|amd64) NODE_ARCH=x64 ;;
arm64|aarch64) NODE_ARCH=arm64 ;;
*)
    print_warning "未知架构 ${ARCH}，默认使用 x64"
    NODE_ARCH=x64
    ;;
esac

NODE_DIR="${NODE_ROOT}/node-${BUNDLED_NODE_VERSION}-${OS}-${NODE_ARCH}"

for tool in curl unzip; do
    if ! command -v "${tool}" >/dev/null 2>&1; then
        exit_on_error "缺少依赖：${tool}，请先安装后重试。"
    fi
done

USE_SYSTEM_NODE=false
if command -v node >/dev/null 2>&1; then
    NODE_VERSION="$(node -v)"
    VERSION_NUMBER="${NODE_VERSION#v}"
    MAJOR_VERSION="$(echo "${VERSION_NUMBER}" | cut -d. -f1)"
    print_info "检测到系统 Node.js ${NODE_VERSION}"
    if [ "${MAJOR_VERSION}" -ge "${REQUIRED_NODE_VERSION}" ]; then
        USE_SYSTEM_NODE=true
    else
        print_warning "系统 Node.js 低于推荐版本 v${REQUIRED_NODE_VERSION}"
        read -r -p "是否继续使用系统 Node.js？(y/n): " CONTINUE_WITH_SYSTEM_NODE
        if [[ "${CONTINUE_WITH_SYSTEM_NODE}" =~ ^[Yy]$ ]]; then
            USE_SYSTEM_NODE=true
        fi
    fi
fi

if [ "${USE_SYSTEM_NODE}" = false ]; then
    if [ ! -d "${NODE_DIR}" ]; then
        print_info "下载 Node.js ${BUNDLED_NODE_VERSION}..."
        TMP_NODE_ARCHIVE="${NODE_ROOT}/node-${BUNDLED_NODE_VERSION}-${OS}-${NODE_ARCH}.tar.gz"
        curl -fsSL "https://nodejs.org/dist/${BUNDLED_NODE_VERSION}/node-${BUNDLED_NODE_VERSION}-${OS}-${NODE_ARCH}.tar.gz" -o "${TMP_NODE_ARCHIVE}"
        mkdir -p "${NODE_DIR}"
        tar -xzf "${TMP_NODE_ARCHIVE}" -C "${NODE_DIR}" --strip-components=1
        rm -f "${TMP_NODE_ARCHIVE}"
    fi
    export PATH="${NODE_DIR}/bin:${PATH}"
fi

ensure_pnpm() {
    if command -v pnpm >/dev/null 2>&1; then
        print_info "检测到 pnpm $(pnpm -v)"
        return
    fi
    if command -v corepack >/dev/null 2>&1; then
        print_info "启用 Corepack 并安装 pnpm@${PNPM_VERSION}"
        if corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate; then
            return
        fi
    fi
    if ! command -v npm >/dev/null 2>&1; then
        exit_on_error "未找到 npm，无法安装 pnpm。"
    fi
    npm install -g "pnpm@${PNPM_VERSION}" || exit_on_error "安装 pnpm 失败。"
}

ensure_pnpm

print_info "获取版本清单..."
curl -fsSL "${MANIFEST_URL}" -o "${MANIFEST_CACHE}"

RESOLVE_RESULT="$(
    node -e '
const fs = require("fs");
const manifestPath = process.argv[1];
const requested = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const versions = manifest.versions || {};
const request = !requested || requested === "latest" ? manifest.latest : requested;
const candidates = [request];
if (request && request.startsWith("v")) {
  candidates.push(request.slice(1));
} else if (request) {
  candidates.push(`v${request}`);
}
const version = candidates.find((item) => item && versions[item]);
if (!version) {
  process.stderr.write("指定版本不存在\n");
  process.exit(2);
}
const commit = versions[version].commit;
if (!commit) {
  process.stderr.write("版本缺少 commit\n");
  process.exit(3);
}
process.stdout.write(version + "|" + commit);
' "${MANIFEST_CACHE}" "${REQUESTED_VERSION}"
)" || exit_on_error "解析版本清单失败（请求版本：${REQUESTED_VERSION}）。"

RESOLVED_VERSION="${RESOLVE_RESULT%%|*}"
RESOLVED_COMMIT="${RESOLVE_RESULT#*|}"
VERSION_DIR="${VERSIONS_ROOT}/${RESOLVED_VERSION}"

print_info "目标版本：${RESOLVED_VERSION} (${RESOLVED_COMMIT})"

if [ ! -d "${VERSION_DIR}" ]; then
    print_info "下载源码到 ${VERSION_DIR}"
    TMP_WORK_DIR="$(mktemp -d "${INSTALL_ROOT}/tmp.XXXXXX")"
    ARCHIVE_PATH="${TMP_WORK_DIR}/source.zip"
    curl -fsSL "https://codeload.github.com/${PROJECT_REPO}/zip/${RESOLVED_COMMIT}" -o "${ARCHIVE_PATH}"
    unzip -q "${ARCHIVE_PATH}" -d "${TMP_WORK_DIR}"
    EXTRACTED_DIR="$(find "${TMP_WORK_DIR}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
    [ -n "${EXTRACTED_DIR}" ] || exit_on_error "源码解压失败。"
    mkdir -p "${VERSION_DIR}"
    cp -R "${EXTRACTED_DIR}/." "${VERSION_DIR}/"
    rm -rf "${TMP_WORK_DIR}"
else
    print_info "版本目录已存在，跳过下载。"
fi

cd "${VERSION_DIR}"
print_info "安装依赖..."
if ! pnpm install; then
    print_warning "首次安装失败，重试一次..."
    pnpm install || exit_on_error "依赖安装失败。"
fi

echo "=================================================="
if [ "${COMMAND}" = "start" ]; then
    print_info "启动生产模式..."
    pnpm start
elif [ "${COMMAND}" = "dev" ]; then
    print_info "启动开发模式..."
    pnpm run dev
else
    print_info "安装完成。"
    echo "目录结构："
    echo "  - ${NODE_ROOT}"
    echo "  - ${VERSIONS_ROOT}/${RESOLVED_VERSION}"
    echo
    echo "使用方式："
    echo "  - bash install.sh [start|dev] --version <version|latest> --node-version <nodeVersion>"
    echo "  - bash install.sh [start|dev] -v <version|latest> -n <nodeVersion>"
    echo "示例："
    echo "  - bash install.sh start --version latest --node-version v20.11.0"
    echo "  - bash install.sh dev -v 0.0.1 -n v22.14.0"
fi
echo "=================================================="
