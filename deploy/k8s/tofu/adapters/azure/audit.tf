resource "azurerm_storage_account" "audit" {
  count                             = local.on ? 1 : 0
  name                              = var.audit_storage_account_name
  resource_group_name               = azurerm_resource_group.this[0].name
  location                          = azurerm_resource_group.this[0].location
  account_kind                      = "StorageV2"
  account_tier                      = "Standard"
  account_replication_type          = "GRS"
  min_tls_version                   = "TLS1_2"
  https_traffic_only_enabled        = true
  allow_nested_items_to_be_public   = false
  shared_access_key_enabled         = false
  infrastructure_encryption_enabled = true
  public_network_access_enabled     = true

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.audit[0].id]
  }

  blob_properties {
    versioning_enabled  = true
    change_feed_enabled = true

    delete_retention_policy {
      days = var.security.audit_retention_days
    }

    container_delete_retention_policy {
      days = var.security.audit_retention_days
    }
  }

  network_rules {
    default_action = "Deny"
    bypass         = ["AzureServices", "Logging", "Metrics"]
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_storage_account_customer_managed_key" "audit" {
  count                     = local.on ? 1 : 0
  storage_account_id        = azurerm_storage_account.audit[0].id
  key_vault_id              = azurerm_key_vault.this[0].id
  key_name                  = azurerm_key_vault_key.audit[0].name
  user_assigned_identity_id = azurerm_user_assigned_identity.audit[0].id

  depends_on = [azurerm_role_assignment.audit_key]
}

resource "azurerm_storage_container" "audit" {
  count                 = local.on ? 1 : 0
  name                  = "kube-audit"
  storage_account_id    = azurerm_storage_account.audit[0].id
  container_access_type = "private"
}

resource "azurerm_storage_container_immutability_policy" "audit" {
  count                                 = local.on ? 1 : 0
  storage_container_resource_manager_id = azurerm_storage_container.audit[0].id
  immutability_period_in_days           = var.security.audit_retention_days
  protected_append_writes_all_enabled   = true
  locked                                = var.lock_audit_immutability
}

resource "azurerm_monitor_diagnostic_setting" "aks" {
  count              = local.on ? 1 : 0
  name               = "${var.name}-kube-audit"
  target_resource_id = azurerm_kubernetes_cluster.this[0].id
  storage_account_id = azurerm_storage_account.audit[0].id

  enabled_log {
    category = "kube-apiserver"
  }

  enabled_log {
    category = "kube-audit"
  }

  enabled_log {
    category = "kube-audit-admin"
  }

  enabled_log {
    category = "guard"
  }

  enabled_log {
    category = "cluster-autoscaler"
  }
}

resource "terraform_data" "production_gates" {
  count = local.on && var.production ? 1 : 0

  lifecycle {
    precondition {
      condition     = var.lock_audit_immutability && length(var.api_server_authorized_ip_ranges) > 0
      error_message = "Production locks the audit immutability policy and restricts the API server to named networks."
    }
  }
}
