# GCP setup for the Hermes deployment webhook

Do not run the GitHub deployment workflow until every verification at the end
of this guide passes. Run infrastructure commands with an administrator account,
not the VM runtime service account.

## Known VM values

```bash
PROJECT_ID="stately-atrium-391613"
VM_NAME="john-cos-repair-disk"
ZONE="asia-southeast1-c"
REGION="asia-southeast1"
NETWORK="default"
SUBNET="default"
BACKEND_IP="10.148.0.3"
RUNTIME_SERVICE_ACCOUNT="john-cos-vm-runtime@stately-atrium-391613.iam.gserviceaccount.com"

PORT="3000"
NEG_NAME="hermes-notification-neg"
HEALTH_CHECK="hermes-notification-health"
BACKEND_SERVICE="hermes-notification-backend"
ARMOR_POLICY="hermes-notification-armor"

URL_MAP="REPLACE_WITH_EXISTING_GLOBAL_URL_MAP"
FIREWALL_POLICY="REPLACE_WITH_EXISTING_GLOBAL_NETWORK_FIREWALL_POLICY"
WEBHOOK_HOST="REPLACE_WITH_DEDICATED_DNS_NAME"
```

Discover the existing resources before replacing the final three values:

```bash
gcloud compute url-maps list --project="$PROJECT_ID"
gcloud compute forwarding-rules list --global --project="$PROJECT_ID"
gcloud compute network-firewall-policies list \
  --global-firewall-policy \
  --project="$PROJECT_ID"
```

Use a dedicated host such as `hermes-hooks.example.com`. This avoids changing
path behavior for an existing application host.

## 1. Create one shared signing secret

The same random value belongs in Secret Manager and in the GitHub `production`
environment. It must not be committed or placed in a service unit.

```bash
gcloud services enable secretmanager.googleapis.com \
  --project="$PROJECT_ID"

WEBHOOK_SECRET="$(openssl rand -hex 32)"

printf '%s' "$WEBHOOK_SECRET" \
  | gcloud secrets create hermes-deploy-webhook-secret \
      --data-file=- \
      --replication-policy=automatic \
      --project="$PROJECT_ID"

gcloud secrets add-iam-policy-binding hermes-deploy-webhook-secret \
  --member="serviceAccount:${RUNTIME_SERVICE_ACCOUNT}" \
  --role="roles/secretmanager.secretAccessor" \
  --project="$PROJECT_ID"

printf '%s' "$WEBHOOK_SECRET" \
  | gh secret set HERMES_DEPLOY_WEBHOOK_SECRET \
      --env production \
      --repo Alpon-LLC/hermes-agent-config

unset WEBHOOK_SECRET
```

If the secret already exists, add a version instead of creating it:

```bash
printf '%s' "$WEBHOOK_SECRET" \
  | gcloud secrets versions add hermes-deploy-webhook-secret \
      --data-file=- \
      --project="$PROJECT_ID"
```

The VM already has the required `cloud-platform` OAuth scope. The remaining IAM
requirement is the secret-level accessor binding above.

## 2. Install but do not start the user service yet

On the VM:

```bash
cd /home/Work/hermes-notification-server
npm ci
npm run build
npm prune --omit=dev
mkdir -p /home/Work/.config/systemd/user
cp deploy/hermes-notification-server.service \
  /home/Work/.config/systemd/user/hermes-notification-server.service
systemctl --user daemon-reload
systemctl --user enable hermes-notification-server.service
```

For automatic boot without an interactive login, run once as an administrator:

```bash
sudo loginctl enable-linger Work
```

Do not grant blanket passwordless sudo. The `Work` user needs only the exact
existing Hermes gateway command used by the stop/start helpers.

## 3. Create a zonal NEG for the existing VM

A `GCE_VM_IP_PORT` zonal network endpoint group is cleaner than creating an
instance group solely for this one service.

```bash
gcloud compute network-endpoint-groups create "$NEG_NAME" \
  --network-endpoint-type=GCE_VM_IP_PORT \
  --network="$NETWORK" \
  --subnet="$SUBNET" \
  --default-port="$PORT" \
  --zone="$ZONE" \
  --project="$PROJECT_ID"

gcloud compute network-endpoint-groups update "$NEG_NAME" \
  --add-endpoint="instance=${VM_NAME},ip=${BACKEND_IP},port=${PORT}" \
  --zone="$ZONE" \
  --project="$PROJECT_ID"
```

## 4. Create the health check and global backend service

