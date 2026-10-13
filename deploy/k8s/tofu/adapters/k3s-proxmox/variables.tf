variable "enabled" {
  type        = bool
  description = "Create Proxmox VMs. Off by default so a validate or an accidental plan creates nothing."
  default     = false
}

variable "name" {
  type = string
}

variable "node_name" {
  type    = string
  default = "pve"
}

variable "datastore_id" {
  type    = string
  default = "local-lvm"
}

variable "snippet_datastore_id" {
  type    = string
  default = "local"
}

variable "bridge" {
  type    = string
  default = "vmbr0"
}

variable "template_id" {
  type        = number
  description = "VM id of a cloud image that already has /usr/local/bin/k3s. Required when enabled."
  default     = 0
}

variable "server_count" {
  type    = number
  default = 1
}

variable "worker_count" {
  type        = number
  description = "Workers to create now. Night default is 0. A scaler raises this while pods are pending; the chart's warm pod asks for one node in the daytime."
  default     = 0
}

variable "disk_encryption" {
  type        = string
  description = "How the Proxmox disk is encrypted at rest. Proxmox has no single API flag; the storage behind datastore_id must be one of these."
  default     = "luks"

  validation {
    condition     = contains(["luks", "zfs", "ceph"], var.disk_encryption)
    error_message = "disk_encryption must be luks, zfs or ceph. Unencrypted disks are not a sandbox target."
  }
}

variable "pool" {
  type = object({
    proxmox_cores     = number
    proxmox_memory_mb = number
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

variable "tags" {
  type    = list(string)
  default = ["sagax", "sandboxes"]
}
