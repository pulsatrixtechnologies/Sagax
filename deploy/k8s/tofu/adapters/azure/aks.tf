resource "azurerm_role_assignment" "cluster_network" {
  count                = local.on ? 1 : 0
  scope                = azurerm_virtual_network.this[0].id
  role_definition_name = "Network Contributor"
  principal_id         = azurerm_user_assigned_identity.cluster[0].principal_id
}

resource "azurerm_role_assignment" "cluster_machines" {
  count                = local.on ? 1 : 0
  scope                = azurerm_resource_group.this[0].id
  role_definition_name = "Virtual Machine Contributor"
  principal_id         = azurerm_user_assigned_identity.cluster[0].principal_id
}

resource "azurerm_kubernetes_cluster" "this" {
  count               = local.on ? 1 : 0
  name                = "${var.name}-aks"
  location            = azurerm_resource_group.this[0].location
  resource_group_name = azurerm_resource_group.this[0].name
  dns_prefix          = "${var.name}-sbx"
  sku_tier            = "Free"
  kubernetes_version  = var.kubernetes_version != "" ? var.kubernetes_version : null

  # No local kubeconfig account and no shared admin certificate.
  local_account_disabled            = true
  role_based_access_control_enabled = true
  oidc_issuer_enabled               = true
  workload_identity_enabled         = true
  azure_policy_enabled              = false

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.cluster[0].id]
  }

  azure_active_directory_role_based_access_control {
    tenant_id              = data.azurerm_client_config.current.tenant_id
    azure_rbac_enabled     = true
    admin_group_object_ids = var.admin_group_object_ids
  }

  # One disk encryption set for every node pool's OS disks and for volumes.
  disk_encryption_set_id = azurerm_disk_encryption_set.this[0].id

  key_management_service {
    key_vault_key_id         = azurerm_key_vault_key.etcd[0].id
    key_vault_network_access = "Public"
  }

  dynamic "api_server_access_profile" {
    for_each = length(var.api_server_authorized_ip_ranges) > 0 ? [1] : []
    content {
      authorized_ip_ranges = var.api_server_authorized_ip_ranges
    }
  }

  default_node_pool {
    name                 = "system"
    vm_size              = var.system_vm_size
    auto_scaling_enabled = true
    min_count            = 1
    max_count            = 2
    os_disk_size_gb      = 64
    os_disk_type         = "Managed"
    os_sku               = "AzureLinux"
    vnet_subnet_id       = azurerm_subnet.nodes[0].id
    zones                = var.zones

    upgrade_settings {
      max_surge = "10%"
    }
  }

  network_profile {
    network_plugin      = "azure"
    network_plugin_mode = "overlay"
    network_policy      = "azure"
    load_balancer_sku   = "standard"
    outbound_type       = "loadBalancer"
    service_cidr        = "10.215.0.0/16"
    dns_service_ip      = "10.215.0.10"
    pod_cidr            = "10.216.0.0/16"
  }

  depends_on = [
    azurerm_role_assignment.cluster_key,
    azurerm_role_assignment.cluster_network,
    azurerm_role_assignment.cluster_machines,
    azurerm_role_assignment.disk_key,
  ]

  lifecycle {
    precondition {
      condition = (
        local.admin_groups_ok &&
        local.mfa_ok &&
        var.security.shared_admin == false &&
        can(regex("^[a-z0-9]{3,24}$", var.audit_storage_account_name)) &&
        can(regex("^[a-zA-Z][-a-zA-Z0-9]{1,22}[a-zA-Z0-9]$", var.key_vault_name))
      )
      error_message = "AKS admin access is Entra ID groups with a Conditional Access MFA policy. Local accounts stay disabled. Audit storage and Key Vault need unique names."
    }
  }
}

resource "azurerm_kubernetes_cluster_node_pool" "sandboxes" {
  count                 = local.on ? 1 : 0
  name                  = "sbx"
  kubernetes_cluster_id = azurerm_kubernetes_cluster.this[0].id
  vm_size               = var.pool.azure_vm_size
  mode                  = "User"
  os_sku                = "AzureLinux"
  os_disk_size_gb       = 128
  os_disk_type          = "Managed"
  auto_scaling_enabled  = true
  min_count             = var.pool.warm_nodes_night
  max_count             = var.pool.max_nodes
  scale_down_mode       = "Delete"
  vnet_subnet_id        = azurerm_subnet.nodes[0].id
  zones                 = var.zones
  node_labels           = var.pool.labels
  node_taints           = [var.pool.taint]

  upgrade_settings {
    max_surge = "33%"
  }

  lifecycle {
    precondition {
      condition     = can(regex("^Standard_[A-Za-z0-9_]+$", var.pool.azure_vm_size)) && var.pool.warm_nodes_night == 0
      error_message = "The sandbox pool azure_vm_size must be an Azure VM SKU of the form Standard_ followed by letters, digits or underscores, and its autoscaler minimum is the night value, 0. One daytime node is the Helm warm pod."
    }
  }
}

resource "azurerm_role_assignment" "admins" {
  count                = local.on ? length(var.admin_group_object_ids) : 0
  scope                = azurerm_kubernetes_cluster.this[0].id
  role_definition_name = "Azure Kubernetes Service RBAC Cluster Admin"
  principal_id         = var.admin_group_object_ids[count.index]
  principal_type       = "Group"
}
