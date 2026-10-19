import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { dashboard, standing } from "../src/dashboard";
import type { Event } from "../src/events";
import { check, forgetAsked, resolutions, setGitHubFetch, settle } from "../src/github";

// GitHub as the tests see it: a path, its answer (absent: 404)
let answers: Record<string, unknown> = {};
let asked: string[] = [];
beforeEach(() => {
  process.env.INBOX_DIR = mkdtempSync(path.join(tmpdir(), "gh-"));
  answers = {};
  asked = [];
  forgetAsked();
  setGitHubFetch(async (url) => {
    const p = url.replace("https://api.github.com", "");
    asked.push(p);
    return p in answers ? Response.json(answers[p]) : new Response("", { status: 404 });
  });
});
afterEach(() => {
  rmSync(process.env.INBOX_DIR!, { recursive: true, force: true });
  delete process.env.INBOX_DIR;
  setGitHubFetch((input, init) => fetch(input, init));
});

const PR = "https://github.com/salty-max/wow-data/pull/7";
const RUN = "https://github.com/salty-max/hearthtale/actions/runs/100";
const ev = (kind: Event["kind"], at: string, title: string, url?: string, repo = "wow-data"): Event => ({ at, kind, repo, title, body: "", ...(url && { url }) });
const run = (id: number, conclusion: string | null, created: string) => ({ id, conclusion, workflow_id: 9, head_branch: "main", created_at: created, updated_at: created });

describe("problems settled, in GitHub's words", () => {
  test("a pull request: merged or closed settles it, open doesn't", async () => {
    answers["/repos/salty-max/wow-data/pulls/7"] = { state: "open", merged_at: null, closed_at: null };
    expect(await check(PR)).toBeNull();
    answers["/repos/salty-max/wow-data/pulls/7"] = { state: "closed", merged_at: "2026-10-18T11:45:32Z", closed_at: "2026-10-18T11:45:32Z" };
    expect(await check(PR)).toEqual({ at: "2026-10-18T11:45:32Z", how: "merged" });
    answers["/repos/salty-max/wow-data/pulls/7"] = { state: "closed", merged_at: null, closed_at: "2026-10-18T12:00:00Z" };
    expect(await check(PR)).toEqual({ at: "2026-10-18T12:00:00Z", how: "closed" });
  });

  test("a failed run: passed on a re-run, or a later run of its workflow passed; a later failure keeps it", async () => {
    answers["/repos/salty-max/hearthtale/actions/runs/100"] = run(100, "success", "2026-10-16T11:30:00Z");
    expect(await check(RUN)).toEqual({ at: "2026-10-16T11:30:00Z", how: "passed" });
    answers["/repos/salty-max/hearthtale/actions/runs/100"] = run(100, "failure", "2026-10-16T11:30:00Z");
    const later = "/repos/salty-max/hearthtale/actions/workflows/9/runs?branch=main&status=completed&per_page=1";
    answers[later] = { workflow_runs: [run(100, "failure", "2026-10-16T11:30:00Z")] };
    expect(await check(RUN)).toBeNull();
    answers[later] = { workflow_runs: [run(101, "failure", "2026-10-17T11:30:00Z")] };
    expect(await check(RUN)).toBeNull();
    answers[later] = { workflow_runs: [run(102, "success", "2026-10-17T11:30:00Z")] };
    expect(await check(RUN)).toEqual({ at: "2026-10-17T11:30:00Z", how: "passed" });
    expect(await check("https://example.com/salty-max/x/pull/1")).toBeNull();
  });

  test("settled once and kept; still open asked again only after two minutes; links no event holds dropped", async () => {
    const list = [ev("waiting", "2026-10-18T09:07:00Z", "Players' facts wait for you", PR), ev("merged", "2026-10-18T09:00:00Z", "Yonder's data", "https://github.com/salty-max/yonder/pull/3")];
    const now = Date.parse("2026-10-18T12:00:00Z");
    answers["/repos/salty-max/wow-data/pulls/7"] = { state: "open", merged_at: null, closed_at: null };
    expect(await settle(list, { now })).toEqual({});
    expect(asked).toEqual(["/repos/salty-max/wow-data/pulls/7"]); // (a merge told is no problem: never asked)
    answers["/repos/salty-max/wow-data/pulls/7"] = { state: "closed", merged_at: "2026-10-18T11:45:32Z", closed_at: "2026-10-18T11:45:32Z" };
    expect(await settle(list, { now: now + 60_000 })).toEqual({});
    expect(asked.length).toBe(1);
    expect(await settle(list, { now: now + 120_000 })).toEqual({ [PR]: { at: "2026-10-18T11:45:32Z", how: "merged" } });
    expect(await resolutions()).toEqual({ [PR]: { at: "2026-10-18T11:45:32Z", how: "merged" } });
    await settle(list, { now: now + 600_000 });
    expect(asked.length).toBe(2); // (settled: never asked again)
    // (the event gone from the activity, its resolution goes at the next one saved)
    answers["/repos/salty-max/hearthtale/actions/runs/100"] = run(100, "success", "2026-10-19T05:00:00Z");
    expect(await settle([ev("failed", "2026-10-19T04:00:00Z", "Hearthtale's data job failed", RUN, "hearthtale")], { now: now + 600_000 })).toEqual({
      [RUN]: { at: "2026-10-19T05:00:00Z", how: "passed" },
    });
  });

  test("GitHub not answering leaves the problem as it was", async () => {
    setGitHubFetch(async () => new Response("rate limited", { status: 403 }));
    expect(await settle([ev("failed", "2026-10-19T04:00:00Z", "x", RUN, "hearthtale")])).toEqual({});
  });
});

