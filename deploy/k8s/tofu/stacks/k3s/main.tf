module "core" {
  source = "../../core"

  name = var.name
  # This stack does not create Azure nodes. The shared pool contract still
  # requires a SKU that matches the Azure format check.
  azure_vm_size = "Standard_Unset"
}

module "k3s" {
  source = "../../adapters/k3s"

  cluster_name         = module.core.name
  oidc_issuer_url      = var.oidc_issuer_url
  oidc_client_id       = var.oidc_client_id
  oidc_admin_group     = var.oidc_admin_group
  oidc_mfa_enforced    = module.core.security.mfa_required
  server_url           = var.server_url
  audit_retention_days = module.core.security.audit_retention_days
  pool = {
    labels   = module.core.sandbox_pool.labels
    taint    = module.core.sandbox_pool.taint
    timezone = module.core.sandbox_pool.timezone
  }
}

module "proxmox" {
  source = "../../adapters/k3s-proxmox"

  enabled = var.proxmox_enabled
  name    = module.core.name
  pool = {
    proxmox_cores     = module.core.sandbox_pool.proxmox_cores
    proxmox_memory_mb = module.core.sandbox_pool.proxmox_memory_mb
  }
  server_user_data = module.k3s.server_user_data
  worker_user_data = module.k3s.worker_user_data
}

module "linode" {
  source = "../../adapters/k3s-linode"

  enabled = var.linode_enabled
  name    = module.core.name
  pool = {
    linode_type = module.core.sandbox_pool.linode_type
  }
  server_user_data = module.k3s.server_user_data
  worker_user_data = module.k3s.worker_user_data
}

module "aws" {
  source = "../../adapters/k3s-aws"

  enabled      = var.aws_enabled
  name         = module.core.name
  cluster_name = module.core.name
  pool = {
    aws_instance_type = module.core.sandbox_pool.aws_instance_type
    max_nodes         = module.core.sandbox_pool.max_nodes
    warm_nodes_night  = module.core.sandbox_pool.warm_nodes_night
  }
  server_user_data = module.k3s.server_user_data
  worker_user_data = module.k3s.worker_user_data
}

output "oidc_admin_group" {
  value = module.k3s.oidc_admin_group
}

output "audit_retention_days" {
  value = module.k3s.audit_retention_days
}