```bash
gcloud compute health-checks create http "$HEALTH_CHECK" \
  --port="$PORT" \
  --request-path=/health \
  --check-interval=10s \
  --timeout=5s \
  --healthy-threshold=2 \
  --unhealthy-threshold=3 \
  --global \
  --project="$PROJECT_ID"

gcloud compute backend-services create "$BACKEND_SERVICE" \
  --load-balancing-scheme=EXTERNAL_MANAGED \
  --protocol=HTTP \
  --health-checks="$HEALTH_CHECK" \
  --timeout=30s \
  --enable-logging \
  --logging-sample-rate=1.0 \
  --global \
  --project="$PROJECT_ID"

gcloud compute backend-services add-backend "$BACKEND_SERVICE" \
  --network-endpoint-group="$NEG_NAME" \
  --network-endpoint-group-zone="$ZONE" \
  --global \
  --project="$PROJECT_ID"
```

The deployment request returns `202` quickly and GitHub polls, so the backend
does not need an unsafe multi-minute timeout.

## 5. Add the narrowly scoped network firewall-policy rule

For a global external Application Load Balancer, do **not** open backend port
3000 to `0.0.0.0/0`. The public frontend is the load balancer. The VM backend
should accept only Google Front End and health-check source ranges.

Choose an unused rule priority, then run:

```bash
gcloud compute network-firewall-policies rules create 1100 \
  --firewall-policy="$FIREWALL_POLICY" \
  --global-firewall-policy \
  --direction=INGRESS \
  --action=allow \
  --layer4-configs="tcp:${PORT}" \
  --src-ip-ranges="35.191.0.0/16,130.211.0.0/22" \
  --target-service-accounts="$RUNTIME_SERVICE_ACCOUNT" \
  --description="Allow global external ALB and health checks to Hermes notification backend" \
  --enable-logging \
  --project="$PROJECT_ID"
```

Confirm no higher-priority deny shadows this rule and no broad lower-priority
allow exposes port 3000 directly.

## 6. Apply Cloud Armor rate limiting

Create a backend security policy, add the webhook rate limit in preview first,
and attach it to the new backend service:

```bash
gcloud compute security-policies create "$ARMOR_POLICY" \
  --description="Protect Hermes notification and deployment webhook" \
  --project="$PROJECT_ID"

gcloud compute security-policies rules create 1000 \
  --security-policy="$ARMOR_POLICY" \
  --expression="request.method == 'POST' && request.path == '/api/deployments/hermes'" \
  --action=throttle \
  --rate-limit-threshold-count=5 \
  --rate-limit-threshold-interval-sec=60 \
  --conform-action=allow \
  --exceed-action=deny-429 \
  --enforce-on-key=IP \
  --preview \
  --project="$PROJECT_ID"

gcloud compute backend-services update "$BACKEND_SERVICE" \
  --security-policy="$ARMOR_POLICY" \
  --global \
  --project="$PROJECT_ID"
```

After reviewing Cloud Armor request logs, enforce the rule:

```bash
gcloud compute security-policies rules update 1000 \
  --security-policy="$ARMOR_POLICY" \
  --no-preview \
  --project="$PROJECT_ID"
```

The rule applies only to the initial POST. It does not rate-limit the authenticated
status polling path. Start with throttle rather than a rate-based ban because a
throttle rule can later be converted to a ban, while the reverse is not allowed.

## 7. Wire a dedicated hostname into the existing URL map

```bash
gcloud compute url-maps add-path-matcher "$URL_MAP" \
  --path-matcher-name=hermes-notification \
  --default-service="$BACKEND_SERVICE" \
  --new-hosts="$WEBHOOK_HOST" \
  --global \
  --project="$PROJECT_ID"
```

Point the dedicated DNS name at the existing HTTPS load balancer IP and ensure
the load balancer certificate covers that hostname. Do not use plain HTTP for
the webhook because TLS protects the HMAC exchange and job status token.

## 8. Start and verify without deploying Hermes

```bash
systemctl --user start hermes-notification-server.service
systemctl --user status hermes-notification-server.service
curl -fsS http://127.0.0.1:3000/health
```

After the backend is healthy and DNS/TLS works:

```bash
curl -fsS "https://${WEBHOOK_HOST}/health"
```

Set the final GitHub production environment URL:

```bash
printf 'https://%s/api/deployments/hermes' "$WEBHOOK_HOST" \
  | gh secret set HERMES_DEPLOY_WEBHOOK_URL \
      --env production \
      --repo Alpon-LLC/hermes-agent-config
```

Verify that an unsigned POST returns `401`. Do not send a valid signed POST until
you intentionally want to perform a real deployment.
