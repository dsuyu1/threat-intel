function fnv1a32Hex(input: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function fingerprintDatabaseUrl(databaseUrl: string | undefined) {
  if (!databaseUrl) return "unset";
  return fnv1a32Hex(databaseUrl);
}

export function summarizeDatabaseUrl(databaseUrl: string | undefined) {
  if (!databaseUrl) return {};
  try {
    const u = new URL(databaseUrl);
    const db = u.pathname.replace(/^\/+/, "");
    return { host: u.host, database: db || undefined };
  } catch {
    return {};
  }
}

