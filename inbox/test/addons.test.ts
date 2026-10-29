import { describe, expect, test } from "bun:test";
import { REPO_NAMES } from "../src/digest";
import { ADDONS } from "../src/stats";

describe("the addons' one list", () => {
  test("every addon the family has is counted", () => {
    const repos = ADDONS.map(([, , , , repo]) => repo);
    for (const r of ["lorekeepers-codex", "yonder", "hearthtale", "keyring", "second-wind", "palaver", "mealbook", "goodwill", "yours-truly", "ravenpost"]) {
      expect(repos).toContain(r);
    }
    expect(new Set(repos).size).toBe(repos.length);
  });

  test("the digest and the dashboard name each of them", () => {
    for (const [name, , , , repo] of ADDONS) expect(REPO_NAMES[repo]).toBeTruthy();
    expect(REPO_NAMES["yours-truly"]).toBe("Yours Truly");
    expect(REPO_NAMES["goodwill"]).toBe("Goodwill");
    expect(REPO_NAMES["lorekeepers-codex"]).toBe("the Codex");
    expect(REPO_NAMES["wow-data"]).toBe("wow-data");
  });

  test("a store listing has its Wago id when it has a slug", () => {
    for (const [, cf, slug, wid] of ADDONS) expect(Boolean(slug)).toBe(Boolean(wid) && Boolean(cf));
  });
});
