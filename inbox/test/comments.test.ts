import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { commentsOf, recentThreads, setCommentsFetch, watch } from "../src/comments";
import { dashboard } from "../src/dashboard";
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

  test("a player replying to the owner's reply is shown and told, at any depth", async () => {
    const ownerReply = comment(2, "saltymax", "The fix is up.");
    threads[1728396] = [comment(1, "player", "I found a bug.", [ownerReply])];
    await watch();
    expect((await recentThreads())[0].answered).toBe(true);

    const playerReply = comment(3, "player", "It works now, thank you!");
    ownerReply.replies.push(playerReply);
    expect(await watch()).toMatchObject({ looked: 3, fresh: 1, failed: [] });
    expect(await events.recent()).toHaveLength(1);
    expect((await events.recent())[0]).toMatchObject({ title: "player replied on Yonder", body: "It works now, thank you!" });
    let [shown] = await recentThreads();
    expect(shown).toMatchObject({ answered: false, last: new Date(playerReply.datePosted).toISOString() });
    expect(shown.replies.map((r) => [r.author, r.text])).toEqual([
      ["saltymax", "The fix is up."],
      ["player", "It works now, thank you!"],
    ]);
    const html = dashboard({ days: {} }, { threads: [shown] });
    expect(html).toContain("It works now, thank you!");
    expect(html).toContain("To answer");
    expect((await watch()).fresh).toBe(0);
    expect(await events.recent()).toHaveLength(1);

    const deeperOwner = comment(4, "saltymax", "Glad to hear it.");
    playerReply.replies.push(deeperOwner);
    expect((await watch()).fresh).toBe(0);
    [shown] = await recentThreads();
    expect(shown.answered).toBe(true);
    expect(shown.replies.map((r) => r.owner)).toEqual([true, false, true]);

    deeperOwner.replies.push(comment(5, "player", "One more question."));
    expect((await watch()).fresh).toBe(1);
    [shown] = await recentThreads();
    expect(shown.answered).toBe(false);
    expect(shown.replies).toHaveLength(4);
    expect(await events.recent()).toHaveLength(2);
  });

  test("the first look learns deeply nested replies without notifying about old messages", async () => {
    threads[1728396] = [comment(1, "player", "Bug", [comment(2, "saltymax", "Fixed", [comment(3, "player", "Thanks")])])];
    expect(await watch()).toMatchObject({ looked: 3, fresh: 0 });
    expect((await recentThreads())[0].replies).toHaveLength(2);
    expect((await watch()).fresh).toBe(0);
    expect(await events.recent()).toEqual([]);
  });

  test("replies on different branches are ordered by time, not their position in the response", async () => {
    threads[1728396] = [comment(25, "other player", "A newer top-level comment"), comment(1, "player", "Bug", [
      comment(20, "saltymax", "Another detail"),
      comment(10, "saltymax", "Fixed", [comment(30, "player", "I still need help")]),
    ])];
    await watch();
    const shownThreads = await recentThreads();
    expect(shownThreads.map((t) => t.id)).toEqual([1, 25]);
    const [shown] = shownThreads;
    expect(shown.replies.map((r) => r.text)).toEqual(["Fixed", "Another detail", "I still need help"]);
    expect(shown.answered).toBe(false);
    expect(shown.last).toBe(new Date(Date.parse("2026-10-15T08:00:00Z") + 30).toISOString());
  });

  test("a thread started by the owner still needs an answer when a player replies last", async () => {
    threads[1728396] = [comment(1, "saltymax", "Any feedback?")];
    await watch();
    expect((await recentThreads())[0].answered).toBe(true);
    threads[1728396] = [comment(1, "saltymax", "Any feedback?", [comment(2, "player", "How do I open it?")])];
    expect((await watch()).fresh).toBe(1);
    expect((await recentThreads())[0].answered).toBe(false);
  });

  test("a reply included in more than one place is shown and announced only once", async () => {
    threads[1728396] = [comment(1, "player", "Bug")];
    await watch();
    const reply = comment(3, "player", "A follow-up");
    threads[1728396] = [comment(1, "player", "Bug", [comment(2, "saltymax", "Fixed", [reply]), reply])];
    expect((await commentsOf(1728396)).map((c) => [c.id, c.reply])).toEqual([[1, false], [2, true], [3, true]]);
    expect(await watch()).toMatchObject({ looked: 3, fresh: 1 });
    expect((await recentThreads())[0].replies).toHaveLength(2);
    expect(await events.recent()).toHaveLength(1);
    expect((await watch()).fresh).toBe(0);
  });

  test("a refusal from CurseForge is said, the others still looked at", async () => {
    setCommentsFetch(async (url) => (url.includes("1728396") ? new Response("", { status: 403 }) : Response.json({ data: [] })));
    const r = await watch();
    expect(r.failed).toEqual(["Error: curseforge 1728396: 403"]);
  });
});
