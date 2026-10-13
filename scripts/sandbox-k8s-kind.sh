#!/bin/sh
# Opt-in kind integration for the Kubernetes sandbox backend.
# Creates only a local cluster named sagax-sandbox-kind, then deletes it.
# Does not create cloud resources. kind's local-path StorageClass is not
# encryption, the image is not signed or scanned, and kindnet does not prove
# that NetworkPolicy is enforced.
set -eu
name=sagax-sandbox-kind
if ! command -v docker >/dev/null 2>&1 || ! command -v kind >/dev/null 2>&1; then
  echo "docker and kind are required; integration not run" >&2
  exit 0
fi
echo "NOTE: kind local-path is not encryption at rest. REQUIRE_ENCRYPTION=false."
echo "NOTE: this cluster does not prove NetworkPolicy enforcement or etcd encryption."
echo "NOTE: the loaded image is not signed or scanned."
cleanup() { kind delete cluster --name "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
kind create cluster --name "$name"
kind export kubeconfig --name "$name"
kubectl apply -f deploy/k8s/provisioner/namespace.yaml
kubectl apply -f deploy/k8s/provisioner/rbac.yaml
kubectl apply -f deploy/k8s/provisioner/networkpolicy-provisioner.yaml
kubectl apply -f deploy/k8s/provisioner/resourcequota.yaml
docker pull debian:bookworm-slim
docker tag debian:bookworm-slim ghcr.io/pulsatrixtechnologies/sagax-sandbox:kind
image=ghcr.io/pulsatrixtechnologies/sagax-sandbox:kind
# kind load asks containerd to import every platform. A retagged
# multi-arch image can name a blob the save does not contain. Import
# the archive directly in that case; the tag is the same.
if ! kind load docker-image "$image" --name "$name"; then
  echo "kind load failed; importing the image without --all-platforms"
  docker save "$image" | docker exec -i "${name}-control-plane" ctr --namespace=k8s.io images import -
fi
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config}"
export SAGAX_SANDBOX_K8S_INTEGRATION=1
export SAGAX_SANDBOX_K8S_USE_KUBECONFIG=1
export SAGAX_SANDBOX_IMAGE=ghcr.io/pulsatrixtechnologies/sagax-sandbox:kind
# Older kind names this class local-path. kind 0.33 names it standard.
# Both use rancher.io/local-path. Neither encrypts.
storage_class=$(kubectl get storageclass -o jsonpath='{range .items[?(@.provisioner=="rancher.io/local-path")]}{.metadata.name}{"\n"}{end}' | head -n 1)
export SAGAX_SANDBOX_K8S_STORAGE_CLASS="${storage_class:-local-path}"
echo "storage class: $SAGAX_SANDBOX_K8S_STORAGE_CLASS"
export SAGAX_SANDBOX_K8S_REQUIRE_SIGNED=0
export SAGAX_SANDBOX_K8S_REQUIRE_ENCRYPTION=false
pnpm exec vitest run server/sandboxd-k8s.integration.test.ts
