locals {
  audit_policy = file("${path.module}/../../../audit/policy.yaml")

  server_user_data = templatefile("${path.module}/cloud-init-server.yaml.tftpl", {
    audit_policy_b64 = base64encode(local.audit_policy)
    audit_log_maxage = 30
    oidc_issuer_url  = var.oidc_issuer_url
    oidc_client_id   = var.oidc_client_id
  })

  worker_user_data = templatefile("${path.module}/cloud-init-worker.yaml.tftpl", {
    server_url = var.server_url
    taint      = var.pool.taint
    labels     = var.pool.labels
  })
}
