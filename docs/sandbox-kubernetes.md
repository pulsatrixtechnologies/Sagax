# Kubernetes sandboxes

`SANDBOX_BACKEND=kubernetes` runs sagax-sandboxd against the Kubernetes API.
`docker` stays the default: an empty value, or `docker`, still uses
`docker.sock` and is unchanged. The Kubernetes path does not open that socket
and does not start a privileged egress helper. One person is one Pod and one
PVC (`sagax-user-<key>`, `sagax-user-<key>-workspace`) in the namespace
`sandboxes`. The key is the same 32-hex digest as the Docker backend.
There is no bot parameter.

The cluster can be k3s, AKS, EKS, LKE or a Kubernetes on Proxmox. The
provisioner calls only the Kubernetes API. It does not call a cloud API, and
the manifests do not create a load balancer. The operator supplies a
StorageClass.

## What the provisioner creates

| Object | Name | Notes |
|---|---|---|
| Pod | `sagax-user-<key>` | uid 1000, read-only root, drop all capabilities, seccomp RuntimeDefault, no token, no host namespaces, requests equal limits |
| PVC | `sagax-user-<key>-workspace` | ReadWriteOnce, the operator StorageClass, size `SAGAX_SANDBOX_DISK_MB` |
| NetworkPolicy | `sagax-user-<key>-net` | no ingress; egress `0.0.0.0/0` except the deny list; no IPv6 |
| NetworkPolicy | `sagax-default-deny` | every Pod in the namespace; no ingress and no egress |

Pause writes `sagax.pulsatrix.com/paused=true` on the PVC and deletes the
Pod, so the memory is released. Inspect still reports the sandbox running and
paused, and it keeps its capacity slot. Resume clears the annotation and
creates the Pod again. Stop clears the annotation, deletes the Pod and keeps
the PVC. Core Kubernetes has no portable cgroup freeze and no per-pod pid or
file-size rlimit; the pid cap is only the annotation
`sagax.pulsatrix.com/pids-limit`.

Sandbox Pods use the ServiceAccount `sagax-sandbox-workload` (no Role, token
not mounted). DNS is public (`1.1.1.1`, `8.8.8.8`, or `SAGAX_SANDBOX_K8S_DNS`)
so the deny list can include the cluster CIDR. An address inside the deny
list is refused at startup.

Without a node selector and a toleration, sandbox Pods go wherever the
scheduler puts them, usually the system pool, and never on a dedicated pool
that carries a `NoSchedule` taint. To run them on that pool, set
`SAGAX_SANDBOX_K8S_NODE_SELECTOR` to the pool's label and
`SAGAX_SANDBOX_K8S_TOLERATION` to its taint, exactly as the pool was
created (the AKS command in `docs/ops/sandboxes/cutover-rollback.md` uses
label and taint `sagax.io/pool=sandboxes`). Both are optional. A malformed
value (missing `=` in a selector, an effect other than `NoSchedule`,
`PreferNoSchedule` or `NoExecute`, a key that is not a label key) refuses
the start. The provisioner itself stays off that pool.

The namespace default deny also selects the provisioner. Apply
`deploy/k8s/provisioner/networkpolicy-provisioner.yaml` first. That policy is
only the provisioner label: TCP 443 and 6443 out, TCP 8791 in. Set
`SAGAX_SANDBOX_K8S_API` to `https://$KUBERNETES_SERVICE_HOST:$KUBERNETES_SERVICE_PORT`
so the provisioner does not need cluster DNS. Point
`SAGAX_SANDBOX_AUDIT_SHIP_URL` at a collector on 443, or replace the audit
emptyDir, because that policy allows no other egress.

## Variables (kubernetes only)

