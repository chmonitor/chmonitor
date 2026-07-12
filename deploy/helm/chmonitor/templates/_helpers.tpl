{{/*
Expand the name of the chart.
*/}}
{{- define "chmonitor.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this
(by the DNS naming spec). If release name contains chart name it will be used as
a full name.
*/}}
{{- define "chmonitor.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "chmonitor.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "chmonitor.labels" -}}
helm.sh/chart: {{ include "chmonitor.chart" . }}
{{ include "chmonitor.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "chmonitor.selectorLabels" -}}
app.kubernetes.io/name: {{ include "chmonitor.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use.
*/}}
{{- define "chmonitor.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "chmonitor.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
The container image reference. Falls back to the chart appVersion when
image.tag is empty.
*/}}
{{- define "chmonitor.image" -}}
{{- $tag := .Values.image.tag | default .Chart.AppVersion -}}
{{- printf "%s:%s" .Values.image.repository $tag -}}
{{- end }}

{{/*
The name of the Secret holding the ClickHouse password. Uses an existing Secret
when provided, otherwise the chart-managed one.
*/}}
{{- define "chmonitor.secretName" -}}
{{- if .Values.clickhouse.existingSecret }}
{{- .Values.clickhouse.existingSecret }}
{{- else }}
{{- include "chmonitor.fullname" . }}
{{- end }}
{{- end }}

{{/*
The name of the Secret holding CHM_TRUSTED_AUTH_SECRET. Uses an existing Secret
when auth.trusted.existingSecret is provided, otherwise the chart-managed one
(same Secret object as the ClickHouse password, keyed separately).
*/}}
{{- define "chmonitor.trustedSecretName" -}}
{{- if .Values.auth.trusted.existingSecret }}
{{- .Values.auth.trusted.existingSecret }}
{{- else }}
{{- include "chmonitor.fullname" . }}
{{- end }}
{{- end }}

{{/*
The name of the Secret holding CLERK_SECRET_KEY. Uses an existing Secret when
auth.clerk.existingSecret is provided, otherwise the chart-managed one.
*/}}
{{- define "chmonitor.clerkSecretName" -}}
{{- if .Values.auth.clerk.existingSecret }}
{{- .Values.auth.clerk.existingSecret }}
{{- else }}
{{- include "chmonitor.fullname" . }}
{{- end }}
{{- end }}

{{/*
The name of the Secret holding the app secrets (CHM_USER_CONNECTIONS_ENCRYPTION_KEY,
CHM_API_KEY_SECRET). Uses an existing Secret when secrets.existingSecret is
provided, otherwise the chart-managed one.
*/}}
{{- define "chmonitor.appSecretName" -}}
{{- if .Values.secrets.existingSecret }}
{{- .Values.secrets.existingSecret }}
{{- else }}
{{- include "chmonitor.fullname" . }}
{{- end }}
{{- end }}

{{/*
The name of the Secret holding CRON_SECRET. Uses an existing Secret when
cron.existingSecret is provided, otherwise the chart-managed one.
*/}}
{{- define "chmonitor.cronSecretName" -}}
{{- if .Values.cron.existingSecret }}
{{- .Values.cron.existingSecret }}
{{- else }}
{{- include "chmonitor.fullname" . }}
{{- end }}
{{- end }}
