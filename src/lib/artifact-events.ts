// The window event the store fires when the server says a bot's artifacts
// changed (frame `artifacts`, ids only). Its own module so the store and
// src/lib/artifacts.ts do not import each other.
export const ARTIFACTS_EVENT = "sagax-artifacts";

export interface ArtifactsEventDetail {
  botId: string;
  artifactId?: string;
  deleted: boolean;
}

/** Asks the app-wide artifact host (ArtifactsHost.tsx) to show one artifact:
 * from the palette, or anywhere outside its bot's Files tab. */
export const OPEN_ARTIFACT_EVENT = "sagax-open-artifact";

export interface OpenArtifactDetail {
  botId: string;
  artifactId: string;
  title: string;
}

export function openArtifact(detail: OpenArtifactDetail): void {
  window.dispatchEvent(new CustomEvent<OpenArtifactDetail>(OPEN_ARTIFACT_EVENT, { detail }));
}
