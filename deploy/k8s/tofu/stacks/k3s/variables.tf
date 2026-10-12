variable "name" {
  type    = string
  default = "sagax"
}

variable "oidc_issuer_url" {
  type    = string
  default = "https://idp.example.invalid/realms/sagax"
}

variable "oidc_client_id" {
  type    = string
  default = "sagax"
}

variable "oidc_admin_group" {
  type    = string
  default = "sagax-admins"
}

variable "server_url" {
  type    = string
  default = "https://127.0.0.1:6443"
}

variable "proxmox_endpoint" {
  type    = string
  default = "https://127.0.0.1:8006"
}

variable "proxmox_api_token" {
  type      = string
  sensitive = true
  default   = "user@pve!sagax=placeholder"
}

variable "linode_token" {
  type      = string
  sensitive = true
  default   = "placeholder"
}

variable "aws_region" {
  type    = string
  default = "ca-central-1"
}

variable "proxmox_enabled" {
  type    = bool
  default = false
}

variable "linode_enabled" {
  type    = bool
  default = false
}

variable "aws_enabled" {
  type    = bool
  default = false
}
