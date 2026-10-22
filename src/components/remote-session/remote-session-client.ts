// Browser calls for one Tailcat session. The address never travels here.
import { api } from "@/state/store";

const sessionPath = (botId: string, id: string, action: string) =>
  `/api/bots/${encodeURIComponent(botId)}/remote-sessions/${encodeURIComponent(id)}/${action}`;

function failure(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export async function closeRemoteSession(botId: string, id: string): Promise<string | null> {
  try {
    await api(sessionPath(botId, id, "close"), { method: "POST" });
    return null;
  } catch (error) {
    return failure(error, "The session could not be closed.");
  }
}

export async function focusRemoteSession(botId: string, id: string): Promise<string | null> {
  try {
    await api(sessionPath(botId, id, "focus"), { method: "POST" });
    return null;
  } catch (error) {
    return failure(error, "That remote session is not open.");
  }
}

export async function openRemoteShell(botId: string, id: string): Promise<string | null> {
  try {
    await api(sessionPath(botId, id, "shell"), { method: "POST" });
    return null;
  } catch (error) {
    return failure(error, "This remote computer did not open a shell.");
  }
}

export function uploadFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._ -]/g, "_").replace(/^\.+/, "").slice(0, 120);
  return /^[A-Za-z0-9]/.test(cleaned) ? cleaned : `file_${cleaned || "bin"}`;
}

export async function uploadRemoteFile(botId: string, id: string, file: File): Promise<string | null> {
  if (file.size <= 0 || file.size > 8 * 1024 * 1024) return "The file must be under 8 MB.";
  const dataBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const comma = text.indexOf(",");
      resolve(comma >= 0 ? text.slice(comma + 1) : text);
    };
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
  try {
    await api(sessionPath(botId, id, "upload"), {
      method: "POST",
      body: JSON.stringify({ name: uploadFileName(file.name), dataBase64 }),
    });
    return null;
  } catch (error) {
    return failure(error, "The file did not arrive on the remote computer.");
  }
}

export async function downloadRemoteFile(botId: string, id: string, remotePath: string): Promise<string | null> {
  const res = await fetch(sessionPath(botId, id, "download"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: remotePath }),
  });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || type.includes("json")) {
    const body = await res.json().catch(() => ({})) as { error?: unknown };
    return typeof body.error === "string" ? body.error : "That file could not be downloaded.";
  }
  const blob = await res.blob();
  const match = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "");
  const name = match?.[1] || "download";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
  return null;
}
