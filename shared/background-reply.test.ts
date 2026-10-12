import { describe, expect, it } from "vitest";

import {
  BACKGROUND_REPLY_PROMPT,
  BACKGROUND_WORKER_PROMPT,
  acceptAck,
  ackClaimsResult,
  backgroundRepliesActive,
  backgroundRepliesEnabled,
  classifyRequest,
  frenchAnglicisms,
  isMilestone,
  milestoneGate,
  shouldBackgroundReply,
  stepAcknowledgement,
  timeToFirstMessageMs,
} from "./background-reply.ts";

const ALUBAR = "Peux tu m'affiche l'age des comptes de Alubar";

describe("background replies", () => {
  it("is on unless a bot turns it off", () => {
    expect(backgroundRepliesEnabled(undefined)).toBe(false);
    expect(backgroundRepliesEnabled({})).toBe(true);
    expect(backgroundRepliesEnabled({ backgroundReplies: true })).toBe(true);
    expect(backgroundRepliesEnabled({ backgroundReplies: false })).toBe(false);
  });

  it("stays one turn in the vitest fixture unless the bot turns it on", () => {
    const namespace = process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE;
    const flag = process.env.SAGAX_BACKGROUND_REPLIES;
    const home = process.env.HOME;
    const profile = process.env.USERPROFILE;
    const data = process.env.SAGAX_DATA_DIR;
    try {
      delete process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE;
      delete process.env.SAGAX_BACKGROUND_REPLIES;
      process.env.HOME = "/home/sagax";
      process.env.USERPROFILE = "/home/sagax";
      delete process.env.SAGAX_DATA_DIR;
      expect(backgroundRepliesActive({})).toBe(true);
      process.env.HOME = home;
      if (profile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = profile;
      if (data === undefined) delete process.env.SAGAX_DATA_DIR;
      else process.env.SAGAX_DATA_DIR = data;
      expect(backgroundRepliesActive({})).toBe(false);
      process.env.SAGAX_BACKGROUND_REPLIES = "on";
      expect(backgroundRepliesActive({})).toBe(true);
      delete process.env.SAGAX_BACKGROUND_REPLIES;
      process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE = "suite";
      expect(backgroundRepliesActive({})).toBe(false);
      expect(backgroundRepliesActive({ backgroundReplies: true })).toBe(true);
      delete process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE;
      process.env.SAGAX_BACKGROUND_REPLIES = "off";
      expect(backgroundRepliesActive({})).toBe(false);
      expect(backgroundRepliesActive({ backgroundReplies: true })).toBe(true);
    } finally {
      if (namespace === undefined) delete process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE;
      else process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE = namespace;
      if (flag === undefined) delete process.env.SAGAX_BACKGROUND_REPLIES;
      else process.env.SAGAX_BACKGROUND_REPLIES = flag;
      if (home === undefined) delete process.env.HOME;
      else process.env.HOME = home;
      if (profile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = profile;
      if (data === undefined) delete process.env.SAGAX_DATA_DIR;
      else process.env.SAGAX_DATA_DIR = data;
    }
  });

  it("treats a greeting or a short question as quick, and a lookup as work", () => {
    expect(classifyRequest("Bonjour")).toBe("quick");
    expect(classifyRequest("Quelle est la capitale de la France?")).toBe("quick");
    expect(classifyRequest("Thanks!")).toBe("quick");
    expect(classifyRequest(ALUBAR)).toBe("work");
    expect(classifyRequest("Can you show me the age of Alubar's accounts")).toBe("work");
    expect(classifyRequest("see https://example.com/report")).toBe("work");
    expect(classifyRequest("read src/index.ts")).toBe("work");
    expect(classifyRequest("x".repeat(241))).toBe("work");
  });

  it("hands off only an ordinary work request", () => {
    const bot = {};
    expect(shouldBackgroundReply({ bot, text: ALUBAR })).toBe(true);
    expect(shouldBackgroundReply({ bot, text: "Bonjour" })).toBe(false);
    expect(shouldBackgroundReply({ bot, text: "/compact the thread" })).toBe(false);
    expect(shouldBackgroundReply({ bot: { backgroundReplies: false }, text: ALUBAR })).toBe(false);
    expect(shouldBackgroundReply({ bot, text: ALUBAR, voice: true })).toBe(false);
    expect(shouldBackgroundReply({ bot, text: ALUBAR, hidden: true })).toBe(false);
    expect(shouldBackgroundReply({ bot, text: ALUBAR, nested: true })).toBe(false);
    expect(shouldBackgroundReply({ bot, text: "   " })).toBe(false);
  });

  it("names the first step in Québec French from the person's own words", () => {
    const ack = stepAcknowledgement(ALUBAR);
    expect(ack).toBe("Je vérifie l'âge des comptes d'Alubar.");
    expect(ackClaimsResult(ack)).toBe(false);
    expect(frenchAnglicisms(ack)).toEqual([]);
    expect(ack).not.toContain("ConnectWise");
    expect(stepAcknowledgement(`${ALUBAR} [gate:work]`)).toBe(ack);
    expect(stepAcknowledgement("liste des comptes de Alubar")).toBe("Je dresse la liste des comptes d'Alubar.");
    expect(stepAcknowledgement("Peux tu chercher le dossier")).toBe("Je cherche le dossier.");
  });

  it("names the first step in English without inventing a result", () => {
    expect(stepAcknowledgement("Can you show me the age of Alubar's accounts")).toBe("I'm checking the age of Alubar's accounts.");
    expect(stepAcknowledgement("please list the open files")).toBe("I'm listing the open files.");
    expect(stepAcknowledgement("https://example.com/age")).toBe("I'm checking that link.");
  });

  it("refuses an acknowledgement that states a result or uses an anglicism", () => {
    expect(ackClaimsResult("L'âge moyen est de 4 ans.")).toBe(true);
    expect(ackClaimsResult("Here are the ages: 3, 5, 8.")).toBe(true);
    expect(ackClaimsResult("Je vérifie l'âge des comptes d'Alubar.")).toBe(false);
    expect(frenchAnglicisms("Je vais checker les comptes.")).toContain("checker");
    expect(acceptAck("L'âge moyen est de 4 ans.", ALUBAR)).toBe("Je vérifie l'âge des comptes d'Alubar.");
    expect(acceptAck("Je vais checker ça.", ALUBAR)).toBe("Je vérifie l'âge des comptes d'Alubar.");
    expect(acceptAck("Je vérifie l'âge des comptes d'Alubar.", ALUBAR)).toBe("Je vérifie l'âge des comptes d'Alubar.");
  });

  it("measures the wait until the first message, never a negative gap", () => {
    expect(timeToFirstMessageMs(1_000, 1_250)).toBe(250);
    expect(timeToFirstMessageMs(1_000, 900)).toBe(0);
    expect(timeToFirstMessageMs(Number.NaN, 1)).toBe(0);
  });

  it("posts a short new status, and not the acknowledgement or a burst", () => {
    const status = "Le rapport d'âge des comptes d'Alubar est en cours, je te l'envoie dès qu'il est prêt.";
    expect(isMilestone(status)).toBe(true);
    expect(isMilestone("Deux phrases. Puis une autre.")).toBe(false);
    const ack = "Je vérifie l'âge des comptes d'Alubar.";
    const first = milestoneGate(undefined, status, 1_000, ack);
    expect(first.accept).toBe(true);
    expect(milestoneGate(first.state, ack, 20_000, ack).accept).toBe(false);
    expect(milestoneGate(first.state, status, 20_000, ack).accept).toBe(false);
    expect(milestoneGate(first.state, "Je continue la lecture du dossier.", 2_000, ack).accept).toBe(false);
    const later = milestoneGate(first.state, "Je continue la lecture du dossier.", 20_000, ack);
    expect(later.accept).toBe(true);
    let state = later.state;
    for (let n = 0; n < 8; n += 1) {
      const next = milestoneGate(state, `Je poursuis l'étape numéro ${n}.`, 40_000 + n * 20_000, ack);
      state = next.state;
    }
    expect(state.count).toBe(6);
    expect(milestoneGate(state, "Je termine la dernière vérification.", 400_000, ack).accept).toBe(false);
  });

  it("tells every engine the contract without inventing a tool or a source", () => {
    expect(BACKGROUND_REPLY_PROMPT).toContain("start_thread");
    expect(BACKGROUND_REPLY_PROMPT).toContain("report_back");
    expect(BACKGROUND_REPLY_PROMPT).toContain("Québec");
    expect(BACKGROUND_REPLY_PROMPT).not.toContain("ConnectWise");
    expect(BACKGROUND_WORKER_PROMPT).toContain("Québec");
    expect(BACKGROUND_WORKER_PROMPT).not.toContain("ConnectWise");
    expect(BACKGROUND_WORKER_PROMPT).toContain("not an answer");
  });
});
