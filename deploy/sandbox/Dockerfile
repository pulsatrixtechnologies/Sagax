# Sagax server environment ("user-sandbox"): the image of each person's
# isolated Linux environment on an organization server (docs/user-sandbox.md).
#
#   docker build -f deploy/sandbox/Dockerfile -t sagax-sandbox:local .
#
# The provisioner (server/sandboxd.ts) runs it read-only, as uid 1000, with no
# capabilities, no new privileges, Docker's default seccomp and AppArmor
# profiles, its own network and its own /workspace volume. Nothing here is
# setuid: the setuid and setgid bits are stripped at the end.
#
# iptables ships here only for the provisioner's one-shot egress policy helper
# (host network, NET_ADMIN); a sandbox itself never has NET_ADMIN, so the
# binary is inert there.
FROM debian:bookworm-slim

ARG WITH_BROWSER=1
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      bash ca-certificates coreutils curl git jq less procps python3 python3-venv \
      unzip xz-utils zip file iptables tini; \
    if [ "$WITH_BROWSER" = "1" ]; then \
      apt-get install -y --no-install-recommends chromium fonts-noto-color-emoji fonts-freefont-ttf; \
    fi; \
    rm -rf /var/lib/apt/lists/*; \
    groupadd --gid 1000 sandbox; \
    useradd --uid 1000 --gid 1000 --home-dir /workspace --no-create-home --shell /bin/bash sandbox; \
    install -d -o 1000 -g 1000 -m 0700 /workspace; \
    find / -xdev -type f -perm /6000 -exec chmod a-s {} + ; \
    rm -f /etc/sudoers 2>/dev/null || true

ENV HOME=/workspace LANG=C.UTF-8 SAGAX_ENVIRONMENT=user-sandbox
WORKDIR /workspace
USER 1000:1000
LABEL com.pulsatrix.sagax.sandbox.image="1"
CMD ["sleep", "infinity"]
