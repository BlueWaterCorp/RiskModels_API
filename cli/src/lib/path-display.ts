import { homedir } from "node:os";

/** Shorten home-prefixed paths for readability (~ on POSIX; Windows uses same tilde-in-shell convention in Git Bash). */
export function abbreviatePath(absolutePath: string): string {
  if (!absolutePath.trim()) return absolutePath;
  const home = homedir();
  if (absolutePath === home) return "~";
  const sep = absolutePath.includes("\\") ? "\\" : "/";
  const homeNorm = home.replace(/\\/g, "/");
  const pathNorm = absolutePath.replace(/\\/g, "/");
  if (pathNorm === homeNorm || pathNorm === `${homeNorm}/`) return "~";
  if (pathNorm.startsWith(`${homeNorm}/`)) {
    return `~/${pathNorm.slice(homeNorm.length + 1)}`;
  }
  return absolutePath;
}
