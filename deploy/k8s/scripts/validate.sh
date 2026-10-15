#!/bin/sh
# Render the chart and type-check the OpenTofu stacks.
# Does not run tofu plan, tofu apply, helm install, or any cloud API.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)
chart="$root/deploy/k8s/helm/sandboxes"
policy="$root/deploy/k8s/audit/policy.yaml"
copy="$chart/files/audit-policy.yaml"

if ! cmp -s "$policy" "$copy"; then
  echo "audit policy drifted between $policy and $copy" >&2
  exit 1
fi

helm lint "$chart"
helm lint "$chart" -f "$chart/values-azure.yaml"
helm lint "$chart" -f "$chart/values-k3s.yaml"

render() {
  out=$1
  shift
  helm template sandboxes "$chart" "$@" > "$out"
}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
render "$tmp/default.yaml"
render "$tmp/azure.yaml" -f "$chart/values-azure.yaml"
render "$tmp/k3s.yaml" -f "$chart/values-k3s.yaml"
helm template sandboxes "$chart" --set provisioner.enabled=true > "$tmp/provisioner.yaml"

for file in "$tmp/default.yaml" "$tmp/azure.yaml" "$tmp/k3s.yaml"; do
  for kind in Namespace ServiceAccount Role RoleBinding NetworkPolicy StorageClass ValidatingAdmissionPolicy ClusterPolicy Schedule; do
    if ! grep -q "^kind: $kind$" "$file"; then
      echo "$file is missing kind $kind" >&2
      exit 1
    fi
  done
  if grep -q "docker.sock" "$file"; then
    echo "$file mentions a Docker socket" >&2
    exit 1
  fi
  if grep -q "system:masters" "$file"; then
    echo "$file grants system:masters" >&2
    exit 1
  fi
done

if ! grep -q "168.63.129.16/32" "$tmp/default.yaml"; then
  echo "sandbox egress policy dropped the Azure WireServer" >&2
  exit 1
fi
if ! grep -q "diskEncryptionSetID" "$tmp/azure.yaml"; then
  echo "azure overlay did not render a disk encryption set" >&2
  exit 1
fi
if ! grep -q "kind: ClusterRoleBinding" "$tmp/k3s.yaml"; then
  echo "k3s overlay did not bind the named OIDC group" >&2
  exit 1
fi
if grep -q "kind: User$" "$tmp/k3s.yaml"; then
  echo "k3s overlay has a User subject" >&2
  exit 1
fi

# The provisioner role is a Role, and its rules do not cover secrets or nodes.
role=$(awk '
  $0 == "kind: Role" { inrole = 1 }
  inrole && $0 == "---" { exit }
  inrole { print }
' "$tmp/default.yaml")
printf '%s\n' "$role" | grep -q "name: sagax-sandboxd"
if printf '%s\n' "$role" | grep -Eq "secrets|nodes|\"\\*\""; then
  echo "sagax-sandboxd Role is wider than pods and volumes" >&2
  exit 1
fi

# kubectl scale (the warm CronJobs) reads the Deployment before the scale
# subresource: the warmer Role must allow get on deployments.
if ! grep -A3 'resources: \["deployments"\]' "$tmp/default.yaml" | grep -q 'sagax-sandbox-warmer'; then
  echo "sagax-sandbox-warmer Role cannot read its Deployment" >&2
  exit 1
fi

check_stack() {
  stack="$1"
  echo "tofu validate $stack"
  (
    cd "$stack"
    tofu init -backend=false -input=false >/dev/null
    tofu validate
  )
}

check_stack "$root/deploy/k8s/tofu/stacks/azure"
check_stack "$root/deploy/k8s/tofu/stacks/k3s"

if grep -RIn --exclude=validate.sh --exclude-dir=.terraform -E 'tofu apply|terraform apply' "$root/deploy/k8s" >/dev/null; then
  echo "deploy/k8s contains an apply command" >&2
  exit 1
fi

echo "ok"
