#!/bin/bash

set -uo pipefail
IFS=$'\n\t'

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

print_info() {
    printf '%b[信息] %s%b\n' "${GREEN}" "$1" "${NC}"
}

print_warning() {
    printf '%b[警告] %s%b\n' "${YELLOW}" "$1" "${NC}"
}

print_error() {
    printf '%b[错误] %s%b\n' "${RED}" "$1" "${NC}"
}

print_plain() {
    printf '%s\n' "$1"
}

SCRIPT_EXIT_CODE=0
COMMAND=""
REQUESTED_VERSION=""
BUNDLED_NODE_VERSION=""
SHOW_HELP=false

REQUIRED_NODE_VERSION=20
PNPM_VERSION=9.0.0
PROJECT_REPO="MortarHQ/GhostPing"
MANIFEST_URL="https://raw.githubusercontent.com/${PROJECT_REPO}/master/docs/releases/versions.json"
CURRENT_DIR="$(pwd)"
INSTALL_ROOT="${CURRENT_DIR}/ghostping"
NODE_ROOT="${INSTALL_ROOT}/node"
VERSIONS_ROOT="${INSTALL_ROOT}/versions"
MANIFEST_CACHE="${INSTALL_ROOT}/versions.json"
TEMP_SOURCE_DIR=""
TEMP_NODE_DIR=""

fail() {
    print_error "$1"
    SCRIPT_EXIT_CODE=1
    return 1
}

canonical_path() {
    local input="$1"
    if [ -z "${input}" ]; then
        return 1
    fi

    if [ -d "${input}" ]; then
        (cd "${input}" 2>/dev/null && pwd -P)
        return $?
    fi

    local parent
    parent="$(dirname "${input}")"
    local name
    name="$(basename "${input}")"

    if [ ! -d "${parent}" ]; then
        return 1
    fi

    local parent_abs
    parent_abs="$(cd "${parent}" 2>/dev/null && pwd -P)" || return 1
    printf "%s/%s\n" "${parent_abs}" "${name}"
}

safe_remove_temp_dir() {
    local target="$1"
    local expected_parent="$2"

    [ -n "${target}" ] || return 0
    [ -n "${expected_parent}" ] || return 0

    if [ ! -e "${target}" ]; then
        return 0
    fi

    if [ ! -d "${target}" ]; then
        print_warning "跳过删除，目标不是目录：${target}"
        return 0
    fi

    local target_abs
    target_abs="$(canonical_path "${target}")" || {
        print_warning "跳过删除，无法解析目标路径：${target}"
        return 0
    }

    local parent_abs
    parent_abs="$(canonical_path "${expected_parent}")" || {
        print_warning "跳过删除，无法解析父目录：${expected_parent}"
        return 0
    }

    if [ "${target_abs}" = "/" ] || [ "${target_abs}" = "${parent_abs}" ]; then
        print_warning "跳过删除，目标路径不安全：${target_abs}"
        return 0
    fi

    case "${target_abs}" in
        "${parent_abs}/_tmp_"*)
            rm -rf -- "${target_abs}" >/dev/null 2>&1
            if [ $? -ne 0 ]; then
                print_warning "删除临时目录失败：${target_abs}"
            else
                print_info "已删除临时目录：${target_abs}"
            fi
            ;;
        *)
            print_warning "跳过删除，目录名不符合 _tmp_* 规则：${target_abs}"
            ;;
    esac
}

cleanup_temp_dirs() {
    safe_remove_temp_dir "${TEMP_SOURCE_DIR}" "${INSTALL_ROOT}"
    safe_remove_temp_dir "${TEMP_NODE_DIR}" "${NODE_ROOT}"
}

print_usage() {
    cat <<EOF
用法:
  install.sh [start|dev] [-v|--version <version|latest>] [-n|--node-version <nodeVersion>]

参数:
  start|dev                 可选，安装完成后直接启动
  -v, --version             指定 GhostPing 版本，默认 latest（可用 0.0.1 或 v0.0.1）
  -n, --node-version        指定 Node 版本，默认 v20.11.0
  -h, --help                显示此帮助
EOF
}

