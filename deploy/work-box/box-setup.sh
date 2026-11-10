#!/bin/bash
# The work box's whole setup (designs/2026-11-10-work-box.md): Ubuntu 24.04, arm64 or x64, any
# provider. Cloud-init runs it as user_data on first boot; register-runners.sh runs it again over
# ssh, so it is idempotent and a box made without it still ends the same. No secrets here: user_data
# is readable from the instance metadata service.
set -euxo pipefail
exec > >(tee -a /var/log/wren-work-setup.log) 2>&1

RUNNER_VERSION=2.338.2 # the runner updates itself after; this is only the first install
export DEBIAN_FRONTEND=noninteractive
ARCH=$(dpkg --print-architecture) # arm64 | amd64
case "$ARCH" in arm64) RARCH=arm64 AWSARCH=aarch64 ;; amd64) RARCH=x64 AWSARCH=x86_64 ;; esac

# apt sources: Docker, GitHub CLI
install -m 0755 -d /etc/apt/keyrings
[ -f /etc/apt/keyrings/docker.asc ] ||
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$ARCH signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  >/etc/apt/sources.list.d/docker.list
[ -f /etc/apt/keyrings/githubcli.gpg ] ||
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli.gpg
echo "deb [arch=$ARCH signed-by=/etc/apt/keyrings/githubcli.gpg] https://cli.github.com/packages stable main" \
  >/etc/apt/sources.list.d/github-cli.list
apt-get update -q
# what the hosted image gave the jobs: deploy.sh (zip, jq, aws), lag check (psql), native builds
apt-get install -yq --no-install-recommends \
  ca-certificates curl git jq zip unzip rsync build-essential python3 postgresql-client gh \
  docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

if ! command -v aws >/dev/null; then
  t=$(mktemp -d)
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$AWSARCH.zip" -o "$t/aws.zip"
  unzip -q "$t/aws.zip" -d "$t" && "$t/aws/install"
  rm -rf "$t"
fi

# docker logs capped; jobs leave many short containers
cat >/etc/docker/daemon.json <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "2" } }
JSON
systemctl enable docker
systemctl restart docker

# runner user: docker group, no sudo (the docker group is root anyway; nothing in CI asks for sudo)
id runner >/dev/null 2>&1 || useradd -m -s /bin/bash runner
usermod -aG docker runner

# runner binary, copied per instance by register-runners.sh
if [ ! -x /opt/actions-runner/config.sh ]; then
  mkdir -p /opt/actions-runner
  curl -fsSL "https://github.com/actions/runner/releases/download/v$RUNNER_VERSION/actions-runner-linux-$RARCH-$RUNNER_VERSION.tar.gz" |
    tar -xz -C /opt/actions-runner
  /opt/actions-runner/bin/installdependencies.sh
fi

# a container job (playwright image) writes root-owned files into the workspace; the next job's
# checkout then fails. Hand them back before each job.
cat >/usr/local/bin/work-job-started <<'SH'
#!/bin/bash
[ -n "${GITHUB_WORKSPACE:-}" ] && [ -d "$GITHUB_WORKSPACE" ] &&
  docker run --rm -v "$GITHUB_WORKSPACE:/w" busybox chown -R "$(id -u):$(id -g)" /w || true
SH
chmod 755 /usr/local/bin/work-job-started

# leaks from killed jobs (testcontainers runs with Ryuk off): a container up 3 h is a leak; old
# images and build cache go weekly, or now when the disk is 80% full
cat >/usr/local/bin/work-clean <<'SH'
#!/bin/bash
set -u
now=$(date +%s)
docker ps -q --filter label=org.testcontainers=true | while read -r id; do
  up=$(date -d "$(docker inspect -f '{{.State.StartedAt}}' "$id")" +%s)
  [ $((now - up)) -gt 10800 ] && docker rm -f "$id" >/dev/null
done
docker container prune -f --filter until=3h >/dev/null
docker image prune -af --filter until=168h >/dev/null
docker builder prune -af --filter until=168h >/dev/null
[ "$(df --output=pcent / | tail -1 | tr -dc 0-9)" -ge 80 ] && docker system prune -af >/dev/null
exit 0
SH
chmod 755 /usr/local/bin/work-clean
cat >/etc/systemd/system/work-clean.service <<'UNIT'
[Unit]
Description=Remove leaked job containers and old images
[Service]
Type=oneshot
ExecStart=/usr/local/bin/work-clean
UNIT
cat >/etc/systemd/system/work-clean.timer <<'UNIT'
[Unit]
Description=Hourly job leak clean
[Timer]
OnCalendar=hourly
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now work-clean.timer

touch /var/lib/wren-work-setup.done
