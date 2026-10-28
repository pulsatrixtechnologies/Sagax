import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import { conversationOutputs, type DevArtifact } from "./sources";

const file = (name: string): Message => ({
  id: "m1", role: "bot", kind: "text", text: "here", at: 1,
  attachments: [{ kind: "file", path: `/api/files/a/${name}`, mime: "text/markdown", name }],
});

const artifact = (id: string, title: string, threadId: string, updatedAt: number): DevArtifact => ({ id, title, threadId, updatedAt });

describe("conversation outputs", () => {
  it("puts this conversation's artifacts before the files it attached, newest first", () => {
    const outputs = conversationOutputs(
      [artifact("art_old", "Older", "thread-1", 1), artifact("art_new", "Newer", "thread-1", 5), artifact("art_other", "Elsewhere", "thread-2", 9)],
      [file("notes.md")],
      "thread-1",
    );
    expect(outputs.map((output) => [output.kind, output.name])).toEqual([["artifact", "Newer"], ["artifact", "Older"], ["file", "notes.md"]]);
    expect(outputs[0]).toMatchObject({ artifactId: "art_new", messageId: "" });
    expect(outputs[2]).toMatchObject({ messageId: "m1", path: "/api/files/a/notes.md" });
  });

  it("drops an artifact with no title and one saved from another conversation", () => {
    const outputs = conversationOutputs([artifact("art_x", "   ", "thread-1", 1), artifact("art_y", "Kept", "thread-9", 2)], [], "thread-1");
    expect(outputs).toEqual([]);
  });
});
