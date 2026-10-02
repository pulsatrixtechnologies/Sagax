// A group's shared memory (server/routes/group-memory.ts): its people read
// it, its owner edits it or switches it off.
import { api } from "@/state/store";
import type { MemoryCapacity } from "@/lib/memory";

export interface GroupMemoryView {
  enabled: boolean;
  /** The group's owner: the server's word, never guessed here. */
  canEdit: boolean;
  text: string;
  hash: string;
  capacity: MemoryCapacity;
}

export function fetchGroupMemory(groupId: string): Promise<GroupMemoryView> {
  return api<GroupMemoryView>(`/api/groups/${encodeURIComponent(groupId)}/memory`);
}

export function saveGroupMemory(groupId: string, body: { text?: string; expectedHash?: string; enabled?: boolean }): Promise<GroupMemoryView> {
  return api<GroupMemoryView>(`/api/groups/${encodeURIComponent(groupId)}/memory`, { method: "PUT", body: JSON.stringify(body) });
}
