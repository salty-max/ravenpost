import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { app } from "../src/app";
import { lookUnique, setUniqueFetch } from "../src/unique";
import { uniquePeriods } from "../src/stats";

beforeEach(() => {
  process.env.INBOX_DIR = mkdtempSync(path.join(tmpdir(), "unique-"));
  process.env.CURSEFORGE_COOKIE = "cookie: a=b";
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
});
afterEach(() => {
  rmSync(process.env.INBOX_DIR!, { recursive: true, force: true });
  delete process.env.INBOX_DIR;
  delete process.env.CURSEFORGE_COOKIE;
  delete process.env.CRON_SECRET;
  setUniqueFetch((u, i) => fetch(u, i));
});

const day = Date.parse("2026-10-28T00:00:00Z");
const stats = async (url: string) => {
  const n = url.split("/").pop();
  const data = n === "4" ? [{ projectId: 1728396, total: 99, unique: 84 }] : [{ day, "1728396": n === "3" ? 7 : 9 }];
  return Response.json({ queryResult: { data } });
};

test("no cookie, no look", async () => {
  delete process.env.CURSEFORGE_COOKIE;
  setUniqueFetch(() => {
    throw new Error("must not be asked");
  });
  expect(await lookUnique()).toBe("skipped");
});

test("the statistics are read with the cookie, its prefix and line breaks stripped, and kept", async () => {
  process.env.CURSEFORGE_COOKIE = "cookie: a=b;\r\n c=d\n";
  const seen: string[] = [];
  setUniqueFetch(async (url, init) => {
    seen.push((init?.headers as Record<string, string>).cookie);
    return stats(url);
  });
  expect(await lookUnique()).toBe("read");
  expect(new Set(seen)).toEqual(new Set(["a=b; c=d"]));
  expect(seen.length).toBe(5);
  const u = await uniquePeriods();
  expect(u?.through).toBe("2026-10-28");
  expect(u?.periods["7"].Yonder).toEqual({ downloads: 99, unique: 84 });
});

test("a turned-down session (403, a redirect, a page) is told once a day, never thrown", async () => {
  for (const answer of [() => new Response("no", { status: 403 }), () => new Response(null, { status: 302, headers: { location: "/login" } }), () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } })]) {
    setUniqueFetch(async () => answer());
    expect(await lookUnique()).toBe("expired");
  }
  const told = path.join(process.env.INBOX_DIR!, "alerts", "told.json");
  const first = JSON.parse(readFileSync(told, "utf8"))["unique-cookie"];
  expect(first).toBeTruthy();
  setUniqueFetch(async () => new Response("no", { status: 401 }));
  expect(await lookUnique()).toBe("expired");
  expect(JSON.parse(readFileSync(told, "utf8"))["unique-cookie"]).toBe(first);
});

test("a failure's log never holds the cookie", async () => {
  process.env.CURSEFORGE_COOKIE = "secret=SHHH";
  setUniqueFetch(async () => {
    throw new TypeError('Headers.append: "secret=SHHH" is an invalid header value.');
  });
  const logged: string[] = [];
  const was = console.error;
  console.error = (...a: unknown[]) => void logged.push(a.join(" "));
  try {
    expect(await lookUnique()).toBe("failed");
  } finally {
    console.error = was;
  }
  expect(logged.join("")).not.toContain("SHHH");
});

test("the cron route wants the secret and answers", async () => {
  process.env.CRON_SECRET = "s";
  setUniqueFetch(stats);
  expect((await app.request("/api/cron/unique")).status).toBe(401);
  const r = await app.request("/api/cron/unique", { headers: { authorization: "Bearer s" } });
  expect(await r.json()).toEqual({ unique: "read" });
});
