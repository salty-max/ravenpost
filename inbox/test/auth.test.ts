import { afterEach, describe, expect, test } from "bun:test";
import { account, setFetch } from "../src/auth";

afterEach(() => setFetch((input, init) => fetch(input, init)));

describe("account", () => {
  test("keeps each character's realm and name beside the ids", async () => {
    process.env.BNET_CLIENT_ID = "id";
    process.env.BNET_CLIENT_SECRET = "secret";
    setFetch(async (url) => {
      if (url.includes("/token")) return Response.json({ access_token: "a" });
      if (url.includes("/userinfo")) return Response.json({ id: 7, battletag: "Tag#1" });
      if (url.startsWith("https://eu.")) {
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
      if (url.startsWith("https://eu.")) return Response.json({ wow_accounts: [{ characters: many(80, 1) }] });
      if (url.startsWith("https://us.")) return Response.json({ wow_accounts: [{ characters: many(80, 1000) }] });
      return new Response("", { status: 404 });
    });
    const who = await account("code");
    expect(who!.owned.map((o) => [o.ids.length, o.characters!.length])).toEqual([
      [80, 80],
      [80, 20],
    ]);
  });
});
