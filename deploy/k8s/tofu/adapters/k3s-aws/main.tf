resource "aws_instance" "server" {
  count                  = var.enabled ? var.server_count : 0
  ami                    = var.ami_id
  instance_type          = var.server_instance_type
  subnet_id              = try(var.subnet_ids[0], null)
  vpc_security_group_ids = var.security_group_ids
  user_data              = var.server_user_data

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = 32
    encrypted   = true
    kms_key_id  = var.kms_key_id != "" ? var.kms_key_id : null
  }

  tags = {
    Name            = "${var.name}-k3s-${count.index}"
    "sagax.io/role" = "control-plane"
  }

  lifecycle {
    precondition {
      condition     = var.ami_id != "" && length(var.subnet_ids) > 0 && length(var.security_group_ids) > 0
      error_message = "ami_id, subnet_ids and security_group_ids are required to create the k3s server."
    }
  }
}

resource "aws_launch_template" "worker" {
  count                  = var.enabled ? 1 : 0
  name_prefix            = "${var.name}-sbx-"
  image_id               = var.ami_id
  instance_type          = var.pool.aws_instance_type
  user_data              = base64encode(var.worker_user_data)
  vpc_security_group_ids = var.security_group_ids
  update_default_version = true

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size           = 64
      volume_type           = "gp3"
      encrypted             = true
      kms_key_id            = var.kms_key_id != "" ? var.kms_key_id : null
      delete_on_termination = true
    }
  }

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name            = "${var.name}-sbx"
      "sagax.io/pool" = "sandboxes"
    }
  }
}

resource "aws_autoscaling_group" "worker" {
  count               = var.enabled ? 1 : 0
  name                = "${var.name}-sandboxes"
  min_size            = var.pool.warm_nodes_night
  max_size            = var.pool.max_nodes
  desired_capacity    = var.pool.warm_nodes_night
  vpc_zone_identifier = var.subnet_ids
  capacity_rebalance  = true

  launch_template {
    id      = one(aws_launch_template.worker[*].id)
    version = "$Latest"
  }

  tag {
    key                 = "k8s.io/cluster-autoscaler/enabled"
    value               = "true"
    propagate_at_launch = true
  }

  tag {
    key                 = "k8s.io/cluster-autoscaler/${var.cluster_name}"
    value               = "owned"
    propagate_at_launch = true
  }

  tag {
    key                 = "sagax.io/pool"
    value               = "sandboxes"
    propagate_at_launch = true
  }

  lifecycle {
    precondition {
      condition     = var.pool.warm_nodes_night == 0
      error_message = "The sandbox group min and desired size stay at the night value (0). The daytime node is the Helm warm pod plus cluster-autoscaler."
    }
  }
}
