# Access review: sandbox pool

Do this before the first canary, and on the first Monday of each
quarter after that. The reviewer is not the only person who holds
cluster-admin. Store the filled `templates/access-review.md` with the
change records. An empty template is not a review.

## What is in scope

- The `sagax-sandboxd` ServiceAccount and Role
  (`deploy/k8s/sandboxes/base/rbac.yaml`): pods, pod exec, pod logs, and
  claims in `<RESOURCE_GROUP>` only. It must not be able to read Secrets
  or touch another namespace.
- Humans and automation who can `kubectl exec` into a sandbox, change
  the node pool, or read a Velero backup.
- On Azure: the role assignments on the cluster, `<RESOURCE_GROUP>`,
  and the Blob account `REPLACE_STORAGE_ACCOUNT`.
  source de vérité = goxcloud
- On the production VM, until the socket is removed: who is in the Docker
  group that owns `/var/run/docker.sock`.
- The HMAC key file. It stays mode 0440 and is never copied into a
  ticket, a log, or a change record.

## Steps

1. Export the Role and the RoleBindings in `<RESOURCE_GROUP>` and the
   ClusterRoleBindings that name this cluster. Diff them against
   `rbac.yaml`. Anything wider is a finding.
2. List who signed in to the cluster since the previous review. Remove
   anyone who has left the operator role, the same day, and record the
   removal.
3. List Azure role assignments on the cluster and the backup account.
   Owner and Contributor on the backup account should be the backup
   identity and the two operators, not the whole directory.
4. Confirm the production NetworkPolicy is the subnet from the change record,
   not `192.0.2.10/32`, and that no Service of type LoadBalancer in
   `<RESOURCE_GROUP>` is public.
5. Confirm `sagax-sandboxd` is still the only workload with a service
   account token in the namespace. Sandbox pods set
   `automountServiceAccountToken: false`.
6. File findings as incidents if a sandbox could be exec'd by someone
   outside the operator list. Otherwise attach the checklist to the
   quarter's change record.

A finding that is still open at the next canary blocks the canary.

## SOC 2

Evidence for logical access, authorization, removal, and the network
boundary: CC6.1, CC6.2, CC6.3, CC6.6, CC6.7. The map is
`soc2-evidence.md`.
