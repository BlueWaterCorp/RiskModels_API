import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureFirstTouch,
  captureUTMFromURL,
  clearUTMData,
  getFirstTouch,
  getUTMData,
} from "@/lib/utm";
import { captchaEnabled, captchaOption, turnstileSiteKey } from "@/lib/auth/captcha";

function installBrowser(pathname: string, search = "", referrer = "") {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  const setPage = (p: string, s = "", r = "") => {
    vi.stubGlobal("window", { location: { pathname: p, search: s, host: "riskmodels.app" } });
    vi.stubGlobal("document", { referrer: r });
  };
  setPage(pathname, search, referrer);
  return { store, setPage };
}

afterEach(() => vi.unstubAllGlobals());

describe("first-touch capture in the browser", () => {
  it("records the first landing path and external referrer once; later pages do not replace it", () => {
    const b = installBrowser("/pricing", "", "https://www.google.com/search");
    captureFirstTouch();
    b.setPage("/get-key", "", "https://riskmodels.app/pricing");
    captureFirstTouch();
    expect(getFirstTouch()).toMatchObject({ landing_path: "/pricing", referrer: "https://www.google.com/search" });
  });

  it("does not record same-site navigation as a referrer", () => {
    installBrowser("/docs", "", "https://riskmodels.app/");
    captureFirstTouch();
    expect(getFirstTouch()).toMatchObject({ landing_path: "/docs", referrer: null });
  });

  it("returning from sign-in in a fresh browser: `lp` restores the landing path, not /get-key", () => {
    installBrowser("/get-key", "?gclid=abc&lp=%2Fpricing", "https://accounts.google.com/");
    captureFirstTouch("?gclid=abc&lp=%2Fpricing");
    expect(getFirstTouch()).toMatchObject({ landing_path: "/pricing", referrer: null });
  });

  it("ignores an `lp` that is not a same-site path", () => {
    installBrowser("/get-key", "?lp=%2F%2Fevil.com");
    captureFirstTouch("?lp=%2F%2Fevil.com");
    expect(getFirstTouch()?.landing_path).toBe("/get-key");
  });

  it("UTM: the first campaign wins; a later tagged visit does not overwrite it", () => {
    const b = installBrowser("/pricing", "?utm_source=google&utm_medium=cpc&utm_campaign=launch", "https://www.google.com/");
    captureUTMFromURL("?utm_source=google&utm_medium=cpc&utm_campaign=launch");
    b.setPage("/get-key", "?utm_source=newsletter&utm_medium=email", "https://mail.example.com/");
    captureUTMFromURL("?utm_source=newsletter&utm_medium=email");
    expect(getUTMData()).toMatchObject({
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "launch",
      landing_path: "/pricing",
      referrer: "https://www.google.com/",
    });
  });

  it("UTM re-captured after sign-in uses `lp` for the landing path and drops the sign-in referrer", () => {
    installBrowser("/get-key", "", "https://accounts.google.com/");
    captureUTMFromURL("?utm_source=google&utm_medium=cpc&lp=%2Fpricing");
    expect(getUTMData()).toMatchObject({ utm_source: "google", landing_path: "/pricing", referrer: null });
  });

  it("after the stored record is cleared a new campaign can be captured", () => {
    installBrowser("/a", "", "");
    captureUTMFromURL("?utm_source=one");
    clearUTMData();
    captureUTMFromURL("?utm_source=two");
    expect(getUTMData()?.utm_source).toBe("two");
  });
});

describe("captcha gating on NEXT_PUBLIC_TURNSTILE_SITE_KEY", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it("unset: disabled, and no option is added to auth calls", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    expect(turnstileSiteKey()).toBeNull();
    expect(captchaEnabled()).toBe(false);
    expect(captchaOption(null)).toEqual({});
    expect({ emailRedirectTo: "x", ...captchaOption(undefined) }).toEqual({ emailRedirectTo: "x" });
  });

  it("set: enabled, and a collected token is passed as captchaToken", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "0x4AAAA-site-key");
    expect(captchaEnabled()).toBe(true);
    expect(captchaOption(" tok ")).toEqual({ captchaToken: "tok" });
    expect(captchaOption("")).toEqual({});
  });
});