parse_args() {
    while [ "$#" -gt 0 ]; do
        case "$1" in
            start|dev)
                if [ -n "${COMMAND}" ]; then
                    fail "命令重复：${COMMAND} 与 $1"
                    return 1
                fi
                COMMAND="$1"
                shift
                ;;
            -v|--version)
                if [ "$#" -lt 2 ]; then
                    fail "$1 缺少版本参数"
                    return 1
                fi
                REQUESTED_VERSION="$2"
                shift 2
                ;;
            -n|--node-version)
                if [ "$#" -lt 2 ]; then
                    fail "$1 缺少 Node 版本参数"
                    return 1
                fi
                BUNDLED_NODE_VERSION="$2"
                shift 2
                ;;
            -h|--help)
                print_usage
                SHOW_HELP=true
                return 0
                ;;
            *)
                fail "未知参数: $1"
                return 1
                ;;
        esac
    done
    return 0
}

ensure_pnpm() {
    if command -v pnpm >/dev/null 2>&1; then
        print_info "检测到 pnpm $(pnpm -v)"
        return 0
    fi

    if command -v corepack >/dev/null 2>&1; then
        print_info "使用 Corepack 安装 pnpm@${PNPM_VERSION}"
        corepack enable >/dev/null 2>&1
        if [ $? -eq 0 ]; then
            corepack prepare "pnpm@${PNPM_VERSION}" --activate >/dev/null 2>&1
            if [ $? -eq 0 ]; then
                return 0
            fi
        fi
    fi

    if ! command -v npm >/dev/null 2>&1; then
        return 1
    fi

    npm install -g "pnpm@${PNPM_VERSION}" >/dev/null 2>&1
    return $?
}

