import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
}));

vi.mock("@/state/store", async (importOriginal) => {
  const store = await importOriginal<typeof import("@/state/store")>();
  return {
    ...store,
    useStore: () => ({
      state: { ...store.initialState, config: fixture.config },
      dispatch: vi.fn(),
    }),
  };
});

const { ImageGenerationSettings } = await import("./ImageGenerationSettings");
const { AvatarImageGenerator } = await import("../AvatarImageGenerator");

const generate = () => renderToStaticMarkup(createElement(AvatarImageGenerator, {
  botLabel: "Pepper",
  disabled: false,
  generating: false,
  onGenerate: async () => {},
}));

describe("ImageGenerationSettings", () => {
  it("keeps the provider and key on the installation card", () => {
    fixture.config = { imageGen: { configured: false, provider: "openai" } };
    const html = renderToStaticMarkup(createElement(ImageGenerationSettings));
    expect(html).toContain('aria-label="Image provider"');
    expect(html).toContain('aria-label="OpenAI image API key"');
    expect(html).toContain("Save key");
    expect(html).not.toContain("Generate avatar");
  });
});

describe("AvatarImageGenerator", () => {
  it("links an admin to Settings when image generation is not set up", () => {
    fixture.config = { imageGen: { configured: false, provider: "openai" } };
    const html = generate();
    expect(html).toContain("Set up image generation");
    expect(html).toContain(">API keys<");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("Image provider");
    expect(html).not.toContain("Generate avatar");
  });

  it("tells an organization member the server is not set up, without a settings link", () => {
    fixture.config = { imageGen: { configured: false }, viewer: { role: "member" } };
    const html = generate();
    expect(html).toContain("Image generation is not set up on this server.");
    expect(html).not.toContain("Set up image generation");
    expect(html).not.toContain(">API keys<");
  });

  it("generates from a direction once the installation is configured", () => {
    fixture.config = { imageGen: { configured: true, provider: "openai" } };
    const html = generate();
    expect(html).toContain("Generate avatar");
    expect(html).toContain('aria-label="Avatar generation direction"');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("Image provider");
    expect(html).not.toContain("Set up image generation");
  });
});
