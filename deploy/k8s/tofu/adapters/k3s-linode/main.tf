resource "linode_instance" "server" {
  count           = var.enabled ? var.server_count : 0
  label           = "${var.name}-k3s-${count.index}"
  type            = var.server_type
  region          = var.region
  image           = var.image
  disk_encryption = "enabled"
  booted          = true
  authorized_keys = var.authorized_keys

  metadata {
    user_data = base64encode(var.server_user_data)
  }

  tags = ["sagax", "sandboxes", "control-plane"]
}

resource "linode_instance" "worker" {
  count           = var.enabled ? var.worker_count : 0
  label           = "${var.name}-sbx-${count.index}"
  type            = var.pool.linode_type
  region          = var.region
  image           = var.image
  disk_encryption = "enabled"
  booted          = true
  authorized_keys = var.authorized_keys

  metadata {
    user_data = base64encode(var.worker_user_data)
  }

  tags = ["sagax", "sandboxes", "worker"]
}
