variable "name" {
  type        = string
  description = "Short name used by every adapter. Lowercase letters, digits and hyphens."

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,18}$", var.name))
    error_message = "name must be 2 to 19 characters: a lowercase letter, then letters, digits or hyphens."
  }
}

variable "azure_vm_size" {
  type        = string
  description = "Azure VM SKU for the sandbox pool. Required. No default: the Azure stack sets it from terraform.tfvars. Other stacks pass a dummy SKU that matches the same format so this module stays shareable."

  validation {
    condition     = can(regex("^Standard_[A-Za-z0-9_]+$", var.azure_vm_size))
    error_message = "azure_vm_size must be an Azure VM SKU of the form Standard_ followed by letters, digits or underscores."
  }
}

variable "timezone" {
  type        = string
  description = "IANA timezone for the warm-node window. America/Toronto matches the production daytime."
  default     = "America/Toronto"
}

variable "scale_up" {
  type        = string
  description = "Cron, in timezone, at which one sandbox node is held warm."
  default     = "0 7 * * *"
}

variable "scale_down" {
  type        = string
  description = "Cron, in timezone, at which the warm sandbox node is released. The pool min stays 0."
  default     = "0 19 * * *"
}

variable "warm_nodes_day" {
  type        = number
  description = "Sandbox nodes to keep warm during the day window."
  default     = 1

  validation {
    condition     = var.warm_nodes_day >= 0 && var.warm_nodes_day <= 3
    error_message = "warm_nodes_day must be between 0 and 3."
  }
}

variable "warm_nodes_night" {
  type        = number
  description = "Sandbox nodes kept at night. The recommended value is 0."
  default     = 0

  validation {
    condition     = var.warm_nodes_night >= 0 && var.warm_nodes_night <= var.warm_nodes_day
    error_message = "warm_nodes_night must be between 0 and warm_nodes_day."
  }
}

variable "max_nodes" {
  type        = number
  description = "Upper bound of the sandbox pool. <REGION>'s 10 vCPU quota needs a raise before this can be large."
  default     = 4

  validation {
    condition     = var.max_nodes >= 1 && var.max_nodes <= 20 && var.max_nodes >= var.warm_nodes_day
    error_message = "max_nodes must be at least warm_nodes_day and at most 20."
  }
}

variable "audit_retention_days" {
  type        = number
  description = "How long API audit records stay immutable."
  default     = 365

  validation {
    condition     = var.audit_retention_days >= 365
    error_message = "audit_retention_days must be at least 365."
  }
}