| Variable | Required | Meaning |
|---|---|---|
| `SANDBOX_BACKEND` | `kubernetes` | selects this backend |
| `SAGAX_SANDBOX_K8S_NAMESPACE` | no | default `sandboxes`; must already exist |
| `SAGAX_SANDBOX_K8S_STORAGE_CLASS` | yes | operator StorageClass |
| `SAGAX_SANDBOX_K8S_REGISTRY` | yes | image registry prefix, lowercase, no trailing slash |
| `SAGAX_SANDBOX_K8S_REQUIRE_SIGNED` | no | default true: the image ref must end in `@sha256:<64 hex>` |
| `SAGAX_SANDBOX_K8S_REQUIRE_ENCRYPTION` | no | default true: the StorageClass must advertise encryption |
| `SAGAX_SANDBOX_K8S_SECRETS_ENCRYPTED` | `true` | operator attestation that etcd encryption covers Secret |
| `SAGAX_SANDBOX_K8S_NETWORK_POLICY` | `enforced` | operator attestation that the CNI enforces NetworkPolicy |
| `SAGAX_SANDBOX_K8S_RUNTIME_CLASS` | no | optional RuntimeClass |
| `SAGAX_SANDBOX_K8S_PULL_SECRET` | no | name of a pull Secret, never the token |
| `SAGAX_SANDBOX_K8S_DNS` | no | 1 to 3 public IPv4 resolvers |
| `SAGAX_SANDBOX_K8S_QUOTA_NAME` | no | default `sagax-sandbox-quota` |
| `SAGAX_SANDBOX_K8S_NODE_SELECTOR` | no | `key=value[,key=value]`, Kubernetes label syntax, for example `sagax.io/pool=sandboxes`; becomes the Pod `nodeSelector` |
| `SAGAX_SANDBOX_K8S_TOLERATION` | no | `key=value:Effect` (operator Equal) or `key:Effect` (operator Exists), comma separated, for example `sagax.io/pool=sandboxes:NoSchedule`; becomes the Pod `tolerations` |
| `SAGAX_SANDBOX_K8S_API` | no | default `https://kubernetes.default.svc` |
| `SAGAX_SANDBOX_K8S_KUBECONFIG` | no | out-of-cluster auth; otherwise the Pod's ServiceAccount. `SAGAX_SANDBOX_K8S_USE_KUBECONFIG=1` uses `KUBECONFIG`, or `~/.kube/config` when that is unset |
| `SAGAX_SANDBOX_AUDIT_LOG` | no | default `/var/log/sagax/sandbox-audit.jsonl` |
| `SAGAX_SANDBOX_AUDIT_SHIP_URL` | no | https collector; credentials in the URL are refused |
| `SAGAX_SANDBOXD_TLS_CERT` / `SAGAX_SANDBOXD_TLS_KEY` | yes | provisioner certificate; `SAGAX_SANDBOXD_TLS_INSECURE=1` is a lab bypass and is audited |
| `SAGAX_SANDBOXD_TLS_CA` | client | Sagax server trusts this CA for `SAGAX_SANDBOXD_K8S_URL` (https only) |
| `SAGAX_SANDBOXD_K8S_URL` | client | Kubernetes provisioner. Docker stays `SAGAX_SANDBOXD_URL` |
| `SAGAX_SANDBOX_CANARY_PEOPLE` | client | principal ids sent to Kubernetes |
| `SAGAX_SANDBOX_CANARY_BOTS` | client | bot ids whose turns are sent to Kubernetes |
| `SAGAX_SANDBOX_ROUTE` | client | `kubernetes` sends everyone; `docker` sends everyone back |
| `SAGAX_SANDBOX_K8S_WAKE_URL` | client, no | secret https webhook that starts a stopped cluster (see "Cluster stopped when idle"); never logged, never passed to an engine |
| `SAGAX_SANDBOX_K8S_WAKE_TIMEOUT_MS` | client, no | how long a call waits for the cluster to start; default `480000` (8 minutes), from `30000` to `540000` |

`latest`, a bare name (`sagax-sandbox:local`) and a registry outside the
prefix are refused. `ghcr.io/org` does not admit `ghcr.io/org-evil/...`.
The digest pin is the runtime control. Cosign is not called inside the
provisioner.

