import { afterEach, beforeEach, expect, test } from "bun:test";
import { lookUnique, setUniqueFetch } from "../src/unique";
import { uniquePeriods } from "../src/stats";

const reset = () => setUniqueFetch((u, i) => fetch(u, i));
beforeEach(() => {
  process.env.CURSEFORGE_COOKIE = "cookie: a=b";
});
afterEach(() => {
  delete process.env.CURSEFORGE_COOKIE;
  reset();
});

test("no cookie, no look", async () => {
  delete process.env.CURSEFORGE_COOKIE;
  setUniqueFetch(() => {
    throw new Error("must not be asked");
  });
  expect(await lookUnique()).toBe("skipped");
});

test("an expired session is told, not thrown", async () => {
  setUniqueFetch(async () => new Response("no", { status: 403 }));
  expect(await lookUnique()).toBe("expired");
});

test("the statistics are read and kept", async () => {
  const day = Date.parse("2026-10-28T00:00:00Z");
  setUniqueFetch(async (url) => {
    const n = url.split("/").pop();
    const data = n === "4" ? [{ projectId: 1728396, total: 99, unique: 84 }] : [{ day, "1728396": n === "3" ? 7 : 9 }];
    return Response.json({ queryResult: { data } });
  });
  expect(await lookUnique()).toBe("read");
  const u = await uniquePeriods();
  expect(u?.through).toBe("2026-10-28");
  expect(u?.periods["7"].Yonder).toEqual({ downloads: 99, unique: 84 });
});
