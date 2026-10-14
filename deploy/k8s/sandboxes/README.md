# Sagax sandbox pool

Portable Kubernetes layout for per-person server environments. The Sagax
process on the production VM stays where it is. This tree is the sandbox pool
only. Azure files are an adapter; the base does not name an Azure API.

Nothing here is applied by CI. Applying it creates cluster objects. Follow
`docs/ops/sandboxes/cutover-rollback.md`. The Deployment in
`base/sandboxd.yaml` is the one that cutover scales.
`deploy/k8s/provisioner/` is the same process for a kind check; do not
apply both Deployments.

## What scales

| Signal | Object | Effect |
|---|---|---|
| A `sagax-user-*` pod is Pending | cluster-autoscaler **or** Karpenter | A node is added. Pick one. |
| Pending count (before you delete the buffer) | `sagax-sandbox-pending` (KEDA) | One 1 CPU / 1536Mi buffer pod per pending sandbox, which the autoscaler treats as demand. |
| A Redis list `sagax-sandbox-pending` | `autoscaling/keda-queue.yaml` | Same buffer, from a queue. Apply it **instead of** the pending buffer. |
| Weekdays 07:30–19:00 America/Toronto | `sagax-sandbox-warm` (KEDA cron) | One small pause pod so the pool does not scale to zero during the day. |

`sagax-sandboxd` is one replica. It is not autoscaled: it holds the
in-memory idle clock the Docker provisioner holds today.

## Layout

- `base/` is cloud-agnostic: namespace, network policy, provisioner (0
  replicas), probes on `/healthz`, RBAC, the warm schedule, the pending
  buffer, Prometheus rules, the Velero schedule.
- `autoscaling/cluster-autoscaler.values.yaml` and
  `autoscaling/karpenter-nodepool.yaml` are the portable autoscaler
  configs. The Karpenter pool's `nodeClassRef` is a placeholder.
- `adapters/azure/` adds the disk class, the internal load balancer, the
  production ingress rule, and the Blob backup location. Autoscaler choice:
  `adapters/azure/cluster-autoscaler.values.yaml` (self-managed) or the
  AKS node pool command in the runbook, **or**
  `adapters/azure/karpenter.yaml`. Not both.
- Other providers replace the adapter: storage class, node class, load
  balancer, backup location. Proxmox has no node autoscaler; keep the warm
  deployment and a fixed node count.

## Safety defaults

- `sagax-sandboxd` `replicas: 0` until the cutover runbook scales it.
  `SANDBOX_BACKEND=kubernetes` runs the Kubernetes backend.
- The production NetworkPolicy allows `192.0.2.10/32` (TEST-NET-1) until the
  change record replaces it.
- Workspace disks use a detachable class (`Retain`). A local-path volume
  pins the node and the pool cannot scale to zero.
- Delete `sagax-sandbox-pending` before the driver creates sandbox pods,
  or capacity is reserved twice.

## Health

The provisioner readiness, liveness and startup probes are
`GET /healthz` on port 8791, the same unauthenticated check as
`deploy/docker-compose.sandbox.yml`. Alerts are
`base/prometheus-rules.yaml`.
