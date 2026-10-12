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
  type    = string
  default = "canadacentral"
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
