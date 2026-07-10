// Latest release patch id from src/data/updates.json (patches[0].id).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function resolveReleasePatchId(root = process.cwd()) {
  try {
    const raw = readFileSync(join(root, 'src', 'data', 'updates.json'), 'utf8');
    const data = JSON.parse(raw);
    const id = data?.patches?.[0]?.id;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}
