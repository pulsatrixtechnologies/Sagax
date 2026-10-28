# Sagax server chart

Installs the Sagax server (the image from `install.sh`), not the per-person sandboxes and not a hosted fleet. The chart lives in the repo so a self-hosted install can render it. No workflow applies it, and `helm install` is not run from here.

The server process still binds `127.0.0.1`. An edge proxy in the same pod reaches it, as `deploy/docker-compose.yml` does, and the Service publishes that proxy.

```sh
helm lint deploy/k8s/helm/server
helm template sagax deploy/k8s/helm/server
```

Set `image.tag` to a real release and `domain` to your host before you apply the chart on a cluster of your own.
