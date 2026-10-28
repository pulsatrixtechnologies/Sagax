{{- define "sagax-server.name" -}}
{{- default "sagax-server" .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "sagax-server.labels" -}}
app.kubernetes.io/name: {{ include "sagax-server.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: sagax
{{- end -}}

{{- define "sagax-server.selector" -}}
app.kubernetes.io/name: {{ include "sagax-server.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
