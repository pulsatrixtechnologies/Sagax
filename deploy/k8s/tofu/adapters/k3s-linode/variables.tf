variable "enabled" {
  type        = bool
  description = "Create Linode instances. Off by default."
  default     = false
}

variable "name" {
  type = string
}

variable "region" {
  type    = string
  default = "ca-central"
}

variable "image" {
  type        = string
  description = "Image that already contains /usr/local/bin/k3s."
  default     = "linode/ubuntu24.04"
}

variable "server_type" {
  type    = string
  default = "g6-standard-2"
}

variable "server_count" {
  type    = number
  default = 1
}

variable "worker_count" {
  type        = number
  description = "Workers to create now. The night default is 0."
  default     = 0
}

variable "pool" {
  type = object({
    linode_type = string
  })
}

variable "server_user_data" {
  type      = string
  sensitive = true
}

variable "worker_user_data" {
  type      = string
  sensitive = true
}

variable "authorized_keys" {
  type        = list(string)
  description = "SSH keys for the host, not Kubernetes admin."
  default     = []
}
