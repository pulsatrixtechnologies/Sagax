output "server_ids" {
  value = aws_instance.server[*].id
}

output "worker_group" {
  value = one(aws_autoscaling_group.worker[*].name)
}
