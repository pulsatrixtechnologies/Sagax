output "name" {
  value       = var.name
  description = "Short name shared by the adapters."
}

output "sandbox_pool" {
  description = "Worker pool contract. Adapters map it onto their own machines. Daytime warmth is a pod, not a raised autoscaler minimum, so a quiet night can reach zero workers."
  value = {
    arch              = "arm64"
    vcpus             = 4
    memory_gib        = 16
    azure_vm_size     = "Standard_D4ps_v6"
    aws_instance_type = "t4g.xlarge"
    # Linode has no 4 vCPU / 16 GiB plan. This is 6 vCPU / 16 GiB.
    linode_type       = "g6-standard-8"
    proxmox_cores     = 4
    proxmox_memory_mb = 16384
    max_nodes         = var.max_nodes
    warm_nodes_day    = var.warm_nodes_day
    warm_nodes_night  = var.warm_nodes_night
    timezone          = var.timezone
    scale_up          = var.scale_up
    scale_down        = var.scale_down
    labels = {
      "sagax.io/pool" = "sandboxes"
    }
    taint = "sagax.io/sandboxes=true:NoSchedule"
  }
}

output "security" {
  description = "Controls every adapter has to keep. See deploy/k8s/SOC2.md."
  value = {
    audit_retention_days = var.audit_retention_days
    encryption_at_rest   = true
    mfa_required         = true
    named_admins_only    = true
    shared_admin         = false
    image_signature      = true
    image_scan           = true
    backup_offsite       = true
  }
}