A StorageClass counts as encrypting when a parameter is `encrypted` or
`encryption` (`true`), when `diskEncryptionSetID` is set, or when the
annotation `sagax.pulsatrix.com/encrypted=true` is set. The annotation is
the portable switch after the operator has confirmed the CSI driver. Setting
it on kind's `local-path` does not encrypt anything; the kind script leaves
`SAGAX_SANDBOX_K8S_REQUIRE_ENCRYPTION=false` and says so.

Readiness fails closed unless the namespace exists, the StorageClass
advertises encryption (when required), the ResourceQuota caps pods, memory,
cpu and storage, the image is admitted, both attestations are set, TLS
material is readable, and the audit directory is writable. The provisioner
cannot patch the quota.

CPU figures need metrics-server. Without it, stats report cpu 0 and memory 0,
and still report the memory limit.

## Cluster stopped when idle

An operator may stop the cluster when no sandbox Pod has run for a while
(for example a scheduled runbook that stops the cluster after 30 to 45
minutes with no Pod) and start it again through a webhook: one HTTPS
`POST` to a secret URL. Set that URL in `SAGAX_SANDBOX_K8S_WAKE_URL` on the
Sagax server and Sagax starts the cluster itself (`server/sandbox-k8s-wake.ts`):

- A call routed to Kubernetes first checks the provisioner's unsigned
  `GET /healthz` (5 seconds; a provisioner seen healthy in the last minute
  is not checked again). No answer, a refused connection, a timeout or a
  502, 503 or 504 with no provisioner body counts as unreachable. An error
  the provisioner itself answers (a JSON `code`) does not.
- A bot's command, a person's MCP server command, Start, Resume, Reset and
  Update wake the cluster. Sagax posts the webhook, then polls `/healthz`
  with backoff (2 seconds, up to 15 seconds between tries) until it answers
  or `SAGAX_SANDBOX_K8S_WAKE_TIMEOUT_MS` passes. Then the call runs.
- One wake at a time for the whole Sagax process. Every call that finds the
  cluster down waits on the same wake, and the webhook is posted at most
  once every 2 minutes, whatever the callers do. A webhook that failed is
  posted again only after that window.
- A call refused before it reached the provisioner (connection refused, no
  route, 503 from the load balancer) is sent once more after the wake. A
  timeout or a reset is not: the command may have run.
- Reads never wake it: the Computer tab, status, usage, the disk quota check
  and the voice call heartbeat. While the cluster is stopped the Computer
  tab shows the environment off (Start wakes it); during a wake it reads
  unavailable with the code `cluster_starting`.
- The running conversation shows one status row: "The server environment
  is starting. This can take a few minutes." (French: "Environnement en
  démarrage, ça peut prendre quelques minutes."). The tool call then
  resumes on its own. On timeout the call fails with "The server
  environment did not start in time. Send the message again in a few
  minutes." and a second row says so; the message can be sent again.
- There is no fallback to Docker. A workspace is never in two places.
- Docker calls are never gated, and without `SAGAX_SANDBOX_K8S_WAKE_URL`
  nothing changes: an unreachable provisioner fails the call as before.

The URL carries the webhook's token. It is read once at startup, never
logged (the log says "start webhook accepted", "answered 500" or
"unreachable (ENOTFOUND)"), never put in an error or an API answer, and
stripped from every engine's environment with the control plane secrets
(`CONTROL_PLANE_ENV`). Only https is accepted. A bad value stops the
server with a message that names the variable, not the value.

The default timeout (8 minutes) and the cap (9 minutes) stay under the 10
minute cut an engine puts on one tool call and the 12 minute cut of the
environment's MCP proxy, so the person gets the clear message rather than
a cut connection. An engine with a shorter tool timeout of its own (Codex
`tool_timeout_sec`) cuts the call earlier; the wake goes on, and the next
call joins it.

### Keeping the cluster up while it is used