main() {
    parse_args "$@" || return 1
    if [ "${SHOW_HELP}" = "true" ]; then
        return 0
    fi

    if [ -z "${REQUESTED_VERSION}" ]; then
        if [ -n "${GP_VERSION:-}" ]; then
            REQUESTED_VERSION="${GP_VERSION}"
        else
            REQUESTED_VERSION="latest"
        fi
    fi

    if [ -z "${BUNDLED_NODE_VERSION}" ]; then
        if [ -n "${GP_NODE_VERSION:-}" ]; then
            BUNDLED_NODE_VERSION="${GP_NODE_VERSION}"
        else
            BUNDLED_NODE_VERSION="v20.11.0"
        fi
    fi

    if [[ "${BUNDLED_NODE_VERSION}" != v* ]]; then
        BUNDLED_NODE_VERSION="v${BUNDLED_NODE_VERSION}"
    fi

    print_info "此脚本将创建目录：${INSTALL_ROOT}"
    mkdir -p "${INSTALL_ROOT}" >/dev/null 2>&1 || { fail "创建安装目录失败。"; return 1; }
    mkdir -p "${NODE_ROOT}" >/dev/null 2>&1 || { fail "创建 node 目录失败。"; return 1; }
    mkdir -p "${VERSIONS_ROOT}" >/dev/null 2>&1 || { fail "创建 versions 目录失败。"; return 1; }

    case "$(uname -s)" in
        Linux*) OS=linux ;;
        Darwin*) OS=darwin ;;
        *) fail "不支持的操作系统。"; return 1 ;;
    esac

    case "$(uname -m)" in
        x86_64|amd64) ARCH=x64 ;;
        arm64|aarch64) ARCH=arm64 ;;
        *)
            print_warning "未知架构 $(uname -m)，默认使用 x64"
            ARCH=x64
            ;;
    esac

    NODE_ARCH="${OS}-${ARCH}"
    NODE_ZIP_DIR="${NODE_ROOT}/node_${BUNDLED_NODE_VERSION}"
    NODE_DIR="${NODE_ZIP_DIR}/node-${BUNDLED_NODE_VERSION}-${NODE_ARCH}"

    for tool in curl tar unzip; do
        if ! command -v "${tool}" >/dev/null 2>&1; then
            fail "缺少依赖：${tool}，请先安装后重试。"
            return 1
        fi
    done

    USE_SYSTEM_NODE=false
    if command -v node >/dev/null 2>&1; then
        NODE_VERSION="$(node -v 2>/dev/null || true)"
        if [ -z "${NODE_VERSION}" ]; then
            fail "无法获取 Node.js 版本。"
            return 1
        fi
        print_info "检测到系统 Node.js ${NODE_VERSION}"

        VERSION_NUMBER="${NODE_VERSION#v}"
        MAJOR_VERSION="${VERSION_NUMBER%%.*}"
        if [[ "${MAJOR_VERSION}" =~ ^[0-9]+$ ]] && [ "${MAJOR_VERSION}" -ge "${REQUIRED_NODE_VERSION}" ]; then
            USE_SYSTEM_NODE=true
        else
            print_warning "系统 Node.js 低于推荐版本 v${REQUIRED_NODE_VERSION}"
            CONTINUE_WITH_SYSTEM_NODE=""
            read -r -p "是否继续使用当前系统的 Node.js？(y/n): " CONTINUE_WITH_SYSTEM_NODE || true
            if [[ "${CONTINUE_WITH_SYSTEM_NODE}" =~ ^[Yy]$ ]]; then
                USE_SYSTEM_NODE=true
            fi
        fi
    fi

    if [ "${USE_SYSTEM_NODE}" = "false" ]; then
        if [ ! -d "${NODE_DIR}" ]; then
            mkdir -p "${NODE_ZIP_DIR}" >/dev/null 2>&1 || { fail "创建 Node.js 目录失败。"; return 1; }

            TEMP_NODE_DIR="${NODE_ROOT}/_tmp_node_${RANDOM}${RANDOM}"
            mkdir -p "${TEMP_NODE_DIR}" >/dev/null 2>&1 || { fail "创建 Node.js 临时目录失败。"; return 1; }

            print_info "下载 Node.js ${BUNDLED_NODE_VERSION}..."
            TMP_NODE_ARCHIVE="${TEMP_NODE_DIR}/node.tar.gz"
            curl -fsSL "https://nodejs.org/dist/${BUNDLED_NODE_VERSION}/node-${BUNDLED_NODE_VERSION}-${NODE_ARCH}.tar.gz" -o "${TMP_NODE_ARCHIVE}" || {
                fail "下载 Node.js 失败。"
                return 1
            }

            tar -xzf "${TMP_NODE_ARCHIVE}" -C "${NODE_ZIP_DIR}" || {
                fail "解压 Node.js 失败。"
                return 1
            }

            safe_remove_temp_dir "${TEMP_NODE_DIR}" "${NODE_ROOT}"
            TEMP_NODE_DIR=""
        fi
        export PATH="${NODE_DIR}/bin:${PATH}"
    fi

    ensure_pnpm || { fail "pnpm 准备失败。"; return 1; }

    print_info "获取版本清单..."
    curl -fsSL "${MANIFEST_URL}" -o "${MANIFEST_CACHE}" || { fail "下载版本清单失败。"; return 1; }

    RESOLVE_RESULT="$(
        node -e '
