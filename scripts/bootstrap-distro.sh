#!/usr/bin/env bash
# Bootstrap a Monster Paws WSL distro (ADR-0004 as amended 2026-10-05, decisions 9–11).
#   wsl -d <distro> -u root --cd / -- bash /path/to/bootstrap-distro.sh [user]
# Idempotent. The docker ENGINE goes inside the distro — never Docker Desktop,
# which needs an interactive login and would be the only thing on the box that
# cannot start from Task Scheduler. Identity (GPG, pass, ssh) is NOT installed
# here: dev carries it over by hand, prod never has it (decision 12).
set -euo pipefail
USER_NAME="${1:-oof}"
NODE_MAJOR=24
NVM_VERSION=v0.40.3
export DEBIAN_FRONTEND=noninteractive

[ "$(id -u)" = 0 ] || { echo "run as root (wsl -u root)"; exit 1; }
id "$USER_NAME" >/dev/null 2>&1 || { echo "no such user: $USER_NAME"; exit 1; }

apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  ca-certificates curl gnupg git pass jq unzip rclone postgresql-client \
  build-essential python3 python3-venv openssh-client >/dev/null

install -m 0755 -d /etc/apt/keyrings
codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"
arch="$(dpkg --print-architecture)"
if [ ! -f /etc/apt/keyrings/docker.asc ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi
echo "deb [arch=$arch signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $codename stable" \
  > /etc/apt/sources.list.d/docker.list
if [ ! -f /etc/apt/keyrings/githubcli-archive-keyring.gpg ]; then
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
  chmod a+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
fi
echo "deb [arch=$arch signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  > /etc/apt/sources.list.d/github-cli.list
apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin gh >/dev/null
usermod -aG docker "$USER_NAME"
systemctl enable docker >/dev/null 2>&1 || true
systemctl start docker >/dev/null 2>&1 || true

if ! command -v doctl >/dev/null; then
  ver="$(curl -fsSL https://api.github.com/repos/digitalocean/doctl/releases/latest | jq -r .tag_name | sed 's/^v//')"
  curl -fsSL "https://github.com/digitalocean/doctl/releases/download/v${ver}/doctl-${ver}-linux-amd64.tar.gz" | tar -xz -C /usr/local/bin doctl
fi

cat > /etc/wsl.conf <<WSLCONF
[boot]
systemd=true

[user]
default=${USER_NAME}
WSLCONF

su - "$USER_NAME" -c "bash -s" <<USERPART
set -euo pipefail
export NVM_DIR="\$HOME/.nvm"
if [ ! -s "\$NVM_DIR/nvm.sh" ]; then
  curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" | bash >/dev/null
fi
. "\$NVM_DIR/nvm.sh"
nvm install ${NODE_MAJOR} >/dev/null
nvm alias default ${NODE_MAJOR} >/dev/null
npm install -g @anthropic-ai/claude-code >/dev/null 2>&1
echo "node \$(node --version) · npm \$(npm --version) · claude \$(claude --version 2>/dev/null | head -1)"
USERPART

echo "docker $(docker --version | cut -d, -f1) · $(docker compose version | head -1) · $(gh --version | head -1) · pass $(pass --version 2>&1 | grep -oE 'v[0-9.]+' | head -1) · doctl $(doctl version | head -1)"
echo "bootstrap complete — restart the distro (wsl --terminate <distro>) so the docker group and wsl.conf apply"
