// Resolve a stable build identifier for version.json + compile-time defines.
// Priority: APP_BUILD_ID env (CI) → git short SHA → local timestamp fallback.
import { execSync } from 'node:child_process';

export function resolveBuildId() {
  const fromEnv = process.env.APP_BUILD_ID?.trim();
  if (fromEnv) return fromEnv;

  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  }
}
