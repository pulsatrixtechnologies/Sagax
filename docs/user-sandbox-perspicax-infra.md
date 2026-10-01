# Perspicax infra: server environments on the GOX VM

GOX deploys Sagax from the Perspicax repository (`pulsatrix-v3`). The infra
side of the per-person server environments (`docs/user-sandbox.md`) lives
there, on branch `feat/sagax-sandbox-infra`; the operator documentation is
`infra/README.md`, "Environnements serveur" (French). This file only records
the contract between the two repositories.

## What the Perspicax side does

- `infra/runtime/docker-compose.yml`: profile `pulsabot-sandbox` on top of
  `pulsabot`, with:
  - `sagax-sandboxd`: the Sagax image with `node dist-server/sandboxd.js`. It
    is the only container with `/var/run/docker.sock`, read-only, has no
    capabilities, has groups `SAGAX_DOCKER_GID` and 10002, and sits on the
    internal network `sagax-sandbox-control` only.
  - `sagax-sandbox-image`: pull only.
  - `pulsabot` gains `SAGAX_SANDBOXD_URL` (empty means no environments),
    `SAGAX_SANDBOXD_KEY_FILE=/run/secrets/sagax-sandboxd/key`,
    `SAGAX_SANDBOX_INSTANCE=gox`, the read-only key mount and the
    control network.

  The second profile lets a Sagax image without environments (an older tag,
  or `SAGAX_SANDBOX=off`) deploy without a crash-looping provisioner.
- **Shared key:** `/opt/pulsatrix/secrets/sagax-sandboxd/key`, 64 hex
  characters, generated once by `vm-bootstrap.sh`, `root:10002`, mode 0440,
  mounted read-only into both containers. The provisioner's
  `ensureSandboxdKey` reads an existing file and never rewrites it.
- **`build-push.sh`:** builds and pushes `sagax-sandbox:<PULSABOT_IMAGE_TAG>`
  from `deploy/sandbox/Dockerfile` when the checkout has it.
- **`deploy-vm.sh`:** checks the image exists in the ACR and passes
  `keep`, `off` or the image to the bootstrap.
- **`vm-bootstrap.sh`:**
  - **Preflight,** before anything changes: `iptables -S DOCKER-USER`; the
    pool `10.213.0.0/16` overlaps none of the VM's addresses, routes or
    Docker networks; 3 GiB free under `/var/lib/docker`.
  - **`.env`:** writes `SAGAX_SANDBOX_IMAGE`, `SAGAX_DOCKER_GID` (the
    socket's group) and `SAGAX_SANDBOXD_URL`.
  - **Pull, removal and health:** pulls both services, removes them when
    off, and waits for the provisioner's `egress policy enforced`.

## What Sagax must keep

- The provisioner entry `dist-server/sandboxd.js` and its environment
  variables (`server/user-sandbox-spec.ts`).
- An existing key file is read, never replaced (`server/sandboxd-auth.ts`).
- The image's `deploy/sandbox/Dockerfile` path.
- The labels `com.pulsatrix.sagax.sandbox.instance=<instance>` and
  `sagax-user=<key>` (the README's cleanup commands filter on them).
- The log line `egress policy enforced` (the bootstrap waits for it).
