const STORAGE_KEY = "equiply-device-type-cache";

export function loadDeviceTypeCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function saveDeviceTypeCache(cache) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Quota or private browsing — in-memory still works for the session
  }
}

export function mergeIntoCache(cache, newEntries) {
  const merged = { ...cache, ...newEntries };
  saveDeviceTypeCache(merged);
  return merged;
}

export function getUncachedPairs(pairs, cache) {
  return pairs.filter((p) => !cache[p.key]);
}

export function getCachedCount(pairs, cache) {
  return pairs.length - getUncachedPairs(pairs, cache).length;
}
