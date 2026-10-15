// Replaced at build time by Next; never inferred from a browser URL or runtime header.
export function adminPath(path: string) {
  return (process.env.NEXT_PUBLIC_ADMIN_BASE_PATH ?? "") + path;
}
