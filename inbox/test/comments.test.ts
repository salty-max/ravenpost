import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { recentThreads, setCommentsFetch, watch } from "../src/comments";
import { digestOf } from "../src/digest";
import * as events from "../src/events";

let threads: Record<number, unknown[]> = {};
beforeEach(() => {
  process.env.INBOX_DIR = mkdtempSync(path.join(tmpdir(), "comments-"));
  threads = {};
  setCommentsFetch(async (url) => {
    const id = Number(url.match(/mods\/(\d+)\//)![1]);
    return Response.json({ data: threads[id] ?? [], pagination: { index: 0, totalCount: 0, pageSize: 50 } });
  });
});
afterEach(() => {
  rmSync(process.env.INBOX_DIR!, { recursive: true, force: true });
  delete process.env.INBOX_DIR;
  setCommentsFetch((input, init) => fetch(input, init));
});

const comment = (id: number, who: string, text: string, replies: unknown[] = []) => ({
  id,
  text,
  projectId: 1728396,
  author: { displayName: who },
  datePosted: Date.parse("2026-10-15T08:00:00Z") + id,
  replies,
});

describe("CurseForge's comments", () => {
  test("the first look learns, then a player's new word is told, the owner's not", async () => {
    threads[1728396] = [comment(1, "nocty_dream", "Great addon!")];
    expect((await watch()).fresh).toBe(0);
    expect(await events.recent()).toEqual([]);
    threads[1728396] = [
      comment(1, "nocty_dream", "Great addon!", [comment(3, "saltymax", "Thanks!")]),
      comment(2, "DasHound", "A small feature request:\n\nherbs on the map."),
    ];
    const r = await watch();
    expect(r.fresh).toBe(1);
    const [e] = await events.recent();
    expect(e).toMatchObject({ kind: "comment", repo: "yonder", title: "DasHound commented on Yonder", body: "A small feature request: herbs on the map.", url: "https://www.curseforge.com/wow/addons/yonder/comments" });
    expect((await watch()).fresh).toBe(0);
    // (the dashboard's threads: the owner's last word, or one to answer)
    const shown = await recentThreads();
    expect(shown.map((t) => [t.author, t.answered, t.replies.map((r) => r.owner)])).toEqual([
      ["nocty_dream", true, [true]],
      ["DasHound", false, []],
    ]);
  });

  test("many at once, one word; the digest counts them", async () => {
    threads[1728396] = [];
    await watch();
    threads[1728396] = [1, 2, 3, 4, 5].map((i) => comment(10 + i, `player${i}`, `word ${i}`));
    await watch();
    const list = await events.recent();
    expect(list.length).toBe(1);
    expect(list[0].title).toBe("5 new comments on Yonder");
    expect(digestOf({ days: {} }, list).lines).toContain("5 new comments on CurseForge: Yonder 5.");
  });

  test("a refusal from CurseForge is said, the others still looked at", async () => {
    setCommentsFetch(async (url) => (url.includes("1728396") ? new Response("", { status: 403 }) : Response.json({ data: [] })));
    const r = await watch();
    expect(r.failed).toEqual(["Error: curseforge 1728396: 403"]);
  });
});
