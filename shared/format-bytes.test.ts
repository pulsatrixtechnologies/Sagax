import { describe, expect, it } from "vitest";
import { formatArchiveBytes, formatDebuggerBytes, formatPanelBytes } from "./format-bytes";

describe("format-bytes", () => {
  it("keeps the archive wording", () => {
    expect(formatArchiveBytes(512)).toBe("512 B");
    expect(formatArchiveBytes(1536)).toBe("1.5 KB");
    expect(formatArchiveBytes(2 * 1024 * 1024)).toBe("2.0 MB");
  });

  it("keeps the debugger wording", () => {
    expect(formatDebuggerBytes(null)).toBe("");
    expect(formatDebuggerBytes(1536)).toBe("1.5 kB");
  });

  it("keeps the environment panel wording", () => {
    expect(formatPanelBytes(undefined)).toBe("?");
    expect(formatPanelBytes(5 * 1024 * 1024)).toBe("5 MiB");
    expect(formatPanelBytes(1.5 * 1024 ** 3)).toBe("1.5 GiB");
  });
});
