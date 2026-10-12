# SOC 2 evidence for the sandbox platform

This is the mapping an auditor can follow from a control to a file in this
tree. It is evidence the platform can produce. It is not a report, and it
does not by itself satisfy a criterion: the operating organization still
has to run the control, keep the records, and review them.

The criteria names are the AICPA Trust Services Criteria (2017).

## API audit logging, immutable retention

| | |
|---|---|
| What | Every call to the Kubernetes API is logged. Secret bodies are not. The copy that is kept cannot be edited or deleted for at least 365 days. |
| Where | `audit/policy.yaml` (also the chart ConfigMap). AKS: `tofu/adapters/azure/audit.tf` diagnostic setting `kube-apiserver`, `kube-audit`, `kube-audit-admin`, `guard`, `cluster-autoscaler`, storage container immutability policy, GRS, customer-managed key. k3s: apiserver audit flags and `sagax-audit-ship` in `tofu/adapters/k3s/cloud-init-server.yaml.tftpl`. |
| Criteria | **CC7.1** detection of changes and security events. **CC7.2** monitoring of components. **CC7.3** evaluation of events. **CC4.1** monitoring of controls. |
| An auditor looks at | The diagnostic setting or the k3s audit file, a locked immutability policy or an object-lock bucket in compliance mode, and a sample record that has no secret body. |
| Limit | k3s shipping fails closed until `/etc/sagax/audit-sink.env` exists, and the bucket's object lock is created by the operator, not by this module. On AKS the policy is locked only when `production` and `lock_audit_immutability` are set. Locking is irreversible. |

## Encryption at rest: disks, etcd, secrets

| | |
|---|---|
| What | Node disks and sandbox volumes are encrypted. Kubernetes Secrets are encrypted in etcd, not only on the disk under it. |
| Where | AKS: one disk encryption set on the cluster (`disk_encryption_set_id` in `aks.tf`, key in `keys.tf`) covering node OS disks and volumes; `key_management_service` for etcd; audit account infrastructure encryption plus a customer-managed key. Chart: `storage.encrypted` and a StorageClass parameter (`encrypted=true`, `diskEncryptionSetID`, or `kmsKeyId`). k3s: `encryption-provider-config` and `encryption.yaml.example`. Proxmox: `disk_encryption` must be `luks`, `zfs` or `ceph`. Linode: `disk_encryption = "enabled"`. AWS: `encrypted = true` on the root volumes, optional `kms_key_id`. |
| Criteria | **CC6.1** logical access and system boundaries. **CC6.7** restriction on moving and storing information. **C1.1** confidential information is protected. |
| An auditor looks at | The disk encryption set, a node disk's encryption setting, the etcd KMS key or the encryption configuration, and the StorageClass parameters. |
| Limit | Proxmox has no one API flag. The adapter records which of LUKS, ZFS or Ceph the datastore uses; someone still has to turn that storage feature on. The etcd key is not in Terraform state. A file that still contains `REPLACE_ON_HOST` refuses to boot. |

## Named admin access with MFA

| | |
|---|---|
| What | Operators are people in a named group. The identity provider requires MFA. |
| Where | AKS: `azure_active_directory_role_based_access_control` with `admin_group_object_ids`, role assignment `Azure Kubernetes Service RBAC Cluster Admin` with `principal_type = Group`, and `entra_mfa_policy_id`. k3s: OIDC issuer, client id and group claim; `oidc_mfa_enforced` must be true. Helm `admin.group` on k3s (`values-k3s.yaml`). |
| Criteria | **CC6.1** identification. **CC6.2** registration and authorization before credentials. **CC6.3** authorization and removal, through group membership. **CC6.6** protection from outside threats, which is the MFA control. |
| An auditor looks at | The Entra group, the Conditional Access policy named by `entra_mfa_policy_id`, or the OIDC issuer's MFA rule, and a Kubernetes audit record of an admin request with a person in it. |
| Limit | This tree does not create a Conditional Access policy. A mistaken tenant-wide policy can lock operators out, so the module only records the policy id and refuses to build a cluster without one. On k3s, `oidc_mfa_enforced` is the operator's attestation that the issuer requires MFA. The issuer configuration is the evidence. |

## No shared or local admin