const fs = require("fs");
const manifestPath = process.argv[1];
const requested = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const versions = manifest.versions || {};
const request = !requested || requested === "latest" ? manifest.latest : requested;
const version = request ? (request.startsWith("v") ? request : `v${request}`) : "";
if (!version) {
  process.stderr.write("version not found\n");
  process.exit(2);
}
if (!versions[version]) {
  process.stderr.write("version not found\n");
  process.exit(2);
}
const commit = versions[version].commit;
if (!commit) {
  process.stderr.write("missing commit\n");
  process.exit(3);
}
process.stdout.write(version + "|" + commit);
' "${MANIFEST_CACHE}" "${REQUESTED_VERSION}"
    )" || {
        fail "解析版本清单失败，请检查版本号：${REQUESTED_VERSION}"
        return 1
    }

    RESOLVED_VERSION="${RESOLVE_RESULT%%|*}"
    RESOLVED_COMMIT="${RESOLVE_RESULT#*|}"
    if [ -z "${RESOLVED_VERSION}" ]; then
        fail "解析版本清单失败，请检查版本号：${REQUESTED_VERSION}"
        return 1
    fi
    if [ -z "${RESOLVED_COMMIT}" ]; then
        fail "版本缺少 commit 信息。"
        return 1
    fi

    print_info "目标版本：${RESOLVED_VERSION} (${RESOLVED_COMMIT})"
    VERSION_DIR="${VERSIONS_ROOT}/${RESOLVED_VERSION}"

    if [ ! -d "${VERSION_DIR}" ]; then
        TEMP_SOURCE_DIR="${INSTALL_ROOT}/_tmp_source_${RANDOM}${RANDOM}"
        mkdir -p "${TEMP_SOURCE_DIR}" >/dev/null 2>&1 || { fail "创建临时目录失败。"; return 1; }

        print_info "下载源码..."
        ARCHIVE_PATH="${TEMP_SOURCE_DIR}/source.zip"
        curl -fsSL "https://codeload.github.com/${PROJECT_REPO}/zip/${RESOLVED_COMMIT}" -o "${ARCHIVE_PATH}" || {
            fail "下载源码失败。"
            return 1
        }

        unzip -q "${ARCHIVE_PATH}" -d "${TEMP_SOURCE_DIR}" || {
            fail "解压或复制源码失败。"
            return 1
        }

        EXTRACTED_DIR="$(find "${TEMP_SOURCE_DIR}" -mindepth 1 -maxdepth 1 -type d | awk 'NR==1 { print; exit }')"
        if [ -z "${EXTRACTED_DIR}" ]; then
            fail "解压或复制源码失败。"
            return 1
        fi

        mkdir -p "${VERSION_DIR}" >/dev/null 2>&1 || { fail "解压或复制源码失败。"; return 1; }
        cp -R "${EXTRACTED_DIR}/." "${VERSION_DIR}/" >/dev/null 2>&1 || { fail "解压或复制源码失败。"; return 1; }

        safe_remove_temp_dir "${TEMP_SOURCE_DIR}" "${INSTALL_ROOT}"
        TEMP_SOURCE_DIR=""
    else
        print_info "版本目录已存在，跳过下载。"
    fi

    cd "${VERSION_DIR}" || { fail "无法进入版本目录。"; return 1; }

    print_info "安装依赖..."
    pnpm install || {
        print_warning "首次安装失败，重试一次..."
        pnpm install || {
            fail "依赖安装失败。"
            return 1
        }
    }

    print_plain "=================================================="
    if [ "${COMMAND}" = "start" ]; then
        print_info "启动生产模式..."
        pnpm start || { fail "启动失败。"; return 1; }
    elif [ "${COMMAND}" = "dev" ]; then
        print_info "启动开发模式..."
        pnpm run dev || { fail "启动失败。"; return 1; }
    else
        print_info "安装完成。"
        print_plain "目录结构："
        print_plain "  - ${NODE_ROOT}"
        print_plain "  - ${VERSIONS_ROOT}/${RESOLVED_VERSION}"
        print_plain ""
        print_plain "使用方式："
        print_plain "  - install.sh [start|dev] --version <version|latest> --node-version <nodeVersion>"
        print_plain "  - install.sh [start|dev] -v <version|latest> -n <nodeVersion>"
        print_plain "示例："
        print_plain "  - install.sh start"
        print_plain "  - install.sh dev"
    fi
    print_plain "=================================================="

    return 0
}

if ! main "$@"; then
    if [ "${SCRIPT_EXIT_CODE}" -eq 0 ]; then
        SCRIPT_EXIT_CODE=1
    fi
fi

cleanup_temp_dirs
TEMP_SOURCE_DIR=""
TEMP_NODE_DIR=""

if [ "${SCRIPT_EXIT_CODE}" -eq 0 ]; then
    print_info "脚本运行完成，即将退出..."
else
    print_info "脚本异常结束，错误码：${SCRIPT_EXIT_CODE}"
fi

exit "${SCRIPT_EXIT_CODE}"
