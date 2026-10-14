import { expect, it } from "vitest";

import { sseEventCut, sseEventData } from "./sse.ts";

function drain(buffer: string): { frames: string[]; rest: string } {
  const frames: string[] = [];
  let cut = sseEventCut(buffer);
  while (cut) {
    const block = buffer.slice(0, cut.at);
    buffer = buffer.slice(cut.at + cut.skip);
    cut = sseEventCut(buffer);
    const data = sseEventData(block);
    if (data) frames.push(data);
  }
  return { frames, rest: buffer };
}

it("cuts LF events and CRLF events, including mixed buffers", () => {
  expect(sseEventCut("data: {\"a\":1}\n\nrest")).toEqual({ at: "data: {\"a\":1}".length, skip: 2 });
  expect(sseEventCut("data: {\"a\":1}\r\n\r\nrest")).toEqual({ at: "data: {\"a\":1}".length, skip: 4 });
  expect(sseEventCut("data: incomplete")).toBeNull();
  const lf = "data: {\"kind\":\"runtime\"}\n\n";
  const crlf = "data: {\"kind\":\"runtime\"}\r\n\r\n";
  expect(drain(lf + crlf).frames).toEqual(["{\"kind\":\"runtime\"}", "{\"kind\":\"runtime\"}"]);
  expect(drain(crlf + lf).frames).toEqual(["{\"kind\":\"runtime\"}", "{\"kind\":\"runtime\"}"]);
  expect(drain("data: {\"n\":1}\r\n\r\ndata: {\"n\":2}\n\npartial").frames).toEqual(["{\"n\":1}", "{\"n\":2}"]);
  expect(drain("data: {\"n\":1}\r\n\r\ndata: {\"n\":2}\n\npartial").rest).toBe("partial");
});

it("reads data: payloads whose lines end with CR", () => {
  const block = "event: message\r\ndata: {\"threadId\":\"t1\"}\r";
  expect(sseEventData(block)).toBe("{\"threadId\":\"t1\"}");
  expect(JSON.parse(sseEventData(block))).toEqual({ threadId: "t1" });
});