| | |
|---|---|
| What | There is no Kubernetes basic-auth user, no shared admin certificate handed to people, and no `system:masters` binding. |
| Where | AKS: `local_account_disabled = true`. Role assignments are groups only. k3s: `anonymous-auth=false`, kubeconfig mode `0600`, token only from a `0600` file. Helm refuses `admin.group` values `system:masters`, `system:anonymous`, `admin` and `root`, and the k3s binding's only subject is a Group. |
| Criteria | **CC6.1**, **CC6.2**, **CC6.3**. A shared password cannot be tied to a person, so access reviews and removal would not work. |
| An auditor looks at | `local_account_disabled`, the subject list of `sagax-named-admins`, and the absence of a distributed `k3s.yaml`. |
| Limit | k3s still writes a node certificate on the server so the process can start. That file is root-only on the host. It is a process credential, not an operator login, and it is not a group account. Copying it to a laptop is outside this design. |

## Image signing and scan admission

| | |
|---|---|
| What | A pod in the sandbox namespaces is admitted only when its image is a signed `ghcr.io/pulsatrixtechnologies/` image with a vulnerability attestation, or a digest-pinned operational image on the allowlist. Privileged pods, host paths and the Docker socket are denied. |
| Where | `templates/admission.yaml`: in-tree `ValidatingAdmissionPolicy`, and a Kyverno `ClusterPolicy` (`verifyImages`, keyless GitHub Actions, `vuln` attestation, Critical and High must be 0). |
| Criteria | **CC6.8** prevention of unauthorized or malicious software. **CC8.1** only authorized changes are deployed. **CC7.1** a denied admission is a detected event. |
| An auditor looks at | The policy, `validationFailureAction: Enforce`, and an admission denial for an unsigned image. |
| Limit | Kyverno has to be installed first; the chart renders the policy and does not install the controller. The warmer and its CronJob are excluded from signature verification and are pinned by digest instead. The GitHub subject is a wildcard until the signing workflow is fixed. |

## Backups of volumes

| | |
|---|---|
| What | Workspace volumes are snapshotted daily and sent to a provider that is not the one running the cluster. |
| Where | `templates/backup.yaml`: Velero `Schedule` and `BackupStorageLocation`. The chart refuses to render when `backup.destination.provider` equals `backup.productionProvider`. The credential Secret is not in the chart. |
| Criteria | **A1.2** backup and recovery infrastructure. **A1.3** recovery testing uses these backups; this tree does not run the test. **C1.1** the backup bucket is private and the credentials are a Secret. |
| An auditor looks at | The schedule, a completed Velero backup in the other provider, and a restore drill record. |
| Limit | Velero itself is installed separately. `s3.example.invalid` in the default values is a placeholder, not a bucket. |

## Also in the chart, same criteria

| Piece | Where | Criteria |
|---|---|---|
| Sandbox namespace, restricted Pod Security | `templates/namespaces.yaml` | **CC6.1**, **CC6.6**, **CC6.8** |
| `sagax-sandboxd` Role, one namespace, pods and volumes only | `templates/rbac.yaml` | **CC6.1**, **CC6.3** |
| Default-deny NetworkPolicy, public egress with the private and metadata ranges removed | `templates/networkpolicy.yaml` | **CC6.1**, **CC6.6** |
| StorageClass encryption required, Retain, expansion | `templates/storageclass.yaml` | **CC6.1**, **C1.1** |
| Quota and the per-sandbox memory, CPU and disk limits | `templates/quota.yaml`, `templates/contract.yaml` | **A1.1** capacity. The default of eight running environments is the pool, not the two-environment cap of the 8 GiB VM. |
| One warm node 07:00–19:00 America/Toronto, none at night | `templates/warm-node.yaml`, core `scale_up` / `scale_down` | **A1.1**. A running sandbox is not evicted to chase the night zero; the contract tells the adapter to mark a running pod unsafe to evict. |

## What is deliberately not here

The Kubernetes adapter inside `sagax-sandboxd` is not part of this change.
Until it exists, the provisioner still uses Docker and this chart's
ServiceAccount has nothing to call. Enabling a Deployment of today's
provisioner would put a Docker socket back on the cluster, which this
chart refuses to render.
