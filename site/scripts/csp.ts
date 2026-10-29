// The built page against vercel.json's CSP: no inline script, no <style>, no
// style attribute, nothing loaded from another host by the HTML or the CSS
// (script-src, style-src, img-src and font-src are 'self'). Run after
// `astro build`.

import { Glob } from "bun";

const dist = new URL("../dist/", import.meta.url).pathname;
const problems: string[] = [];

for await (const file of new Glob("**/*.html").scan(dist)) {
  const html = await Bun.file(dist + file).text();
  for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
    if (!/\bsrc=/.test(tag)) problems.push(`${file}: an inline script`);
  }
  if (/<style\b/.test(html)) problems.push(`${file}: a <style> element`);
  if (/\sstyle=/.test(html)) problems.push(`${file}: a style attribute`);
  for (const [, url] of html.matchAll(/<(?:script|link|img)\b[^>]*(?:src|href)="(https?:[^"]+)"/g)) {
    problems.push(`${file}: loads ${url}`);
  }
}

for await (const file of new Glob("**/*.css").scan(dist)) {
  const css = await Bun.file(dist + file).text();
  // url() and @import only: Tailwind's licence comment names its site
  for (const [, url] of css.matchAll(/(?:url\(\s*|@import\s+)["']?(https?:\/\/[^)"'\s]+)/g)) {
    problems.push(`${file}: loads ${url}`);
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("csp: the build keeps to vercel.json's policy");
