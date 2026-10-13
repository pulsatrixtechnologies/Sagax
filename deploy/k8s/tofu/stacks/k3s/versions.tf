terraform {
  required_version = ">= 1.6.0"

  required_providers {
    proxmox = {
      source  = "bpg/proxmox"
      version = "~> 0.66"
    }
    linode = {
      source  = "linode/linode"
      version = "~> 2.23"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }
}

provider "proxmox" {
  endpoint  = var.proxmox_endpoint
  api_token = var.proxmox_api_token
  insecure  = true
}

provider "linode" {
  token = var.linode_token
}

provider "aws" {
  region = var.aws_region
}
