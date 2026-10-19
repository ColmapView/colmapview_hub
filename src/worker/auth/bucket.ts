import { AwsClient } from 'aws4fetch';
import { AccountError, type RememberedBucket } from './model';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AccountError(400, 'Invalid bucket connection.');
  return value as Record<string, unknown>;
}

function text(value: unknown, maximum = 2048): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\r\n\0]/.test(value)) throw new AccountError(400, 'Invalid bucket connection.');
  return value.trim();
}

function bucketUrl(value: unknown): string {
  const url = new URL(text(value));
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || /%2f|%5c/i.test(url.pathname)) throw new AccountError(400, 'Use an HTTPS bucket URL without a query or credentials.');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}

export function parseRememberedBucket(input: unknown): RememberedBucket {
  const body = object(input);
  if (body.remember !== true) throw new AccountError(400, 'Choose Remember this connection before saving a bucket.');
  const config = object(body.config);
  const credentials = object(body.credentials);
  const region = text(config.region, 64);
  if (!/^[a-z0-9-]+$/.test(region)) throw new AccountError(400, 'Invalid bucket region.');
  return {
    config: { baseUrl: bucketUrl(config.baseUrl), region,
      ...(config.publicBaseUrl ? { publicBaseUrl: bucketUrl(config.publicBaseUrl) } : {}) },
    credentials: { accessKeyId: text(credentials.accessKeyId, 256), secretAccessKey: text(credentials.secretAccessKey, 2048),
      ...(credentials.sessionToken ? { sessionToken: text(credentials.sessionToken, 8192) } : {}) },
    writable: body.writable === true,
  };
}

/** Only signs S3 object/list/multipart requests inside the selected root. Never fetches a bucket URL. */
export async function signBucketRequest(bucket: RememberedBucket, input: unknown): Promise<{ url: string; expiresAt: number }> {
  const body = object(input);
  const url = new URL(text(body.url, 16384));
  const root = new URL(bucket.config.baseUrl);
  const method = text(body.method, 8).toUpperCase();
  if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname) || url.username || url.password || url.hash
    || /%2f|%5c|%2e/i.test(url.pathname) || !['GET', 'HEAD', 'PUT', 'POST', 'DELETE'].includes(method)) {
    throw new AccountError(403, 'The request is outside the connected bucket.');
  }
  if (!bucket.writable && !['GET', 'HEAD'].includes(method)) throw new AccountError(403, 'This remembered connection only permits reads.');
  const allowedQuery = new Set(['list-type', 'prefix', 'delimiter', 'max-keys', 'continuation-token', 'uploads', 'uploadId', 'partNumber', 'encoding-type']);
  for (const name of url.searchParams.keys()) if (!allowedQuery.has(name)) throw new AccountError(403, 'Unsupported bucket operation.');
  if (url.pathname === root.pathname && (method !== 'GET' || url.searchParams.get('list-type') !== '2')) throw new AccountError(403, 'Bucket administration is unavailable.');
  url.searchParams.set('X-Amz-Expires', '120');
  const client = new AwsClient({ ...bucket.credentials, region: bucket.config.region, service: 's3' });
  const signed = await client.sign(url.href, { method, aws: { signQuery: true } });
  return { url: signed.url, expiresAt: Date.now() + 110_000 };
}
