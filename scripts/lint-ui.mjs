/**
 * Quince Core output audit.
 *
 *   node scripts/lint-ui.mjs [path ...]
 *
 * Runs QDS_LINT() against real rendered pages in a browser. Two things the
 * design system warns about, both handled here:
 *
 *   1. file:// makes the linter silently inert — every stylesheet becomes an
 *      opaque origin and the class checks go dead. So we load over HTTP and
 *      assert the stylesheets are actually readable first.
 *   2. An empty result is not a pass. QDS_LINT against a region with nothing
 *      in it returns passed:true. So we inject a known-bad node and confirm
 *      the linter FIRES before believing any clean run.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const paths = process.argv.slice(2);
const routes = paths.length ? paths : ["/"];

const lintSource = readFileSync("public/ds/lint.js", "utf8");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

let totalErrors = 0;
let totalWarnings = 0;
let proved = false;

for (const route of routes) {
  const url = `${BASE}${route}`;
  const res = await page.goto(url, { waitUntil: "networkidle" });
  if (!res || !res.ok()) {
    console.error(`\n✗ ${route} — HTTP ${res ? res.status() : "no response"}`);
    totalErrors++;
    continue;
  }

  // Precondition: stylesheets must be readable, or every check is meaningless.
  const readable = await page.evaluate(
    () =>
      [...document.styleSheets].filter((s) => {
        try {
          return !!s.cssRules;
        } catch {
          return false;
        }
      }).length,
  );
  if (readable === 0) {
    console.error(
      `\n✗ ${route} — 0 readable stylesheets. Every result below would be meaningless.`,
    );
    totalErrors++;
    continue;
  }

  await page.addScriptTag({ content: lintSource });

  // Liveness probe, once: prove the linter can fail before trusting a pass.
  if (!proved) {
    const probe = await page.evaluate(() => {
      const el = document.createElement("div");
      el.innerHTML =
        '<button class="btn btn--gost" style="background:#ff0000">x</button>';
      document.body.appendChild(el);
      const counts = window.QDS_LINT().counts;
      el.remove();
      return counts;
    });
    if (!probe || (probe.error ?? 0) === 0) {
      console.error(
        "\n✗ Liveness probe did not fire. The linter is not actually checking — aborting.",
      );
      await browser.close();
      process.exit(1);
    }
    console.log(
      `linter live (probe raised ${probe.error} error${probe.error === 1 ? "" : "s"})\n`,
    );
    proved = true;
  }

  const result = await page.evaluate(() => {
    const r = window.QDS_LINT();
    return {
      passed: r.passed,
      counts: r.counts,
      findings: (r.findings ?? []).map((f) => ({
        level: f.level,
        rule: f.rule,
        message: f.message,
        selector: f.selector,
      })),
    };
  });

  const e = result.counts?.error ?? 0;
  const w = result.counts?.warn ?? 0;
  totalErrors += e;
  totalWarnings += w;

  console.log(`${e === 0 ? "✓" : "✗"} ${route} — ${e} errors, ${w} warnings`);
  for (const f of result.findings) {
    console.log(
      `    ${f.level === "error" ? "ERROR" : "warn "}  ${f.rule ?? ""} — ${f.message ?? ""}${f.selector ? `  [${f.selector}]` : ""}`,
    );
  }
}

await browser.close();

console.log(
  `\n${totalErrors === 0 ? "PASS" : "FAIL"} — ${totalErrors} errors, ${totalWarnings} warnings across ${routes.length} route(s)`,
);
process.exit(totalErrors === 0 ? 0 : 1);
