# Cutover and rollback: GOX sandboxes to the Kubernetes pool

Production today is the GOX VM `azpxcgoxglley5tfv6mykvm` in
`RG-PULSATRIX-GOX` (Canada Central, `Standard_D4pls_v6`). Sagax, the
provisioner and the sandboxes share that VM, and the provisioner is the
only container with the Docker socket (`docs/user-sandbox.md`).

This cutover moves **sandboxes** to the pool in `deploy/k8s/sandboxes/`.
It does not resize the VM, and it does not move Sagax off the VM. Those
are different changes. The VM stays up for the whole procedure.

Do not apply the manifests, create a cluster, or run the `az` commands
below until the change record in `change-management.md` is approved.
This repository does not do that apply.

The Kubernetes **driver** inside `sagax-sandboxd` is not in this build.
`SANDBOX_BACKEND=kubernetes` makes the current provisioner exit before it
opens the Docker socket (`server/sandbox-backend.ts`). Scaling the
provisioner Deployment to 1 on this image crash-loops and does not serve
traffic. User-visible downtime of that mistake is **0**, because Sagax
still points at the Docker provisioner. Fix it by scaling back to 0.

## Canary

A sandbox belongs to a person, not a bot. `SAGAX_SANDBOX_CANARY_BOTS` is
the per-bot list, and it must name **every bot of that one person**
(`sandboxBackendForBot`). Leaving a sibling bot on Docker splits one
workspace across two backends.

The list is read by the driver. This build's Sagax process still sends
every ensure to the Docker provisioner. Turning the variable on here does
not move traffic.

## Downtime

Figures are estimates for a cutover done while the driver exists, from
the idle-stop default (10 minutes), the audit's node-boot range (30–90
seconds), a workspace copy of at most 2 GiB on the same region, and a
Sagax container recreate. They are not measurements from the GOX VM.

| Step | What changes | Who is interrupted | Estimate |
|---|---|---|---|
| 1 | Approve the change record. Build and record image digests. | Nobody | 0 |
| 2 | Create the cluster and apply the Azure overlay with the provisioner at 0 replicas. Confirm the placeholder subnet was replaced. | Nobody | 0 |
| 3 | Install **one** autoscaler (AKS node pool **or** Karpenter). Confirm a scale-up drill: one buffer replica goes Ready, then back to 0. | Nobody | 0. The drill's own node boot is 30–90 seconds and is not user traffic. |
| 4 | Install Velero and take one backup of the empty namespace. Restore it into `sagax-sandboxes-drill` and delete that namespace. | Nobody | 0 |
| 5 | Pick the canary person. Stop their Docker sandbox (`POST .../stop`). Copy `/workspace` to the PVC. | That person, if a bot is mid-command | **1–5 minutes** for that person. Everyone else: 0. |
| 6 | Set `SAGAX_SANDBOX_CANARY_BOTS` to that person's bots and recreate **only** the Sagax container so the process reloads the environment. | Every open websocket and voice call drops once | **20–40 seconds** for everyone. In-flight turns fail and can be sent again. Their sandboxes are not deleted. |
| 7 | Watch one office day. `SagaxSandboxPendingTooLong` must not fire for the canary. | Nobody if the warm node is up. First command on a cold node adds **30–90 seconds** once. | 0 planned |
| 8 | Delete the ScaledObject `sagax-sandbox-pending` so real pods are not double-reserved. | Nobody | 0 |
| 9 | Add the next people by repeating step 5, batching step 6 into **one** recreate. | Each person: **1–5 minutes** while their disk is copied. One **20–40 second** websocket drop for the batch. | as above |
| 10 | Full cutover: `SANDBOX_BACKEND=kubernetes` on Sagax, empty the canary list, recreate Sagax once. | Everyone, one websocket drop | **20–40 seconds**. A person whose pod starts on the warm node waits about **10–30 seconds** for the first command; a cold node adds **30–90 seconds**. |
| 11 | After a quiet day, remove the Docker socket from the GOX provisioner and leave `SANDBOX_BACKEND=docker` available in the compose file. | Nobody, if step 10 is healthy. Recreating the old provisioner is not a Sagax restart. | 0 |

Planned user-visible interruption for a one-person canary then a full
flip: one or two **20–40 second** drops, plus **1–5 minutes** per person
while that person's disk is copied. The VM is not deallocated.

## Health check after every step

1. `GET /api/health` on Sagax returns success.
2. The Docker provisioner's `GET /healthz` on port 8791 returns success
   until step 11.
3. Once the Kubernetes provisioner is scaled to 1 (driver image only),
   its `GET /healthz` returns success and a ready probe is Ready.
4. The canary person's next tool call reaches the backend named by
   `sandboxBackendForBot`.
5. No page from `base/prometheus-rules.yaml` is firing.

## Rollback

Set `SANDBOX_BACKEND=docker` on the Sagax container, clear
`SAGAX_SANDBOX_CANARY_BOTS`, and recreate that container.

| Situation | Extra work | Estimate |
|---|---|---|
| Canary only, no one wrote on the PVC | Env flip and recreate | **20–40 seconds** for everyone |
| Someone wrote on a PVC | Copy that workspace back onto the Docker volume, then the env flip | **1–5 minutes** for that person, plus **20–40 seconds** for everyone |
| Provisioner Deployment was scaled up on this image | Scale it to 0. Sagax is still on Docker. | **0** for users |

Rollback does not resize the VM and does not restore a Velero backup
unless the Docker volume was destroyed. That restore is
`backup-restore.md`.

## AKS node pool (cluster-autoscaler)

Use this **or** `adapters/azure/karpenter.yaml`, not both. `max-count` 1
matches the arm64 vCPU quota observed on 12 October 2026 (10 total, 4
used by this VM). Raising it is a separate change record.

```bash
az aks nodepool add \
  --resource-group RG-PULSATRIX-GOX \
  --cluster-name REPLACE_CLUSTER \
  --name sbox \
  --mode User \
  --node-count 0 \
  --enable-cluster-autoscaler \
  --min-count 0 \
  --max-count 1 \
  --node-vm-size Standard_D4ps_v6 \
  --os-sku Ubuntu \
  --node-taints sagax.pulsatrix.ca/pool=sandboxes:NoSchedule \
  --labels sagax.pulsatrix.ca/pool=sandboxes
```

Self-managed clusters on Azure VMs use
`adapters/azure/cluster-autoscaler.values.yaml` instead of this command.

## SOC 2

Evidence for change approval and this procedure: CC8.1, CC5.2.
Evidence for the capacity and the rollback: A1.1, A1.2, CC7.5.
The map is `soc2-evidence.md`.
