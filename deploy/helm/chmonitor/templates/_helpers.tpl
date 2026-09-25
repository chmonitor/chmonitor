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

{{/*
Custom alert webhook targets (issue #3414).

Env contract rendered by this chart when `alertWebhooks.enabled` is true:

  - `HEALTH_ALERT_WEBHOOK_TARGETS` (ConfigMap, JSON array): one object per
    target with ONLY non-secret fields —
    {name, enabled, format, minSeverity, urlEnv, [titleTemplate],
     [textTemplate], [headers], [headersEnv]}.
  - `HEALTH_ALERT_WEBHOOK_TARGET_<i>_URL` (Secret, per target): the webhook
    URL. Chart-managed key when `url` is inlined, external Secret when
    `urlFrom` is set. Referenced from the JSON via `urlEnv`.
  - `HEALTH_ALERT_WEBHOOK_TARGET_<i>_HEADERS` (Secret, optional): JSON object
    of secret headers. Referenced from the JSON via `headersEnv`.

Webhook URLs are bearer credentials (Slack/Matrix URLs embed tokens), so they
NEVER land in the ConfigMap — only secretKeyRef pointers do. Deploy-time
validation here is fail-fast UX; the app still revalidates URLs (HTTPS + SSRF
guard), formats, template allowlists, and payload-size caps at save/send time.
*/}}

