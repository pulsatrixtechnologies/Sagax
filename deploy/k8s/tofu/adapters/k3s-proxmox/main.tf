resource "proxmox_virtual_environment_file" "server_user_data" {
  count        = var.enabled ? 1 : 0
  content_type = "snippets"
  datastore_id = var.snippet_datastore_id
  node_name    = var.node_name

  source_raw {
    data      = var.server_user_data
    file_name = "${var.name}-k3s-server.yaml"
  }
}

resource "proxmox_virtual_environment_file" "worker_user_data" {
  count        = var.enabled ? 1 : 0
  content_type = "snippets"
  datastore_id = var.snippet_datastore_id
  node_name    = var.node_name

  source_raw {
    data      = var.worker_user_data
    file_name = "${var.name}-k3s-worker.yaml"
  }
}

resource "proxmox_virtual_environment_vm" "server" {
  count     = var.enabled ? var.server_count : 0
  name      = "${var.name}-k3s-${count.index}"
  node_name = var.node_name
  started   = true
  on_boot   = true
  tags      = var.tags

  description = "Sagax k3s control plane. Disk encryption: ${var.disk_encryption}. Operator login is OIDC, not a shared root kubeconfig."

  clone {
    vm_id = var.template_id
  }

  cpu {
    cores = 2
    type  = "host"
  }

  memory {
    dedicated = 4096
  }

  disk {
    datastore_id = var.datastore_id
    interface    = "scsi0"
    size         = 32
    discard      = "on"
    ssd          = true
  }

  network_device {
    bridge = var.bridge
  }

  operating_system {
    type = "l26"
  }

  agent {
    enabled = true
  }

  initialization {
    datastore_id      = var.snippet_datastore_id
    user_data_file_id = one(proxmox_virtual_environment_file.server_user_data[*].id)
  }

  lifecycle {
    precondition {
      condition     = var.template_id > 0 && contains(["luks", "zfs", "ceph"], var.disk_encryption)
      error_message = "A cloud-image template id and disk encryption (luks, zfs or ceph) are required."
    }
  }
}

resource "proxmox_virtual_environment_vm" "worker" {
  count     = var.enabled ? var.worker_count : 0
  name      = "${var.name}-sbx-${count.index}"
  node_name = var.node_name
  started   = true
  on_boot   = false
  tags      = var.tags

  description = "Sagax sandbox worker (${var.pool.proxmox_cores} vCPU, ${var.pool.proxmox_memory_mb} MiB). Disk encryption: ${var.disk_encryption}."

  clone {
    vm_id = var.template_id
  }

  cpu {
    cores = var.pool.proxmox_cores
    type  = "host"
  }

  memory {
    dedicated = var.pool.proxmox_memory_mb
  }

  disk {
    datastore_id = var.datastore_id
    interface    = "scsi0"
    size         = 64
    discard      = "on"
    ssd          = true
  }

  network_device {
    bridge = var.bridge
  }

  operating_system {
    type = "l26"
  }

  agent {
    enabled = true
  }

  initialization {
    datastore_id      = var.snippet_datastore_id
    user_data_file_id = one(proxmox_virtual_environment_file.worker_user_data[*].id)
  }
}