Sagax sends no heartbeat and calls no Azure API other than the webhook.
The idle signal is the presence of sandbox Pods: a person's Pod exists from
the first command until the provisioner's idle stop
(`SAGAX_SANDBOX_IDLE_MINUTES`, default 10). Every command counts as use, a
command still running is never stopped, and a voice call's heartbeat
counts as use (`markUsed`). So the cluster stays up while anyone works,
and the stop timer of the runbook starts when the last Pod is gone.

What the runbook must do: count only sandbox Pods, those with the label
`com.pulsatrix.sagax.sandbox.user` in the sandbox namespace, never the
provisioner (`app=sagax-sandboxd`), which always runs. A paused
environment has no Pod and does not keep the cluster up; Resume wakes it.
The webhook should be harmless on a cluster that is already running
(Sagax may post it when only the provisioner restarted). Stop and delete
of a person signed out by Perspicax do not wake the cluster: they fail
while it is stopped and the pending deletion is tried again every 5
minutes.

## Images

`scripts/build-sandbox-image.sh` builds `linux/amd64` and `linux/arm64` to a
local OCI archive. It exits if `SANDBOX_IMAGE_PUSH=1`. It does not sign and
does not scan. `scripts/scan-sandbox-image.sh` runs trivy and fails if trivy
is missing or a HIGH or CRITICAL finding is present.
`scripts/verify-sandbox-image-signature.sh` runs cosign only when
`COSIGN_PUBLIC_KEY` is set. `.github/workflows/sandbox-image.yml` is
`workflow_dispatch` only, does not push, and its signature step says it did
not verify a signature. A dispatch on a runner without trivy fails the scan
step. That failure is not a scan.

The Debian base is multi-arch. Publish, sign and scan remain operator steps
against the registry named by `SAGAX_SANDBOX_K8S_REGISTRY`.

## Clouds

Same API on each. Only the operator's StorageClass, CNI and the way they
publish the ClusterIP differ.

| Place | StorageClass (operator) | NetworkPolicy | Publishing the provisioner |
|---|---|---|---|
| k3s | the encrypted class the operator installed | flannel does not enforce NetworkPolicy; add kube-router or Cilium, then set the attestation | in-cluster DNS or an internal address |
| AKS | a class with `diskEncryptionSetID`, or the encrypted annotation after confirming the disk set | Azure CNI or Calico, when policy is on | internal Service; this chart does not create one |
| EKS | the encrypted EBS class the operator installed | the VPC CNI policy add-on, when installed | internal Service |
| LKE | the encrypted Linode class the operator installed | the cluster CNI, when it enforces policy | internal Service |
| Proxmox / k3s | the encrypted CSI class the operator installed | same as k3s | internal Service |

## Audit

`server/sandbox-audit.ts` opens the log with `O_APPEND | O_CREAT | O_WRONLY |
O_NOFOLLOW`, mode `0640`, and `fsync`s each line. It never truncates. A line
is `{v, ts, action, outcome, key?, detail?}`. Exec records the program name
and the exit code, not the arguments, the environment or a secret. An
optional collector is `POST` of that line to an https URL with no userinfo
and redirects treated as errors. A failed POST does not remove the line.
HTTP ship URLs are refused.

Kubernetes Events are a best-effort copy. The Role allows `create` and not
`patch`, `update` or `delete`. Events expire. The file is the record.

## SOC 2

Controls are the AICPA Trust Services Criteria. A row is evidence only for
what the artifact actually shows. Flags, a kind cluster and an unrun
workflow are not evidence.

