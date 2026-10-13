# Adapters

The base manifests are the product. An adapter binds them to one
provider. Azure is the one written out, because production runs there today. It
is not required for k3s on Proxmox, EKS, or LKE.

| Concern | Portable | Azure adapter |
|---|---|---|
| Nodes | cluster-autoscaler values, or Karpenter NodePool | AKS node pool command, or `karpenter.yaml` (`AKSNodeClass`) |
| Disk | a CSI class that detaches | `storageclass.yaml` (`disk.csi.azure.com`, Retain) |
| Path from Sagax | in-cluster Service | internal load balancer |
| Ingress from the VM | none until the adapter | `networkpolicy-ingress.yaml` (placeholder subnet) |
| Backups | Velero `Schedule` | Blob `BackupStorageLocation` |
| Metrics | kube-prometheus address in the ScaledObject | change the `serverAddress` in the change record if you use Azure Monitor |

Do not install cluster-autoscaler and Karpenter on the same nodes.
