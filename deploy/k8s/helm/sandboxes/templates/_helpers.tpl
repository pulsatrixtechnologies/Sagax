{{- define "sandboxes.labels" -}}
app.kubernetes.io/name: sandboxes
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: sagax
{{- end -}}

{{- define "sandboxes.storage.assert" -}}
{{- if not .Values.storage.encrypted -}}
{{- fail "storage.encrypted must be true (encryption at rest)" -}}
{{- end -}}
{{- $p := .Values.storage.parameters -}}
{{- $enc := index $p "encrypted" | default "" | toString -}}
{{- $des := index $p "diskEncryptionSetID" | default "" | toString -}}
{{- $kms := index $p "kmsKeyId" | default "" | toString -}}
{{- if and (ne $enc "true") (eq $des "") (eq $kms "") -}}
{{- fail "StorageClass parameters must set encrypted=true, diskEncryptionSetID, or kmsKeyId" -}}
{{- end -}}
{{- end -}}

{{- define "sandboxes.backup.assert" -}}
{{- if .Values.backup.enabled -}}
{{- if eq .Values.backup.productionProvider .Values.backup.destination.provider -}}
{{- fail "backup.destination.provider must differ from backup.productionProvider (offsite copy)" -}}
{{- end -}}
{{- if or (eq .Values.backup.destination.bucket "") (eq .Values.backup.destination.endpoint "") -}}
{{- fail "backup.destination.bucket and endpoint are required" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "sandboxes.images.assert" -}}
{{- if not (has .Values.warmNode.pauseImage .Values.admission.allowedImages) -}}
{{- fail "warmNode.pauseImage must be listed in admission.allowedImages" -}}
{{- end -}}
{{- if not (has .Values.warmNode.kubectlImage .Values.admission.allowedImages) -}}
{{- fail "warmNode.kubectlImage must be listed in admission.allowedImages" -}}
{{- end -}}
{{- range .Values.admission.allowedImages -}}
{{- if not (contains "@sha256:" .) -}}
{{- fail (printf "operational image %s must be pinned by digest" .) -}}
{{- end -}}
{{- end -}}
{{- if or (hasSuffix ":latest" .Values.sandbox.image) (hasSuffix ":latest" .Values.provisioner.image) -}}
{{- fail "sandbox and provisioner images must not use the latest tag" -}}
{{- end -}}
{{- if not .Values.apiServer.cidrs -}}
{{- fail "apiServer.cidrs must name the Kubernetes API the provisioner may reach" -}}
{{- end -}}
{{- $group := .Values.admin.group -}}
{{- if or (eq $group "system:masters") (eq $group "system:anonymous") (eq $group "admin") (eq $group "root") -}}
{{- fail "admin.group must be a named group, not a shared or built-in admin" -}}
{{- end -}}
{{- end -}}