describe("how things stand", () => {
  const now = Date.parse("2026-10-19T08:00:00Z");
  test("a merged pull request waits no more, a job passed since failed no more", () => {
    const list = [ev("waiting", "2026-10-18T09:07:00Z", "Players' facts wait for you", PR), ev("failed", "2026-10-18T05:00:00Z", "Hearthtale's data job failed", RUN, "hearthtale")];
    expect(standing(list, {}, now)).toMatchObject({ tone: "blood", title: "A job failed" });
    expect(standing(list, { [RUN]: { at: "2026-10-18T06:00:00Z", how: "passed" } }, now)).toMatchObject({ tone: "gold", title: "Something waits for you" });
    const settled = { [RUN]: { at: "2026-10-18T06:00:00Z", how: "passed" as const }, [PR]: { at: "2026-10-18T11:45:32Z", how: "merged" as const } };
    expect(standing(list, settled, now)).toMatchObject({ tone: "ok", title: "All quiet" });
  });

  test("an open pull request told each day counts once and stays a week; a failure GitHub can't speak of, 36 hours", () => {
    const daily = [ev("waiting", "2026-10-18T09:07:00Z", "Players' facts wait for you", PR), ev("waiting", "2026-10-15T09:07:00Z", "Players' facts wait for you", PR)];
    expect(standing(daily, {}, now)).toMatchObject({ title: "Something waits for you", line: "Players' facts wait for you" });
    expect(standing(daily.slice(1), {}, now)).toMatchObject({ title: "Something waits for you" });
    expect(standing(daily.slice(1), {}, now + 7 * 86_400_000)).toMatchObject({ tone: "ok" });
    expect(standing([ev("failed", "2026-10-17T12:00:00Z", "Something broke")], {}, now)).toMatchObject({ tone: "ok" });
    const twice = [ev("failed", "2026-10-19T05:00:00Z", "Hearthtale's data job failed", RUN, "hearthtale"), ev("failed", "2026-10-18T05:00:00Z", "Hearthtale's data job failed", RUN.replace("100", "99"), "hearthtale")];
    expect(standing(twice, {}, now)).toMatchObject({ title: "A job failed" });
  });

  test("the activity says what settled a problem", () => {
    const html = dashboard({ days: {} }, { events: [ev("waiting", "2026-10-18T09:07:00Z", "Players' facts wait for you", PR)], resolved: { [PR]: { at: "2026-10-18T11:45:32Z", how: "merged" } } });
    expect(html).toContain('class="done"');
    expect(html).toMatch(/class="tag ok"[^>]*>Merged /);
  });
});