{{/*
Validate alertWebhooks values. Fails the render with a descriptive message.
Emits nothing on success. Runs on every render path (ConfigMap, Secret,
Deployment) so no combination can silently skip validation.
*/}}
{{- define "chmonitor.alertWebhooks.validate" -}}
{{- if .Values.alertWebhooks.enabled }}
{{- $defaults := .Values.alertWebhooks.defaults | default dict }}
{{- $defFormat := $defaults.format | default "auto" }}
{{- $defSeverity := $defaults.minSeverity | default "warning" }}
{{- if not (has $defFormat (list "auto" "raw" "slack" "matrix")) }}
{{- fail (printf "alertWebhooks.defaults.format must be one of auto|raw|slack|matrix, got %q" $defFormat) }}
{{- end }}
{{- if not (has $defSeverity (list "warning" "critical")) }}
{{- fail (printf "alertWebhooks.defaults.minSeverity must be warning|critical, got %q" $defSeverity) }}
{{- end }}
{{- $targets := .Values.alertWebhooks.targets | default list }}
{{- if eq (len $targets) 0 }}
{{- fail "alertWebhooks.enabled is true but alertWebhooks.targets is empty — declare at least one target or set enabled: false" }}
{{- end }}
{{- if gt (len $targets) 16 }}
{{- fail (printf "alertWebhooks.targets holds %d entries, max 16 — split across releases or open an issue" (len $targets)) }}
{{- end }}
{{- $names := list }}
{{- range $i, $t := $targets }}
{{- $id := printf "alertWebhooks.targets[%d]" $i }}
{{- if not (regexMatch "^[A-Za-z0-9_-]{1,64}$" ($t.name | toString)) }}
{{- fail (printf "%s.name must match ^[A-Za-z0-9_-]{1,64}$, got %q" $id ($t.name | toString)) }}
{{- end }}
{{- if has $t.name $names }}
{{- fail (printf "%s.name %q is duplicated — target names must be unique (D1/UI overrides merge BY NAME)" $id $t.name) }}
{{- end }}
{{- $names = append $names $t.name }}
{{- $format := $t.format | default $defFormat }}
{{- if not (has $format (list "auto" "raw" "slack" "matrix")) }}
{{- fail (printf "%s %q: format must be one of auto|raw|slack|matrix, got %q" $id $t.name $format) }}
{{- end }}
{{- $sev := $t.minSeverity | default $defSeverity }}
{{- if not (has $sev (list "warning" "critical")) }}
{{- fail (printf "%s %q: minSeverity must be warning|critical, got %q" $id $t.name $sev) }}
{{- end }}
{{- $hasUrl := and $t.url (ne ($t.url | toString) "") }}
{{- $hasUrlFrom := and $t.urlFrom (and $t.urlFrom.name $t.urlFrom.key) }}
{{- if and $hasUrl $hasUrlFrom }}
{{- fail (printf "%s %q: set exactly one of url / urlFrom (both are set)" $id $t.name) }}
{{- end }}
{{- if not (or $hasUrl $hasUrlFrom) }}
{{- fail (printf "%s %q: set exactly one of url (chart Secret) / urlFrom (external Secret)" $id $t.name) }}
{{- end }}
{{- if $hasUrl }}
{{- $url := $t.url | toString }}
{{- if gt (len $url) 2048 }}
{{- fail (printf "%s %q: url exceeds 2048 chars" $id $t.name) }}
{{- end }}
{{- if not (hasPrefix "https://" $url) }}
{{- fail (printf "%s %q: url must start with https:// (got %q)" $id $t.name $url) }}
{{- end }}
{{- end }}
{{- if and $t.titleTemplate (gt (len ($t.titleTemplate | toString)) 2048) }}
{{- fail (printf "%s %q: titleTemplate exceeds 2048 chars" $id $t.name) }}
{{- end }}
{{- if and $t.textTemplate (gt (len ($t.textTemplate | toString)) 2048) }}
{{- fail (printf "%s %q: textTemplate exceeds 2048 chars" $id $t.name) }}
{{- end }}
{{- $headers := $t.headers | default list }}
{{- if gt (len $headers) 8 }}
{{- fail (printf "%s %q: at most 8 custom headers, got %d" $id $t.name (len $headers)) }}
{{- end }}
{{- range $j, $h := $headers }}
{{- if not (regexMatch "^X-[A-Za-z0-9-]{1,63}$" ($h.name | toString)) }}
{{- fail (printf "%s %q: headers[%d].name must match ^X-[A-Za-z0-9-]{1,63}$ (allowlisted X-* only), got %q" $id $t.name $j ($h.name | toString)) }}
{{- end }}
{{- if or (not $h.value) (gt (len ($h.value | toString)) 1024) }}
{{- fail (printf "%s %q: headers[%d] %q value must be 1..1024 chars — credentials belong in headersSecret*, never here" $id $t.name $j ($h.name | toString)) }}
{{- end }}
{{- end }}
{{- $hasHs := and $t.headersSecret (ne ($t.headersSecret | toString) "") }}
{{- $hasHsFrom := and $t.headersSecretFrom (and $t.headersSecretFrom.name $t.headersSecretFrom.key) }}
{{- if and $hasHs $hasHsFrom }}
{{- fail (printf "%s %q: set at most one of headersSecret / headersSecretFrom (both are set)" $id $t.name) }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Render the validated HEALTH_ALERT_WEBHOOK_TARGETS JSON array (non-secret
fields + urlEnv/headersEnv Secret pointers). Values content is data — user
{{template}} syntax passes through toJson verbatim and is never re-parsed by
Helm, so allowlisted alert variables survive rendering untouched.
*/}}
{{- define "chmonitor.alertWebhooks.targetsJson" -}}
{{- include "chmonitor.alertWebhooks.validate" . -}}
{{- $defaults := .Values.alertWebhooks.defaults | default dict }}
{{- $defFormat := $defaults.format | default "auto" }}
{{- $defSeverity := $defaults.minSeverity | default "warning" }}
{{- $out := list }}
{{- range $i, $t := .Values.alertWebhooks.targets }}
{{- $enabled := true }}
{{- if hasKey $t "enabled" }}{{ $enabled = $t.enabled }}{{ end }}
{{- $entry := dict
  "name" $t.name
  "enabled" $enabled
  "format" ($t.format | default $defFormat)
  "minSeverity" ($t.minSeverity | default $defSeverity)
  "urlEnv" (printf "HEALTH_ALERT_WEBHOOK_TARGET_%d_URL" $i)
}}
{{- if $t.titleTemplate }}{{ $_ := set $entry "titleTemplate" ($t.titleTemplate | toString) }}{{- end }}
{{- if $t.textTemplate }}{{ $_ := set $entry "textTemplate" ($t.textTemplate | toString) }}{{- end }}
{{- if $t.headers }}{{ $_ := set $entry "headers" $t.headers }}{{- end }}
{{- if or (and $t.headersSecret (ne ($t.headersSecret | toString) "")) (and $t.headersSecretFrom (and $t.headersSecretFrom.name $t.headersSecretFrom.key)) }}{{ $_ := set $entry "headersEnv" (printf "HEALTH_ALERT_WEBHOOK_TARGET_%d_HEADERS" $i) }}{{- end }}
{{- $out = append $out $entry }}
{{- end }}
{{- $out | toJson }}
{{- end }}
