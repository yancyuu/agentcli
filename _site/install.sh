#!/usr/bin/env bash
set -euo pipefail

PACKAGE="@yancyyu/agentcli"
MIN_NODE_VERSION=18

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { printf "${CYAN}%s${RESET}\n" "$*"; }
success() { printf "${GREEN}%s${RESET}\n" "$*"; }
warn()  { printf "${YELLOW}%s${RESET}\n" "$*"; }
error() { printf "${RED}%s${RESET}\n" "$*" >&2; exit 1; }

detect_os() {
  case "$(uname -s)" in
    Darwin) OS="macOS" ;;
    Linux)  OS="Linux" ;;
    *)      error "不支持的操作系统: $(uname -s)。目前仅支持 macOS 和 Linux。" ;;
  esac
}

install_node() {
  info "未找到 Node.js，正在自动安装 Node.js ${MIN_NODE_VERSION} ..."

  if [ "$OS" = "macOS" ]; then
    if command -v brew &>/dev/null; then
      brew install node@${MIN_NODE_VERSION}
      brew link --overwrite node@${MIN_NODE_VERSION} 2>/dev/null || true
    else
      info "未找到 Homebrew，先安装 Homebrew ..."
      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
      eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)"
      brew install node@${MIN_NODE_VERSION}
      brew link --overwrite node@${MIN_NODE_VERSION} 2>/dev/null || true
    fi
  else
    if command -v apt-get &>/dev/null; then
      curl -fsSL https://deb.nodesource.com/setup_${MIN_NODE_VERSION}.x | sudo -E bash -
      sudo apt-get install -y nodejs
    elif command -v dnf &>/dev/null; then
      curl -fsSL https://rpm.nodesource.com/setup_${MIN_NODE_VERSION}.x | sudo bash -
      sudo dnf install -y nodejs
    elif command -v yum &>/dev/null; then
      curl -fsSL https://rpm.nodesource.com/setup_${MIN_NODE_VERSION}.x | sudo bash -
      sudo yum install -y nodejs
    else
      error "无法自动安装 Node.js，请手动安装 Node.js >= ${MIN_NODE_VERSION} 后重试。"
    fi
  fi

  if ! command -v node &>/dev/null; then
    error "Node.js 安装失败，请手动安装后重试。"
  fi
  success "Node.js $(node -v) 安装成功"
}

check_node() {
  if ! command -v node &>/dev/null; then
    install_node
    return
  fi

  local ver
  ver=$(node -v | sed 's/^v//' | cut -d. -f1)
  if [ "$ver" -lt "$MIN_NODE_VERSION" ]; then
    warn "Node.js 版本过低 (v${ver})，需要 >= ${MIN_NODE_VERSION}，正在升级 ..."
    install_node
  fi
}

check_npm() {
  if ! command -v npm &>/dev/null; then
    error "未找到 npm。请确认 Node.js 安装完整。"
  fi
}

install_package() {
  info "正在安装 ${PACKAGE} ..."

  if npm install -g "${PACKAGE}" 2>&1; then
    success "安装完成！"
  else
    warn "全局安装失败，尝试使用 sudo ..."
    sudo npm install -g "${PACKAGE}" || error "安装失败，请检查权限或网络。"
    success "安装完成！"
  fi
}

verify_install() {
  if command -v agentcli &>/dev/null; then
    local ver
    ver=$(agentcli --version 2>/dev/null || echo "unknown")
    printf "\n"
    success "✓ AgentCli 已安装成功"
    info "  版本: ${ver}"
    info "  运行: agentcli"
    printf "\n"
  else
    warn "安装似乎成功但 agentcli 命令未找到。"
    warn "请确认 npm 全局 bin 目录在 PATH 中："
    warn "  npm config get prefix"
    warn "  export PATH=\"\$(npm config get prefix)/bin:\$PATH\""
  fi
}

main() {
  printf "\n"
  printf "${BOLD}  AgentCli 安装程序${RESET}\n"
  printf "  ─────────────────────\n\n"

  detect_os
  info "系统: ${OS} ($(uname -m))"

  check_node
  info "Node.js: $(node -v)"

  check_npm
  install_package
  verify_install
}

main "$@"
