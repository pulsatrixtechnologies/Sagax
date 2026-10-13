resource "azurerm_resource_group" "this" {
  count    = local.on ? 1 : 0
  name     = "${var.name}-sandboxes"
  location = var.location
}

resource "azurerm_virtual_network" "this" {
  count               = local.on ? 1 : 0
  name                = "${var.name}-vnet"
  location            = azurerm_resource_group.this[0].location
  resource_group_name = azurerm_resource_group.this[0].name
  address_space       = ["10.214.0.0/16"]
}

resource "azurerm_subnet" "nodes" {
  count                = local.on ? 1 : 0
  name                 = "nodes"
  resource_group_name  = azurerm_resource_group.this[0].name
  virtual_network_name = azurerm_virtual_network.this[0].name
  address_prefixes     = ["10.214.1.0/24"]
}

resource "azurerm_user_assigned_identity" "cluster" {
  count               = local.on ? 1 : 0
  name                = "${var.name}-aks"
  location            = azurerm_resource_group.this[0].location
  resource_group_name = azurerm_resource_group.this[0].name
}

resource "azurerm_user_assigned_identity" "disk" {
  count               = local.on ? 1 : 0
  name                = "${var.name}-disk"
  location            = azurerm_resource_group.this[0].location
  resource_group_name = azurerm_resource_group.this[0].name
}

resource "azurerm_user_assigned_identity" "audit" {
  count               = local.on ? 1 : 0
  name                = "${var.name}-audit"
  location            = azurerm_resource_group.this[0].location
  resource_group_name = azurerm_resource_group.this[0].name
}
