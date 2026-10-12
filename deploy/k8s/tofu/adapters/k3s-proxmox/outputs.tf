output "server_names" {
  value = proxmox_virtual_environment_vm.server[*].name
}

output "worker_names" {
  value = proxmox_virtual_environment_vm.worker[*].name
}
