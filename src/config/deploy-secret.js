const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

const DEFAULT_SECRET_NAME = 'hermes-deploy-webhook-secret';

function secretVersionResource(projectId, secretName, version) {
  if (secretName.startsWith('projects/')) {
    return secretName.includes('/versions/')
      ? secretName
      : `${secretName}/versions/${version}`;
  }

  return `projects/${projectId}/secrets/${secretName}/versions/${version}`;
}

async function loadDeployWebhookSecret(options = {}) {
  const env = options.env || process.env;
  const client = options.client || new SecretManagerServiceClient();

  if (env.HERMES_DEPLOY_WEBHOOK_SECRET) {
    if (env.NODE_ENV === 'production' || env.ALLOW_LOCAL_DEPLOY_SECRET !== 'true') {
      throw new Error(
        'Refusing HERMES_DEPLOY_WEBHOOK_SECRET from the environment; use Secret Manager in production',
      );
    }

    return env.HERMES_DEPLOY_WEBHOOK_SECRET;
  }

  const projectId =
    env.HERMES_GSM_PROJECT_ID ||
    (await client.getProjectId());
  const secretName =
    env.HERMES_DEPLOY_WEBHOOK_SECRET_NAME || DEFAULT_SECRET_NAME;
  const version = env.HERMES_DEPLOY_WEBHOOK_SECRET_VERSION || 'latest';
  const name = secretVersionResource(projectId, secretName, version);

  const [response] = await client.accessSecretVersion({ name });
  const secret = response.payload?.data
    ?.toString('utf8')
    .replace(/\r?\n$/, '');

  if (!secret) {
    throw new Error(`Secret Manager returned an empty payload for ${name}`);
  }

  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('Deployment webhook secret must contain at least 32 bytes');
  }

  return secret;
}

module.exports = {
  DEFAULT_SECRET_NAME,
  loadDeployWebhookSecret,
  secretVersionResource,
};
