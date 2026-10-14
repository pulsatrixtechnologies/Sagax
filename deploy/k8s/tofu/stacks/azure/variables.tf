variable "subscription_id" {
  type        = string
  description = "Azure subscription. Required only when enabled is true and someone plans this stack."
  default     = "00000000-0000-0000-0000-000000000000"
}

variable "enabled" {
  type        = bool
  description = "Leave false. This stack does not create resources unless an operator sets it."
  default     = false
}

variable "production" {
  type    = bool
  default = false
}

variable "name" {
  type    = string
  default = "sagax"
}

variable "location" {
  type        = string
  description = "Azure region. Required. No default: set it in terraform.tfvars from the change record."

  validation {
    condition     = can(regex("^[a-z]+[a-z0-9]*$", var.location))
    error_message = "location must be an Azure region name: a lowercase letter, then lowercase letters or digits (for example <region>)."
  }
}

variable "system_vm_size" {
  type        = string
  description = "Arm64 system pool SKU. Required. No default: set it in terraform.tfvars from the change record."

  validation {
    condition     = can(regex("^Standard_[A-Za-z0-9_]+$", var.system_vm_size))
    error_message = "system_vm_size must be an Azure VM SKU of the form Standard_ followed by letters, digits or underscores."
  }
}

variable "azure_vm_size" {
  type        = string
  description = "Sandbox pool SKU. Required. No default: set it in terraform.tfvars from the change record."

  validation {
    condition     = can(regex("^Standard_[A-Za-z0-9_]+$", var.azure_vm_size))
    error_message = "azure_vm_size must be an Azure VM SKU of the form Standard_ followed by letters, digits or underscores."
  }
}

variable "admin_group_object_ids" {
  type    = list(string)
  default = []
}

variable "entra_mfa_policy_id" {
  type    = string
  default = ""
}

variable "lock_audit_immutability" {
  type    = bool
  default = false
}

variable "api_server_authorized_ip_ranges" {
  type    = list(string)
  default = []
}

variable "audit_storage_account_name" {
  type    = string
  default = ""
}

variable "key_vault_name" {
  type    = string
  default = ""
}
