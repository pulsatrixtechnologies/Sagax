// Types for the generated electron/local-vm-recipe.mjs.
export const CONTAINER: string;
export const IMAGE: string;
export const BASE_IMAGE: string;
export const CUA_SOCKET: string;
export const MANAGED_LABEL: string;
export const IMAGE_LABELS: Record<string, string>;
export const DOCKERFILE: string;
export function runArgs(runtime: "docker" | "podman", password: string, workspaceDir: string): string[];