| Change | Criteria | What this repo can show | What it does not show |
|---|---|---|---|
| ServiceAccount `sagax-sandboxd` with a namespace Role; sandbox Pods use `sagax-sandbox-workload` with no Role and no token; no `docker.sock`; no `cluster-admin` | CC6.1, CC6.3 least privilege; CC6.2 no shared admin credential for the workload | `deploy/k8s/provisioner/rbac.yaml`, the Pod security context in `podFromDockerSpec` | The kind kubeconfig is cluster-admin and must not be the production credential. An admin who applies the manifests still exists outside this Role. |
| Provisioner TLS required; the Sagax client accepts https only with `SAGAX_SANDBOXD_TLS_CA` | CC6.6, CC6.7 transmission restricted to an authenticated channel | `startKubernetesProvisioner` refuses to listen without the cert unless `SAGAX_SANDBOXD_TLS_INSECURE=1`, and that bypass is an audit line; `validSandboxdUrl` | The insecure flag is a lab switch. Traffic from kubelet to the runtime is the cluster's. |
| Per-sandbox NetworkPolicy (public IPv4 only, no ingress, no IPv6) and a namespace default deny; provisioner limited to 443, 6443 and 8791 | CC6.6 boundary protection | `sandboxNetworkPolicy`, `defaultDenyNetworkPolicy`, `networkpolicy-provisioner.yaml` | Enforcement is the attestation `SAGAX_SANDBOX_K8S_NETWORK_POLICY=enforced`. The API cannot show that the CNI implements the objects. k3s flannel and kindnet do not. |
| Registry prefix plus digest pin; tag `latest` refused | CC6.8 unauthorized software | `imageAdmissionProblems` | A digest is not a signature. This change does not sign an image. |
| Local multi-arch build that cannot push; trivy script fails closed; cosign script refuses to skip quietly | CC6.8 | `scripts/build-sandbox-image.sh`, `scripts/scan-sandbox-image.sh`, `scripts/verify-sandbox-image-signature.sh`, `sandbox-image.yml` | No image was published, scanned or signed by landing this change. A workflow that has not been run produced no report. The workflow's signature step records that it did not verify one. |
| StorageClass encryption check; Secret encryption required as an attestation | C1.1 confidentiality, encryption at rest | `storageClassEncrypts`; startup fails without `SAGAX_SANDBOX_K8S_SECRETS_ENCRYPTED=true` | The API cannot show etcd `EncryptionConfiguration`. An annotation can be set on a class that does not encrypt. kind `local-path` is not encryption, and the integration test turns the check off. |
| Append-only audit file, fsync, no-follow, https ship, Events create-only | CC7.1, CC7.2 monitoring; CC4.1 the record used to evaluate the control | `server/sandbox-audit.ts`; Role verb `create` on Events | The Deployment's audit volume is emptyDir unless the operator replaces it. Ship failures are logged and do not block. Events expire. A collector has to be operated. |
| Per-Pod requests and limits; ResourceQuota read-only to the provisioner; readiness requires caps on pods, cpu, memory and storage | A1.2 capacity | `quotaProblems`, `podFromDockerSpec` resources, Role verbs `get` and `list` on quotas | The sample numbers in `resourcequota.yaml` are not sized for a given cluster. Pause releases memory, so a paused slot does not consume the Pod's memory the way `docker pause` does. Pid and file-size rlimits are not enforced by core Kubernetes. |

## Tests

Unit tests do not need a cluster: `server/sandboxd-k8s-spec.test.ts` and
`server/sandboxd-k8s.test.ts`. The kind script
`scripts/sandbox-k8s-kind.sh` runs `server/sandboxd-k8s.integration.test.ts`
only when `SAGAX_SANDBOX_K8S_INTEGRATION=1`, then deletes the cluster. It is
not part of `pnpm test:unit`.

## Gaps

- No portable per-Pod pid limit or `RLIMIT_FSIZE`.
- Pause deletes the Pod. The slot stays taken; the memory does not.
- Without metrics-server, CPU and current memory stats are 0.
- etcd encryption and CNI enforcement are attestations.
- This repository change does not publish, sign or scan an image.
- kind is a functional check of the API adapter. It is not evidence for
  encryption, signatures, vulnerability scan or NetworkPolicy enforcement.
- The integration kubeconfig is cluster-admin. Production uses the
  ServiceAccount in `rbac.yaml`.
