#!/usr/bin/env bash
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
SITE_ROOT="/var/www/binaryderivpilot"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root (e.g. ssh root@SERVER_IP, then bash setup-server.sh)." >&2
  exit 1
fi

if [[ ! -f "${SCRIPT_DIR}/Caddyfile" ]]; then
  echo "Caddyfile not found next to setup-server.sh (${SCRIPT_DIR})." >&2
  exit 1
fi

echo "==> Updating packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg ufw

echo "==> Creating deploy user '${DEPLOY_USER}'"
if ! id "${DEPLOY_USER}" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "${DEPLOY_USER}"
fi
install -d -m 700 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh"
if [[ -f /root/.ssh/authorized_keys ]]; then
  touch "/home/${DEPLOY_USER}/.ssh/authorized_keys"
  while IFS= read -r key; do
    [[ -z "${key}" ]] && continue
    grep -qxF "${key}" "/home/${DEPLOY_USER}/.ssh/authorized_keys" || echo "${key}" >> "/home/${DEPLOY_USER}/.ssh/authorized_keys"
  done < /root/.ssh/authorized_keys
  chown "${DEPLOY_USER}:${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh/authorized_keys"
  chmod 600 "/home/${DEPLOY_USER}/.ssh/authorized_keys"
else
  echo "WARNING: /root/.ssh/authorized_keys not found; add a key to /home/${DEPLOY_USER}/.ssh/authorized_keys manually."
fi

cat > /etc/sudoers.d/90-${DEPLOY_USER}-caddy <<EOF
${DEPLOY_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl reload caddy
EOF
chmod 440 /etc/sudoers.d/90-${DEPLOY_USER}-caddy
visudo -cf /etc/sudoers.d/90-${DEPLOY_USER}-caddy

echo "==> Installing Caddy from the official apt repository"
if [[ ! -f /usr/share/keyrings/caddy-stable-archive-keyring.gpg ]]; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
fi
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  > /etc/apt/sources.list.d/caddy-stable.list
chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
apt-get update -y
apt-get install -y caddy

echo "==> Configuring firewall (OpenSSH, 80, 443)"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> Preparing ${SITE_ROOT}"
install -d -m 755 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${SITE_ROOT}" "${SITE_ROOT}/releases"
if [[ ! -e "${SITE_ROOT}/current" ]]; then
  placeholder="${SITE_ROOT}/releases/placeholder"
  install -d -m 755 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${placeholder}"
  echo '<!doctype html><title>binaryderivpilot.com</title><p>Coming soon.</p>' > "${placeholder}/index.html"
  chown "${DEPLOY_USER}:${DEPLOY_USER}" "${placeholder}/index.html"
  ln -sfn "${placeholder}" "${SITE_ROOT}/current"
  chown -h "${DEPLOY_USER}:${DEPLOY_USER}" "${SITE_ROOT}/current"
fi

echo "==> Installing Caddyfile"
install -m 644 "${SCRIPT_DIR}/Caddyfile" /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable caddy
if systemctl is-active --quiet caddy; then
  systemctl reload caddy
else
  systemctl start caddy
fi

echo
echo "Done. Next steps:"
echo "  1. Point DNS A records for binaryderivpilot.com and www to this server's IPv4."
echo "  2. Add GitHub Actions secrets (VULTR_HOST, VULTR_SSH_USER, VULTR_SSH_KEY, VITE_*)."
echo "  3. Push to main (or run workflow Deploy web) — see deploy/vultr/README.md."
echo "  4. Optional: bash archive-legacy-site.sh to zip/remove old site files."
echo "  5. Check certificates/logs with: journalctl -u caddy -f"
