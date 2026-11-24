/**
 * First screen of a feed access request, before any person reads it.
 *
 * It looks only at the address's domain. It never judges a name or the part of
 * the address before the @: an unusual name is not evidence of anything.
 *
 * - "personal": a free consumer mailbox. Accepted, and marked so the operator
 *   reviews it by hand. An independent professional can add a firm website or a
 *   professional profile link to the request.
 * - "work": any other deliverable domain.
 * - refused at the form: a throwaway-mailbox domain, or a domain that does not
 *   exist in DNS. The refusal depends only on what was typed, never on the list.
 *
 * Approval is always a person's decision. This file only sorts requests.
 */
import { resolve4, resolve6, resolveMx } from "node:dns/promises";

export type FeedScreen = "work" | "personal";

/** Free consumer mailbox providers. A short, common list; anything else is treated as a work domain. */
const PERSONAL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "ymail.com", "outlook.com", "hotmail.com",
  "hotmail.co.uk", "live.com", "msn.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me",
  "protonmail.com", "pm.me", "gmx.com", "gmx.net", "gmx.de", "web.de", "mail.com", "zoho.com", "yandex.com",
  "yandex.ru", "fastmail.com", "hey.com", "tutanota.com", "tuta.io", "qq.com", "163.com", "126.com",
  "naver.com", "comcast.net", "verizon.net", "att.net", "sbcglobal.net", "btinternet.com",
]);

/** Throwaway-mailbox services. */
const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "grr.la", "10minutemail.com",
  "10minutemail.net", "tempmail.com", "temp-mail.org", "temp-mail.io", "tempmailo.com", "throwawaymail.com",
  "yopmail.com", "yopmail.net", "trashmail.com", "trashmail.de", "getnada.com", "nada.email", "maildrop.cc",
  "dispostable.com", "fakeinbox.com", "mailnesia.com", "mintemail.com", "moakt.com", "emailondeck.com",
  "tempr.email", "discard.email", "spamgourmet.com", "mytemp.email", "mohmal.com", "burnermail.io",
  "inboxkitten.com", "tmpmail.org", "tmpmail.net", "mail-temp.com", "tempinbox.com", "mailcatch.com",
]);

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).trim().toLowerCase().replace(/\.$/, "");
}

/** True when the domain, or a parent of it, is on the throwaway list. */
export function isDisposableDomain(domain: string): boolean {
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i++) if (DISPOSABLE_DOMAINS.has(parts.slice(i).join("."))) return true;
  return false;
}

export function screenAddress(email: string): FeedScreen | "disposable" {
  const domain = emailDomain(email);
  if (isDisposableDomain(domain)) return "disposable";
  return PERSONAL_DOMAINS.has(domain) ? "personal" : "work";
}

export interface DomainResolver {
  mx(domain: string): Promise<unknown[]>;
  address(domain: string): Promise<unknown[]>;
}

const liveResolver: DomainResolver = {
  mx: (d) => resolveMx(d),
  address: async (d) => {
    const found = await Promise.allSettled([resolve4(d), resolve6(d)]);
    const hit = found.find((r) => r.status === "fulfilled" && r.value.length > 0);
    if (hit && hit.status === "fulfilled") return hit.value;
    const failed = found.find((r) => r.status === "rejected");
    if (failed && failed.status === "rejected") throw failed.reason;
    return [];
  },
};

/** DNS answers that mean "this name has no such record", as opposed to "the lookup failed". */
const ABSENT = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);
const absent = (err: unknown) => ABSENT.has(String((err as { code?: unknown } | null)?.code ?? ""));

/**
 * Whether mail can be addressed to the domain: an MX record, or failing that an
 * address record. `false` only when DNS positively says neither exists. A
 * timeout or a resolver error answers `true`: a lookup failure on our side must
 * not turn away a real applicant.
 */
export async function domainExists(
  domain: string,
  resolver: DomainResolver = liveResolver,
  timeoutMs = 2500,
): Promise<boolean> {
  const check = async (): Promise<boolean> => {
    try {
      if ((await resolver.mx(domain)).length > 0) return true;
    } catch (err) {
      if (!absent(err)) return true;
    }
    try {
      return (await resolver.address(domain)).length > 0;
    } catch (err) {
      return !absent(err);
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((done) => {
    timer = setTimeout(() => done(true), timeoutMs);
  });
  try {
    return await Promise.race([check(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const MAX_PROFILE_URL = 300;

/**
 * An optional firm website or professional profile link. null when absent,
 * undefined when present but not a plain http(s) URL with a dotted host (the
 * caller answers 400). "example.com/about" is accepted and stored with https://.
 */
export function profileUrl(value: unknown): string | null | undefined {
  if (value == null) return null;
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  if (!raw) return null;
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  if (candidate.length > MAX_PROFILE_URL || /\s/.test(candidate)) return undefined;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    if (url.username || url.password || !/^[^.]+(\.[^.]+)+$/.test(url.hostname)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}
