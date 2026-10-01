# Perspicax infra patch: server environments on the GOX VM

GOX deploys Sagax from the Perspicax repository (`pulsatrix-v3`,
`infra/runtime/docker-compose.yml`, profile `pulsabot`). This is the change to
make **there** so the GOX VM (Standard_D4pls_v6, Arm64, 4 vCPU, 8 GiB) runs the
per-person server environments of `docs/user-sandbox.md`. Nothing in this file
is applied by Sagax itself.

Everything stays behind the `pulsabot` profile: a deploy without Sagax is
unchanged.

## 1. `infra/runtime/docker-compose.yml`

Add to the `pulsabot` service (keep everything already there):

```yaml
  pulsabot:
    # ...existing keys...
    environment:
      # ...existing variables...
      SAGAX_SANDBOXD_URL: http://sagax-sandboxd:8791
      SAGAX_SANDBOXD_KEY_FILE: /run/sagax-sandboxd/key
      SAGAX_SANDBOX_INSTANCE: gox
      SAGAX_SANDBOX_DELETE_GRACE_HOURS: ${SAGAX_SANDBOX_DELETE_GRACE_HOURS:-72}
    volumes:
      # ...existing mounts...
      - sandboxd-key:/run/sagax-sandboxd:ro
    networks:
      default: {}
      sandbox-control: {}
```

Add two services:

```yaml
  # The provisioner: the only container with the Docker socket. Same image as
  # Sagax, other entry point. No published port; reachable from pulsabot only.
  sagax-sandboxd:
    profiles: ["pulsabot"]
    image: ${PULSABOT_IMAGE:-pulsa-bot-server:off}
    command: ["node", "dist-server/sandboxd.js"]
    restart: unless-stopped
    init: true
    read_only: true
    cap_drop: ["ALL"]
    security_opt: ["no-new-privileges:true"]
    mem_limit: 192m
    pids_limit: 64
    group_add: ["${SAGAX_DOCKER_GID:?SAGAX_DOCKER_GID is required with Sagax}"]
    tmpfs:
      - /tmp:size=16m
    environment:
      SAGAX_SANDBOXD_LISTEN: 0.0.0.0:8791
      SAGAX_SANDBOXD_KEY_FILE: /run/sagax-sandboxd/key
      SAGAX_SANDBOXD_DOCKER_SOCKET: /var/run/docker.sock
      SAGAX_SANDBOX_INSTANCE: gox
      SAGAX_SANDBOX_IMAGE: ${SAGAX_SANDBOX_IMAGE:?SAGAX_SANDBOX_IMAGE is required with Sagax}
      SAGAX_SANDBOX_MEMORY_MB: ${SAGAX_SANDBOX_MEMORY_MB:-1024}
      SAGAX_SANDBOX_CPUS: ${SAGAX_SANDBOX_CPUS:-1}
      SAGAX_SANDBOX_PIDS: ${SAGAX_SANDBOX_PIDS:-256}
      SAGAX_SANDBOX_DISK_MB: ${SAGAX_SANDBOX_DISK_MB:-2048}
      SAGAX_SANDBOX_MAX_RUNNING: ${SAGAX_SANDBOX_MAX_RUNNING:-3}
      SAGAX_SANDBOX_IDLE_MINUTES: ${SAGAX_SANDBOX_IDLE_MINUTES:-15}
      SAGAX_SANDBOX_SUBNET_POOL: ${SAGAX_SANDBOX_SUBNET_POOL:-10.213.0.0/16}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - sandboxd-key:/run/sagax-sandboxd
    networks:
      - sandbox-control
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8791/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
    depends_on:
      sagax-sandbox-image:
        condition: service_completed_successfully

  # Pull-only: puts the sandbox image on the host, then exits.
  sagax-sandbox-image:
    profiles: ["pulsabot"]
    image: ${SAGAX_SANDBOX_IMAGE:-sagax-sandbox:off}
    entrypoint: ["true"]
    restart: "no"
    network_mode: none
    read_only: true
```

Add the volume and the network:

```yaml
volumes:
  # ...existing...
  sandboxd-key:

networks:
  default:
    ipam:
      config:
        - subnet: 172.30.42.0/24
  # Sagax server <-> provisioner only; no route out.
  sandbox-control:
    internal: true
```

Keep the `pulsabot` service's `default` network: the connector and the edge
Caddy reach it there. Do not give `sagax-sandboxd` the `default` network.

## 2. `infra/scripts/build-push.sh`

