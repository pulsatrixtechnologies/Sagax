output "server_ids" {
  value = linode_instance.server[*].id
}

output "worker_ids" {
  value = linode_instance.worker[*].id
}
