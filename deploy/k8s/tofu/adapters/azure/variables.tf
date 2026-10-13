variable "enabled" {
  type        = bool
  description = "Create the AKS cluster. Off by default. Azure is an optional adapter."
  default     = false
}

variable "production" {
  type        = bool
  description = "When true, the audit immutability policy must be locked and the API server must be restricted to named networks."
  default     = false
}

variable "name" {
  type = string
}

variable "location" {
  type    = string
  default = "canadacentral"
}

variable "admin_group_object_ids" {
  type        = list(string)
  description = "Entra ID groups that receive Azure Kubernetes Service RBAC Cluster Admin. People, not a shared account."
  default     = []
}

variable "entra_mfa_policy_id" {
  type        = string
  description = "Conditional Access policy that requires MFA for the admin groups. This module does not create tenant-wide Conditional Access."
  default     = ""
}

variable "lock_audit_immutability" {
  type        = bool
  description = "Lock the storage immutability policy. Locking is irreversible. Required when production is true."
  default     = false
}

variable "api_server_authorized_ip_ranges" {
  type        = list(string)
  description = "Networks allowed to reach the Kubernetes API. Required when production is true."
  default     = []
}

variable "system_vm_size" {
  type        = string
  description = "Arm64 system pool. It stays up so system pods and the warm-node CronJob have a place to run. It is not the sandbox pool."
  default     = "Standard_D2ps_v6"
}

variable "kubernetes_version" {
  type        = string
  description = "Empty lets AKS choose its current default."
  default     = ""
}

variable "zones" {
  type    = list(string)
  default = ["1", "2", "3"]
}

variable "audit_storage_account_name" {
  type    = string
  default = ""
}

variable "key_vault_name" {
  type    = string
  default = ""
}

variable "pool" {
  type = object({
    azure_vm_size    = string
    max_nodes        = number
    warm_nodes_night = number
    labels           = map(string)
    taint            = string
  })
}

variable "security" {
  type = object({
    audit_retention_days = number
    encryption_at_rest   = bool
    mfa_required         = bool
    named_admins_only    = bool
    shared_admin         = bool
  })

  validation {
    condition     = var.security.encryption_at_rest && var.security.mfa_required && var.security.named_admins_only && var.security.shared_admin == false
    error_message = "The core security contract requires encryption at rest, MFA, named admins and no shared admin."
  }
}

locals {
  on = var.enabled

  admin_groups_ok = length(var.admin_group_object_ids) > 0 && alltrue([
    for id in var.admin_group_object_ids : can(regex("^[0-9a-fA-F-]{36}$", id))
  ])

  mfa_ok = can(regex("^[0-9a-fA-F-]{36}$", var.entra_mfa_policy_id))
}
