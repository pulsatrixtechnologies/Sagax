variable "enabled" {
  type        = bool
  description = "Create the k3s server and the sandbox autoscaling group. Off by default."
  default     = false
}

variable "name" {
  type = string
}

variable "cluster_name" {
  type = string
}

variable "ami_id" {
  type        = string
  description = "AMI with /usr/local/bin/k3s. Required when enabled."
  default     = ""
}

variable "subnet_ids" {
  type    = list(string)
  default = []
}

variable "security_group_ids" {
  type    = list(string)
  default = []
}

variable "server_instance_type" {
  type    = string
  default = "t4g.medium"
}

variable "server_count" {
  type    = number
  default = 1
}

variable "kms_key_id" {
  type        = string
  description = "Customer-managed key for the root volumes. Empty uses the account's default EBS key. Either way the volume is encrypted."
  default     = ""
}

variable "pool" {
  type = object({
    aws_instance_type = string
    max_nodes         = number
    warm_nodes_night  = number
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
