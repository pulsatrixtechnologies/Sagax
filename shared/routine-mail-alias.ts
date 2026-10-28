/** A routine's mail tag: the part after + on the bot's address
 * (local+tag@domain). Letters and digits only, so it cannot change the
 * domain or add another recipient. */
const TAG = /^[a-z0-9]{1,32}$/;

export function parseMailAlias(value: unknown): { ok: true; alias?: string } | { ok: false; error: string } {
  if (value == null || value === "") return { ok: true };
  if (typeof value !== "string") return { ok: false, error: "A mail tag is 1 to 32 letters or digits." };
  const alias = value.trim().toLowerCase();
  if (!TAG.test(alias)) return { ok: false, error: "A mail tag is 1 to 32 letters or digits." };
  return { ok: true, alias };
}

/** The tag on local+tag@domain, or null when the address has none or the
 * tag is not one this app stores. */
export function plusTag(address: string): string | null {
  const at = address.lastIndexOf("@");
  const local = (at === -1 ? address : address.slice(0, at)).trim().toLowerCase();
  const plus = local.indexOf("+");
  if (plus < 1) return null;
  const tag = local.slice(plus + 1);
  return TAG.test(tag) ? tag : null;
}

/** local+tag@domain when the bot address is a single address without a tag
 * of its own. Null when it cannot be built. This does not send mail: the
 * connector still sends from its own address. */
export function routineMailAddress(botAddress: string, alias: string): string | null {
  const parsed = parseMailAlias(alias);
  if (!parsed.ok || !parsed.alias) return null;
  const trimmed = botAddress.trim();
  const at = trimmed.lastIndexOf("@");
  if (at < 1 || trimmed.includes("+") || /[\s,;]/.test(trimmed)) return null;
  const domain = trimmed.slice(at + 1);
  if (!domain.includes(".")) return null;
  return `${trimmed.slice(0, at)}+${parsed.alias}@${domain}`;
}
