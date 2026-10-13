# sagax-sandboxd on Kubernetes

Cloud-agnostic manifests for the provisioner. The kind script and the
unit tests apply this directory. The production cutover scales the
Deployment in `deploy/k8s/sandboxes/base/sandboxd.yaml` instead. Both
name `sagax-sandboxd` in `sandboxes`; apply one Deployment, not both.
Applying them creates no load
balancer and pulls no image (`example.invalid/sagax:must-set`). The design,
the environment variables, and the SOC 2 mapping are in
[`docs/sandbox-kubernetes.md`](../../../docs/sandbox-kubernetes.md).

Apply the provisioner NetworkPolicy before the default deny, then start
sagax-sandboxd. The process refuses to listen until the operator sets a
real registry, an encrypting StorageClass, TLS files, and the two
attestations (`SAGAX_SANDBOX_K8S_SECRETS_ENCRYPTED`,
`SAGAX_SANDBOX_K8S_NETWORK_POLICY`).

```bash
kubectl apply -f deploy/k8s/provisioner/namespace.yaml
kubectl apply -f deploy/k8s/provisioner/rbac.yaml
kubectl apply -f deploy/k8s/provisioner/networkpolicy-provisioner.yaml
kubectl apply -f deploy/k8s/provisioner/resourcequota.yaml
kubectl apply -f deploy/k8s/provisioner/limitrange.yaml
kubectl apply -f deploy/k8s/provisioner/sandboxd-deployment.yaml
```

`networkpolicy-default-deny.yaml` matches the object the provisioner creates
at start. The audit volume in the Deployment is an emptyDir: keep the HTTPS
ship URL (`SAGAX_SANDBOX_AUDIT_SHIP_URL`) or replace that volume if the file
must survive a reschedule.
