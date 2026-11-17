// data.js: the artifacts in data/*.json, fetched once by relative path (the site lives under a subpath).

const cache = new Map();

export function load(name) {
  if (!cache.has(name)) {
    const url = `data/${name}.json`;
    cache.set(
      name,
      fetch(url).then((res) => {
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        return res.json();
      }),
    );
  }
  return cache.get(name);
}

export async function loadMany(names) {
  const values = await Promise.all(names.map((n) => load(n)));
  return Object.fromEntries(names.map((n, i) => [n, values[i]]));
}

/** True when a same-origin file exists (HEAD request), for files the pipeline may not have written yet. */
export async function exists(path) {
  try {
    const res = await fetch(path, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}
