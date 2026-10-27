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

# The sandbox pool has its own subnet and leaves through its own NAT gateway:
# an address that no allow list trusts, distinct from the cluster's load
# balancer and from any server of the operator. The NAT gateway wins over the
# load balancer's outbound rules for this subnet only.
resource "azurerm_subnet" "sandboxes" {
  count                = local.on ? 1 : 0
  name                 = "sandbox-nodes"
  resource_group_name  = azurerm_resource_group.this[0].name
  virtual_network_name = azurerm_virtual_network.this[0].name
  address_prefixes     = ["10.214.2.0/24"]
}

resource "azurerm_public_ip" "sandbox_egress" {
  count               = local.on ? 1 : 0
  name                = "${var.name}-sandbox-egress"
  location            = azurerm_resource_group.this[0].location
  resource_group_name = azurerm_resource_group.this[0].name
  allocation_method   = "Static"
  sku                 = "Standard"
  zones               = var.zones
}

resource "azurerm_nat_gateway" "sandboxes" {
  count                   = local.on ? 1 : 0
  name                    = "${var.name}-sandbox-nat"
  location                = azurerm_resource_group.this[0].location
  resource_group_name     = azurerm_resource_group.this[0].name
  sku_name                = "Standard"
  idle_timeout_in_minutes = 4
}

resource "azurerm_nat_gateway_public_ip_association" "sandboxes" {
  count                = local.on ? 1 : 0
  nat_gateway_id       = azurerm_nat_gateway.sandboxes[0].id
  public_ip_address_id = azurerm_public_ip.sandbox_egress[0].id
}

resource "azurerm_subnet_nat_gateway_association" "sandboxes" {
  count          = local.on ? 1 : 0
  subnet_id      = azurerm_subnet.sandboxes[0].id
  nat_gateway_id = azurerm_nat_gateway.sandboxes[0].id
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
