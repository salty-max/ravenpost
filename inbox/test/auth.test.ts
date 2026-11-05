import { afterEach, describe, expect, test } from "bun:test";
import { account, foreverRealm, setFetch } from "../src/auth";

afterEach(() => setFetch((input, init) => fetch(input, init)));

describe("account", () => {
  test("keeps each character's realm and name beside the ids", async () => {
    process.env.BNET_CLIENT_ID = "id";
    process.env.BNET_CLIENT_SECRET = "secret";
    setFetch(async (url) => {
      if (url.includes("/token")) return Response.json({ access_token: "a" });
      if (url.includes("/userinfo")) return Response.json({ id: 7, battletag: "Tag#1" });
      if (url.startsWith("https://eu.") && url.includes("profile-classic1x")) {
        return Response.json({
          wow_accounts: [{ characters: [{ id: 64379064, name: "Ghurdil", realm: { slug: "soulseeker" } }, { id: 5, name: "NoRealm" }] }],
        });
      }
      return new Response("", { status: 404 });
    });
    const who = await account("code");
    expect(who).toEqual({
      id: 7,
      battletag: "Tag#1",
      owned: [{ region: "eu", ids: [64379064, 5], characters: [[64379064, "soulseeker", "Ghurdil"]] }],
    });
  });

  test("sends the details of 100 characters at most", async () => {
    process.env.BNET_CLIENT_ID = "id";
    process.env.BNET_CLIENT_SECRET = "secret";
    const many = (n: number, from: number) => Array.from({ length: n }, (_, i) => ({ id: from + i, name: `C${from + i}`, realm: { slug: "r" } }));
    setFetch(async (url) => {
      if (url.includes("/token")) return Response.json({ access_token: "a" });
      if (url.includes("/userinfo")) return Response.json({ id: 7, battletag: "Tag#1" });
      if (url.startsWith("https://eu.") && url.includes("profile-classic1x")) return Response.json({ wow_accounts: [{ characters: many(80, 1) }] });
      if (url.startsWith("https://us.") && url.includes("profile-classic1x")) return Response.json({ wow_accounts: [{ characters: many(80, 1000) }] });
      return new Response("", { status: 404 });
    });
    const who = await account("code");
    expect(who!.owned.map((o) => [o.ids.length, o.characters!.length])).toEqual([
      [80, 80],
      [80, 20],
    ]);
  });

  const forever = (id: number, name: string, surname: string) => ({
    id,
    name,
    surname,
    level: 1,
    playable_class: { id: 1, name: "Warrior" },
    playable_race: { id: 96, name: "Windshaper Skyborne" },
    gender: { type: "FEMALE" },
    faction: { type: "ALLIANCE" },
    protected_character: { href: `https://eu.api.blizzard.com/profile/user/wow/protected-character/6946-${id}?namespace=profile-forever-eu` },
    character: { href: `https://eu.api.blizzard.com/profile/wow/character/${name.toLowerCase()}-${surname.toLowerCase()}?namespace=profile-forever-eu` },
  });
  const signedIn = (profiles: (url: string) => Response) => (url: string) => {
    if (url.includes("/token")) return Response.json({ access_token: "a" });
    if (url.includes("/userinfo")) return Response.json({ id: 7, battletag: "Tag#1" });
    return profiles(url);
  };

  test("lists the Forever characters as an entry of their own, the realm being the link's first number", async () => {
    process.env.BNET_CLIENT_ID = "id";
    process.env.BNET_CLIENT_SECRET = "secret";
    const urls: string[] = [];
    setFetch(
      async (url) =>
        signedIn((u) => {
          urls.push(u);
          if (u.startsWith("https://eu.") && u.includes("profile-forever-eu"))
            return Response.json({ id: 7, wow_accounts: [{ characters: [forever(550204, "Sealine", "Dion"), forever(550205, "Oma", "Vale"), forever(550206, "Jeanne", "Rook")] }] });
          if (u.startsWith("https://eu.")) return Response.json({ wow_accounts: [{ characters: [{ id: 64379064, name: "Ghurdil", realm: { slug: "soulseeker" } }] }] });
          return new Response("", { status: 404 });
        })(url),
    );
    const who = await account("code");
    expect(who!.owned).toEqual([
      { region: "eu", ids: [64379064], characters: [[64379064, "soulseeker", "Ghurdil"]] },
      {
        region: "eu",
        game: "forever",
        ids: [550204, 550205, 550206],
        characters: [
          [550204, "6946", "Sealine Dion"],
          [550205, "6946", "Oma Vale"],
          [550206, "6946", "Jeanne Rook"],
        ],
      },
    ]);
    // (the Classic entry has no `game` key at all, so an old passport reads the same)
    expect("game" in who!.owned[0]).toBe(false);
    expect(urls.some((u) => u.includes("namespace=profile-forever-us") && u.startsWith("https://us."))).toBe(true);
  });

  test("a Classic-only account gets the passport it always got", async () => {
    process.env.BNET_CLIENT_ID = "id";
    process.env.BNET_CLIENT_SECRET = "secret";
    setFetch(async (url) =>
      signedIn((u) =>
        u.startsWith("https://eu.") && u.includes("profile-classic1x")
          ? Response.json({ wow_accounts: [{ characters: [{ id: 1, name: "A", realm: { slug: "r" } }] }] })
          : new Response("", { status: 404 }),
      )(url),
    );
    const who = await account("code");
    expect(JSON.stringify(who!.owned)).toBe('[{"region":"eu","ids":[1],"characters":[[1,"r","A"]]}]');
  });

  test("a region with no Forever list (404) or an error leaves Classic alone, and the other way round", async () => {
    process.env.BNET_CLIENT_ID = "id";
    process.env.BNET_CLIENT_SECRET = "secret";
    setFetch(async (url) =>
      signedIn((u) => {
        if (u.includes("profile-forever-eu")) return new Response("boom", { status: 500 });
        if (u.includes("profile-classic1x-eu")) return Response.json({ wow_accounts: [{ characters: [{ id: 1, name: "A", realm: { slug: "r" } }] }] });
        if (u.includes("profile-forever-us")) return Response.json({ wow_accounts: [{ characters: [forever(9, "Solo", "Walker")] }] });
        return new Response("", { status: 404 });
      })(url),
    );
    const who = await account("code");
    expect(who!.owned.map((o) => [o.region, o.game ?? "classic1x", o.ids])).toEqual([
      ["us", "forever", [9]],
      ["eu", "classic1x", [1]],
    ]);
  });

  test("a Forever character without a usable link keeps its id and has no detail", async () => {
    process.env.BNET_CLIENT_ID = "id";
    process.env.BNET_CLIENT_SECRET = "secret";
    setFetch(async (url) =>
      signedIn((u) =>
        u.startsWith("https://eu.") && u.includes("profile-forever")
          ? Response.json({ wow_accounts: [{ characters: [{ id: 3, name: "Bare", surname: "Link" }, forever(4, "Fine", "One")] }] })
          : new Response("", { status: 404 }),
      )(url),
    );
    const who = await account("code");
    expect(who!.owned).toEqual([{ region: "eu", game: "forever", ids: [3, 4], characters: [[4, "6946", "Fine One"]] }]);
  });

  test("details are 100 at most over both games, Forever's first, the ids whole", async () => {
    process.env.BNET_CLIENT_ID = "id";
    process.env.BNET_CLIENT_SECRET = "secret";
    setFetch(async (url) =>
      signedIn((u) => {
        if (!u.startsWith("https://eu.")) return new Response("", { status: 404 });
        if (u.includes("profile-forever")) return Response.json({ wow_accounts: [{ characters: Array.from({ length: 60 }, (_, i) => forever(100 + i, "F", `S${i}`)) }] });
        return Response.json({ wow_accounts: [{ characters: Array.from({ length: 60 }, (_, i) => ({ id: i + 1, name: `C${i}`, realm: { slug: "r" } })) }] });
      })(url),
    );
    const who = await account("code");
    expect(who!.owned.map((o) => [o.game ?? "classic1x", o.ids.length, o.characters!.length])).toEqual([
      ["classic1x", 60, 40],
      ["forever", 60, 60],
    ]);
  });
});

describe("foreverRealm", () => {
  const ok = "https://eu.api.blizzard.com/profile/user/wow/protected-character/6946-550204?namespace=profile-forever-eu";
  test("reads the realm of the exact shape", () => {
    expect(foreverRealm(ok, 550204)).toBe("6946");
    expect(foreverRealm("/profile/user/wow/protected-character/6946-550204", 550204)).toBe("6946");
  });
  test("refuses anything else", () => {
    for (const bad of [undefined, null, 5, "", "protected-character/6946-550204x", "/protected-character/abc-550204", "/protected-character/6946-", "/protected-character/-550204", "/character/6946-550204", "/protected-character/6946-550204/extra", "/protected-character/6946-550204-1", "/protected-character/1234567890-550204"])
      expect(foreverRealm(bad, 550204)).toBeNull();
  });
  test("refuses a link for another character", () => {
    expect(foreverRealm(ok, 550205)).toBeNull();
  });
});
