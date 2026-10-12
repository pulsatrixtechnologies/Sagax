data "azurerm_client_config" "current" {}

resource "azurerm_key_vault" "this" {
  count                         = local.on ? 1 : 0
  name                          = var.key_vault_name
  location                      = azurerm_resource_group.this[0].location
  resource_group_name           = azurerm_resource_group.this[0].name
  tenant_id                     = data.azurerm_client_config.current.tenant_id
  sku_name                      = "standard"
  purge_protection_enabled      = true
  soft_delete_retention_days    = 90
  rbac_authorization_enabled    = true
  enabled_for_disk_encryption   = true
  public_network_access_enabled = true

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_role_assignment" "disk_key" {
  count                = local.on ? 1 : 0
  scope                = azurerm_key_vault.this[0].id
  role_definition_name = "Key Vault Crypto Service Encryption User"
  principal_id         = azurerm_user_assigned_identity.disk[0].principal_id
}

resource "azurerm_role_assignment" "cluster_key" {
  count                = local.on ? 1 : 0
  scope                = azurerm_key_vault.this[0].id
  role_definition_name = "Key Vault Crypto User"
  principal_id         = azurerm_user_assigned_identity.cluster[0].principal_id
}

resource "azurerm_role_assignment" "audit_key" {
  count                = local.on ? 1 : 0
  scope                = azurerm_key_vault.this[0].id
  role_definition_name = "Key Vault Crypto Service Encryption User"
  principal_id         = azurerm_user_assigned_identity.audit[0].principal_id
}

resource "azurerm_key_vault_key" "etcd" {
  count        = local.on ? 1 : 0
  name         = "aks-etcd"
  key_vault_id = azurerm_key_vault.this[0].id
  key_type     = "RSA"
  key_size     = 2048
  key_opts     = ["wrapKey", "unwrapKey"]

  rotation_policy {
    automatic {
      time_before_expiry = "P30D"
    }
    expire_after         = "P18M"
    notify_before_expiry = "P30D"
  }

  depends_on = [azurerm_role_assignment.cluster_key]

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_key_vault_key" "disk" {
  count        = local.on ? 1 : 0
  name         = "node-disk"
  key_vault_id = azurerm_key_vault.this[0].id
  key_type     = "RSA"
  key_size     = 2048
  key_opts     = ["wrapKey", "unwrapKey"]

  rotation_policy {
    automatic {
      time_before_expiry = "P30D"
    }
    expire_after         = "P18M"
    notify_before_expiry = "P30D"
  }

  depends_on = [azurerm_role_assignment.disk_key]

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_key_vault_key" "audit" {
  count        = local.on ? 1 : 0
  name         = "audit-log"
  key_vault_id = azurerm_key_vault.this[0].id
  key_type     = "RSA"
  key_size     = 2048
  key_opts     = ["wrapKey", "unwrapKey"]

  depends_on = [azurerm_role_assignment.audit_key]

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_disk_encryption_set" "this" {
  count               = local.on ? 1 : 0
  name                = "${var.name}-des"
  resource_group_name = azurerm_resource_group.this[0].name
  location            = azurerm_resource_group.this[0].location
  key_vault_key_id    = azurerm_key_vault_key.disk[0].id
  encryption_type     = "EncryptionAtRestWithCustomerKey"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.disk[0].id]
  }

  depends_on = [azurerm_role_assignment.disk_key]
}
