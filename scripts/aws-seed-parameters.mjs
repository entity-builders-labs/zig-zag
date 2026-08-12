#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const envPath = resolve(process.argv[2] || '.env');
const parameterName = process.env.AWS_APP_PARAMETER || '/zig-zag/prod/app';
const region = process.env.AWS_REGION || 'us-east-1';

function parseEnv(source) {
  const values = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    values[match[1]] = value;
  }
  return values;
}

const source = parseEnv(readFileSync(envPath, 'utf8'));
const allowedKeys = [
  'GROQ_API_KEY',
  'GEOAPIFY_API_KEY',
  'GOOGLE_MAPS_API_KEY',
  'JWT_ACCESS_SECRET',
  'JWT_ACCESS_EXPIRES_IN',
  'JWT_REFRESH_SECRET',
  'JWT_REFRESH_EXPIRES_IN',
  'GOOGLE_CLIENT_IDS',
  'APPLE_CLIENT_IDS',
  'EMAIL_OTP_TTL_MINUTES',
  'EMAIL_OTP_MAX_ATTEMPTS',
  'EMAIL_OTP_RESEND_COOLDOWN_SECONDS',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
];
const requiredKeys = [
  'GROQ_API_KEY',
  'GEOAPIFY_API_KEY',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'GOOGLE_CLIENT_IDS',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASS',
];

const missing = requiredKeys.filter((key) => !source[key]);
if (missing.length) {
  console.error(`Missing required values in ${envPath}: ${missing.join(', ')}`);
  process.exit(1);
}

const unsafe = requiredKeys.filter((key) => {
  const value = source[key].toLowerCase();
  return (
    value.includes('dummy') ||
    value.includes('your_') ||
    value.includes('dev-insecure') ||
    value.includes('example.com')
  );
});
if (unsafe.length) {
  console.error(
    `Refusing to seed placeholder/development values for: ${unsafe.join(', ')}`,
  );
  process.exit(1);
}

const parameterValue = Object.fromEntries(
  allowedKeys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]),
);

const cliInput = JSON.stringify({
  Name: parameterName,
  Description: 'Zig Zag production application configuration',
  Type: 'SecureString',
  Value: JSON.stringify(parameterValue),
  Overwrite: true,
});

const result = spawnSync(
  'aws',
  ['ssm', 'put-parameter', '--region', region, '--cli-input-json', 'file:///dev/stdin'],
  { input: cliInput, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
);

if (result.status !== 0) {
  console.error(`Could not update ${parameterName}: ${result.stderr.trim()}`);
  process.exit(result.status || 1);
}

console.log(`Updated ${parameterName} in ${region} without printing secret values.`);
