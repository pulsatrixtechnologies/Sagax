variable "cluster_name" {
  type        = string
  description = "Cluster name recorded in node labels and autoscaler tags."
}

variable "oidc_issuer_url" {
  type        = string
  description = "OIDC issuer for operator login. The issuer must require MFA. This module does not create a local or shared admin user."

  validation {
    condition     = startswith(var.oidc_issuer_url, "https://")
    error_message = "oidc_issuer_url must be an https issuer."
  }
}

variable "oidc_client_id" {
  type        = string
  description = "OIDC client id the API server accepts."

  validation {
    condition     = length(var.oidc_client_id) > 0
    error_message = "oidc_client_id is required."
  }
}

variable "oidc_admin_group" {
  type        = string
  description = "Group claim that the Helm chart binds to cluster-admin. Not system:masters, not a shared account."
  default     = "sagax-admins"

  validation {
    condition     = !contains(["system:masters", "system:anonymous", "admin", "root"], var.oidc_admin_group)
    error_message = "oidc_admin_group must be a named group."
  }
}

variable "oidc_mfa_enforced" {
  type        = bool
  description = "Operator attestation that the OIDC issuer requires MFA for the admin group. The module refuses to render a server without it."
  default     = true

  validation {
    condition     = var.oidc_mfa_enforced
    error_message = "OIDC admin access must have MFA enforced at the identity provider."
  }
}

variable "server_url" {
  type        = string
  description = "https://host:6443 workers join. Not a secret."
  default     = "https://127.0.0.1:6443"
}

variable "audit_retention_days" {
  type        = number
  description = "Retention the offsite audit bucket must keep. The bucket itself is created by the operator with object lock."
  default     = 365
}

variable "pool" {
  type = object({
    labels   = map(string)
    taint    = string
    timezone = string
  })
  description = "Sandbox pool labels and taint from the core module."
}
