output "server_user_data" {
  description = "cloud-init for the k3s server. Contains no join token and no encryption key."
  value       = local.server_user_data
}

output "worker_user_data" {
  description = "cloud-init for a tainted sandbox worker."
  value       = local.worker_user_data
}

output "oidc_admin_group" {
  description = "Group the Helm chart should bind. The same value as admin.group in values-k3s.yaml."
  value       = var.oidc_admin_group
}

output "audit_retention_days" {
  description = "Object-lock retention the offsite audit bucket must enforce."
  value       = var.audit_retention_days
}
