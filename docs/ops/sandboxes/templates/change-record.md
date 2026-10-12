# Sandbox pool change record

Do not commit a filled record that contains a subnet, a storage account
key, or an image pull secret. Commit the empty headings only.

- Date:
- Pull request:
- Git SHA:
- Image digest (Sagax / provisioner):
- Image digest (sandbox):
- Cluster:
- Autoscaler in use (cluster-autoscaler or Karpenter):
- GOX subnet written into the NetworkPolicy (not `192.0.2.10/32`):
- Approved by:
- Applied by:
- `kubectl diff` summary:
- Health checks after apply (`/api/health`, provisioner `/healthz`):
- Rollback command (written before apply): `SANDBOX_BACKEND=docker`, clear `SAGAX_SANDBOX_CANARY_BOTS`, recreate the Sagax container
- Result:
