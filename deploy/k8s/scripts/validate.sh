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

# Reserve and one node per person (both off by default).
if grep -Eq "sagax-sandbox-spare\"?$|name: sandboxes-dedicated" "$tmp/default.yaml"; then
  echo "reserve or dedicated policy rendered while off" >&2
  exit 1
fi
helm template sandboxes "$chart" --set warmNode.spare.enabled=true --set admission.dedicated.enabled=true \
  --set 'warmNode.spare.nodeSelector.sagax\.io/isolation=dedicated' > "$tmp/dedicated.yaml"
for want in "kind: PriorityClass" "preemptionPolicy: Never" "priorityClassName: sagax-sandbox-spare" \
  "name: sagax-sandbox-spare-scaler" "name: sandboxes-dedicated" "sagax.io/isolation: dedicated" "sagax.io/pool: sandboxes"; do
  if ! grep -q "$want" "$tmp/dedicated.yaml"; then
    echo "dedicated render is missing $want" >&2
    exit 1
  fi
done

# Cloud agent runs (off by default). Rendered with a sample digest: the
# run Role has no exec, no log and no read of Secrets; the namespace has its
# own quota, default deny and admission policy.
run_image="registry.example.com/agents/sagax-run:0.1.0@sha256:$(printf 'ab%.0s' $(seq 1 32))"
helm template sandboxes "$chart" --set runs.enabled=true --set "runs.allowedImages[0]=$run_image" --set "runs.callerCidrs[0]=10.20.30.40/32" > "$tmp/runs.yaml"
if helm template sandboxes "$chart" --set runs.enabled=true --set "runs.callerCidrs[0]=10.20.30.40/32" > /dev/null 2>&1; then
  echo "runs rendered without an image allowlist" >&2
  exit 1
fi
if helm template sandboxes "$chart" --set runs.enabled=true --set "runs.allowedImages[0]=registry.example.com/agents/sagax-run:0.1.0" --set "runs.callerCidrs[0]=10.20.30.40/32" > /dev/null 2>&1; then
  echo "runs admitted an image without a digest" >&2
  exit 1
fi
if grep -q "sagax-run-quota" "$tmp/default.yaml"; then
  echo "runs rendered while runs.enabled is false" >&2
  exit 1
fi
run_role=$(awk '
  $0 == "kind: Role" { inrole = 1; buf = "" }
  inrole { buf = buf $0 "\n" }
  inrole && $0 == "---" { if (buf ~ /name: sagax-sandboxd-runs/) { printf "%s", buf; exit } inrole = 0 }
' "$tmp/runs.yaml")
printf '%s\n' "$run_role" | grep -q 'resources: \["secrets"\]'
if printf '%s\n' "$run_role" | grep -Eq 'pods/exec|pods/log|nodes|"\*"'; then
  echo "sagax-sandboxd-runs Role is wider than run objects" >&2
  exit 1
fi
if printf '%s\n' "$run_role" | grep -A2 'resources: \["secrets"\]' | grep -Eq '"get"|"list"|"watch"'; then
  echo "sagax-sandboxd-runs Role can read Secrets" >&2
  exit 1
fi
for want in "name: sagax-run-quota" "name: sagax-run-workload" "name: sandboxes-runs" "name: provisioner-runs" "automountServiceAccountToken: false"; do
  if ! grep -q "$want" "$tmp/runs.yaml"; then
    echo "runs render is missing $want" >&2
    exit 1
  fi
done

# Shared-namespace layout: the provisioner kit (deploy/k8s/provisioner) owns
# the sandbox namespace, its Role and the per-person policies. The chart must
# not redeclare them, must keep the provisioner off the placement rule and
# must render the provisioner guard.
helm template sandboxes "$chart" -f "$chart/values-azure.yaml" \
  --set createSandboxNamespace=false \
  --set sandboxEgressPolicy.enabled=false \
  --set provisionerRbac.enabled=false \
  --set admission.provisionerGuard.enabled=true \
  --set admission.provisionerGuard.serviceAccount=system:serviceaccount:sandboxes:sagax-sandboxd \
  --set-json 'admission.placementObjectSelector={"matchExpressions":[{"key":"com.pulsatrix.sagax.sandbox.user","operator":"Exists"}]}' \
  > "$tmp/shared.yaml"
for unwanted in 'name: "sandboxes"$' 'name: sandbox-egress$' 'name: sagax-sandboxd$'; do
  if grep -Eq "^  $unwanted" "$tmp/shared.yaml"; then
    echo "shared-namespace render still declares $unwanted" >&2
    exit 1
  fi
done
for want in "name: sandboxes-provisioner-guard" "objectSelector:" "operations: \[\"CONNECT\"\]" "168.63.129.16/32"; do
  if ! grep -q "$want" "$tmp/shared.yaml"; then
    echo "shared-namespace render is missing $want" >&2
    exit 1
  fi
done
if grep -q "name: sandboxes-provisioner-guard" "$tmp/default.yaml"; then
  echo "the provisioner guard must stay off by default" >&2
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
