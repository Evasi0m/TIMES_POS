// Fetch runtime JSON assets (version.json, updates.json) with CDN/cache bypass.
// GitHub Pages serves max-age=600; cache: no-store alone does not bust Fastly CDN.

export function runtimeFetchUrl(path, bust = Date.now()) {
  const clean = String(path).replace(/^\.\//, '');
  return `./${clean}?v=${bust}`;
}

export function runtimeFetch(path, init = {}) {
  return fetch(runtimeFetchUrl(path), { cache: 'no-store', ...init });
}