After the Sagax server build (inside `if [[ -n "$pulsabot_tag" ]]`), build and
push the sandbox image from the same checkout, same platform and tag:

```bash
  sandbox_repository=${SAGAX_SANDBOX_REPOSITORY:-sagax-sandbox}
  docker buildx build \
    --platform "$platform" \
    --push \
    --label "org.opencontainers.image.revision=$(git -C "$PULSABOT_SRC" rev-parse HEAD 2>/dev/null || echo unknown)" \
    --tag "${acr_login_server}/${sandbox_repository}:${pulsabot_tag}" \
    --file "$PULSABOT_SRC/deploy/sandbox/Dockerfile" \
    "$PULSABOT_SRC"
  printf '%s/%s:%s\n' "$acr_login_server" "$sandbox_repository" "$pulsabot_tag"
```

## 3. `infra/scripts/deploy-vm.sh`

Where it checks that the Sagax tag exists in the ACR, check
`${SAGAX_SANDBOX_REPOSITORY:-sagax-sandbox}:$pulsabot_tag` the same way and
pass `sagax_sandbox_image=${acr_login_server}/sagax-sandbox:${pulsabot_tag}`
to the bootstrap beside `pulsabot_image`.

## 4. `infra/scripts/vm-bootstrap.sh`

In the Sagax-on branch, append to `.env` (next to `PULSABOT_IMAGE=`):

```bash
SAGAX_SANDBOX_IMAGE=$sagax_sandbox_image
SAGAX_DOCKER_GID=$(stat -c %g /var/run/docker.sock)
```

and pull it with the other Sagax services:

```bash
  docker compose pull pulsabot pulsabot-caddy sagax-sandbox-image
```

`docker compose up -d` then starts `sagax-sandboxd`; `pulsabot-caddy` and the
Teams bot override are untouched. With `PULSABOT=off` the profile is off, so
both new services are removed like the others; the `sandboxd-key` volume and
the people's `sagax-user-*` containers, networks and volumes stay. To remove
those as well: `docker ps -aq --filter label=com.pulsatrix.sagax.sandbox.instance=gox | xargs -r docker rm -f`,
then the same filter on `docker network ls` and `docker volume ls`.

## 5. Host checks before the first deploy

1. **Docker uses iptables** (the provisioner adds a `DOCKER-USER` jump and an
   `INPUT` drop for the pool at start): `sudo iptables -S DOCKER-USER` must
   answer. If the daemon runs the nftables firewall backend, environments stay
   off (`egress policy missing` in `docker compose logs sagax-sandboxd`).
2. **The pool overlaps nothing:** `10.213.0.0/16` must not overlap the VNet
   (`az network vnet show ... --query addressSpace`), `172.30.42.0/24`, or
   another Docker network (`docker network inspect $(docker network ls -q) --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}'`).
   Otherwise set `SAGAX_SANDBOX_SUBNET_POOL` in `.env`.
3. **Disk:** the sandbox image is about 700 MB on Arm64 (Chromium included)
   and each person's `/workspace` up to `SAGAX_SANDBOX_DISK_MB` under
   `/var/lib/docker`, on the OS disk: `df -h /var/lib/docker`.
4. **Memory:** three running environments at 1 GiB each beside Perspicax,
   Caddy, the Teams bot and Sagax. Watch `docker stats --no-stream`; lower
   `SAGAX_SANDBOX_MAX_RUNNING` or `SAGAX_SANDBOX_MEMORY_MB` if the VM swaps.
5. **Optional stronger runtime:** gVisor (`runsc`, Arm64 supported) installed
   and registered with the daemon, then `SAGAX_SANDBOX_RUNTIME=runsc`.

## 6. Verify

```bash
docker compose ps sagax-sandboxd                 # healthy
docker compose logs sagax-sandboxd | head -3     # "egress policy enforced"
sudo iptables -S DOCKER-USER | grep SAGAX-SBX-GOX
```

Then in Sagax: Settings > Organization > Your server environment shows "Not
created yet"; ask any bot to run `id`; the card shows Running and the tool chip
"Your server environment". `docker ps --filter label=sagax-user` lists one
container per person, never one per bot.

## 7. README

Add a short "Environnements serveur" subsection under "Sagax sur la même VM"
in `infra/README.md` pointing to this file and listing `SAGAX_SANDBOX_IMAGE`,
`SAGAX_DOCKER_GID`, `SAGAX_SANDBOX_*` and the host checks above.
