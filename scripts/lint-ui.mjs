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

/**
 * Interaction states, because a drawer or dialog is a STATE of a route and the
 * populated view is not the whole deliverable. Several real defects have only
 * ever been visible with a drawer open — .drawer-frame shipping a storybook
 * specimen height, .scrim carrying a 16px radius on a full-viewport overlay.
 * Each entry opens the state, waits, and lints again under a state label.
 */
const STATES = {
  /**
   * The product page. Every tab is a state, plus the two that hide defects:
   * a bucket expanded (the template-driven line groups) and the footer
   * confirmation (which used to render off-screen inside a scrollable body).
   */
  "/products/award": [
    {
      name: "product · compare bids, bucket expanded",
      open: async (page) => {
        await page.waitForSelector(".pd-subtabs", { timeout: 8000 });
        await page.locator('.pd-subtabs [role=tab]').nth(0).click();
        await page.waitForTimeout(700);
        await page.locator(".bc-expand").first().click();
        await page.waitForTimeout(600);
      },
    },
    {
      name: "product · strategies",
      open: async (page) => {
        await page.locator('.pd-subtabs [role=tab]').nth(2).click();
        await page.waitForTimeout(700);
      },
    },
    {
      name: "product · save-strategy form",
      open: async (page) => {
        const save = page.locator('button:has-text("Save as a strategy")');
        if (await save.count()) {
          await save.click();
          await page.waitForTimeout(500);
        }
      },
    },
    {
      name: "product · gallery drawer",
      open: async (page) => {
        await page.locator(".pd-thumb").click();
        await page.waitForSelector(".drawer", { timeout: 8000 });
        await page.waitForTimeout(1200);
      },
    },
    {
      name: "product · footer confirmation",
      open: async (page) => {
        // The gallery drawer is open from the previous state.
        await page.keyboard.press("Escape");
        await page.waitForTimeout(600);
        await page.locator('.pd-subtabs [role=tab]').nth(1).click();
        await page.waitForTimeout(600);
        await page.locator('.pd-footer button:has-text("Award")').click();
        await page.waitForTimeout(500);
      },
    },
  ],

  "/rfps": [
    {
      name: "rfp detail · products tab, row expanded",
      open: async (page) => {
        // The name cell is the link. Pick an ISSUED RFP so the completion
        // bars and bid prices are on screen to be linted.
        await page.locator('tbody tr:has-text("ISSUED") a').first().click();
        await page.waitForSelector("[role=tablist]", { timeout: 8000 });
        await page.waitForTimeout(1200);
        await page.locator(".rd-head").first().click();
        await page.waitForTimeout(600);
      },
    },
    {
      name: "rfp detail · vendors tab",
      open: async (page) => {
        await page.locator("[role=tab]").nth(1).click();
        await page.waitForTimeout(900);
      },
    },
    {
      // The flat variant rows (1.7). Switching tabs alone never opens a
      // vendor, so the rows the nomination actually uses went unlinted.
      name: "rfp detail · vendors tab, vendor expanded to variants",
      open: async (page) => {
        await page.locator("[role=tab]").nth(1).click();
        await page.waitForTimeout(900);
        const head = page.locator(".rd-head").first();
        if (await head.count()) {
          await head.click();
          await page.waitForTimeout(900);
        }
      },
    },
    {
      name: "rfp detail · new-vendor dialog",
      open: async (page) => {
        // The state that would have caught the scrim specimen — the dim has
        // to cover the whole viewport, not an inset box.
        await page.goto(`${BASE}/rfps`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1500);
        const draft = page.locator('tbody tr:has-text("DRAFT") a').first();
        if ((await draft.count()) === 0) return;
        await draft.click();
        await page.waitForSelector("[role=tablist]", { timeout: 8000 });
        await page.locator("[role=tab]").nth(1).click();
        await page.waitForTimeout(700);
        await page.locator('button:has-text("Add vendors")').click();
        await page.waitForSelector(".drawer", { timeout: 6000 });
        await page.locator('.drawer button:has-text("New vendor")').click();
        await page.waitForSelector("[role=dialog]", { timeout: 6000 });
        await page.waitForTimeout(700);
      },
    },
    {
      name: "rfp detail · add-vendors picker",
      open: async (page) => {
        // Only a DRAFT can add vendors, so navigate to one. An ISSUED RFP
        // deliberately has no Add button — §5.5's addendum flow is separate.
        await page.goto(`${BASE}/rfps`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1500);
        const draft = page.locator('tbody tr:has-text("DRAFT") a').first();
        if ((await draft.count()) === 0) return;
        await draft.click();
        await page.waitForSelector("[role=tablist]", { timeout: 8000 });
        await page.locator("[role=tab]").nth(1).click();
        await page.waitForTimeout(800);
        await page.locator('button:has-text("Add vendors")').click();
        await page.waitForSelector(".drawer", { timeout: 6000 });
        await page.waitForTimeout(1000);
      },
    },
  ],
  "/style-sets": [
    {
      // The card's ghost dropdown is a floating surface a resting-state run
      // never opens.
      // Was "style set card — variation dropdown". That dropdown was REMOVED
      // in 1.6b, and this state kept passing because its `if (count)` guard
      // silently skipped — a state that checks nothing and reports success,
      // the same failure mode as the un-authenticated harness. Retargeted at
      // the membership chips, which is what the card still carries.
      name: "style set card — variation membership chips",
      open: async (page) => {
        const link = page.locator(".set-grid a").first();
        if (!(await link.count())) {
          throw new Error("no style set to open — the fixture changed");
        }
        await link.click();
        await page.waitForSelector(".style-card", { timeout: 10000 });
        await page.waitForSelector(".sc-var", { timeout: 10000 });
        await page.waitForTimeout(400);
      },
    },
  ],
  "/settings": [
    {
      // The bulk tray is where the one-way grain ladder is enforced, so it
      // is the state worth linting — a run that only sees the resting table
      // never exercises the floating surface.
      name: "variation setup — bulk grain tray",
      open: async (page) => {
        await page.waitForSelector("tbody tr.pc-row", { timeout: 8000 });
        const boxes = page.locator('tbody tr.pc-row [role="checkbox"]');
        await boxes.nth(0).click();
        await boxes.nth(1).click();
        await page.waitForSelector(".sel-bar", { timeout: 5000 });
        await page.waitForTimeout(400);
      },
    },
  ],
  "/products": [
    {
      // The variation rows are a different surface from the product rows —
      // recessed background, indented checkbox, a range in the cost cell.
      name: "catalog — product expanded to variations",
      open: async (page) => {
        await page.waitForSelector("tbody tr.pc-row", { timeout: 8000 });
        await page.locator(".pc-chev:not(.pc-chev--none)").first().click();
        await page.waitForSelector(".pc-var-label", { timeout: 8000 });
        await page.waitForTimeout(400);
      },
    },
    {
      name: "selection tray + save-as-set dialog",
      open: async (page) => {
        // Phase 1b migrated this column from a raw input to the DS
        // Checkbox, which is a button[role=checkbox] — there is no `input`
        // to check any more.
        const boxes = page.locator('tbody tr.pc-row [role="checkbox"]');
        await boxes.nth(0).click();
        await boxes.nth(1).click();
        await page.waitForSelector(".sel-bar", { timeout: 5000 });
        await page.locator('.sel-bar button:has-text("With")').click();
        await page.locator('.sel-menu [role=menuitem]:has-text("style set")').click();
        await page.waitForSelector("[role=dialog]", { timeout: 5000 });
        await page.waitForTimeout(600);
      },
    },
  ],
  "/insights": [
    {
      name: "vendor awards drawer open",
      open: async (page) => {
        await page.locator("tbody tr.vm-row").first().click();
        await page.waitForSelector(".drawer", { timeout: 5000 });
        await page.waitForTimeout(1500);
      },
    },
  ],
  "/vendors": [
    {
      name: "vendor drawer open",
      open: async (page) => {
        await page.locator("tbody tr.vm-row").first().click();
        await page.waitForSelector(".drawer", { timeout: 5000 });
        await page.waitForTimeout(1200);
      },
    },
  ],
  /**
   * A row NAVIGATES now — the Playground drawer is gone, replaced by
   * /products/[id]/award. The two states this replaced were
   * "playground drawer open" and "cost breakdown expanded"; the equivalents
   * live under "/products/award" above, as real tabs on a real page.
   */
  "/award": [
    {
      name: "award summary · row navigates to the allocation page",
      open: async (page) => {
        await page.locator("tr.aw-row:not(.is-disabled)").first().click();
        await page.waitForSelector(".pd-footer", { timeout: 8000 });
        await page.waitForTimeout(1200);
      },
    },
  ],
};

const lintSource = readFileSync("public/ds/lint.js", "utf8");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

/**
 * Pass the demo gate, when there is one.
 *
 * `src/middleware.ts` redirects every page to /login while DEMO_PASSWORD is
 * set, so without this the harness lints the LOGIN screen and reports every
 * interaction state as unreachable — which is exactly what happened the
 * first time the gate was switched back on for the public URL. Silently
 * passing because the gate was off is worse than failing, so this is not
 * optional plumbing.
 */
if (process.env.DEMO_PASSWORD) {
  const response = await page.request.post(`${BASE}/api/login`, {
    data: { password: process.env.DEMO_PASSWORD },
    headers: { "content-type": "application/json" },
  });
  if (!response.ok()) {
    console.error(
      `\nCould not pass the demo gate (${response.status()}). ` +
        `Check DEMO_PASSWORD matches the server's.\n`,
    );
    process.exit(1);
  }
  console.log("✓ gate — authenticated");
}

/**
 * THE TOKEN CHECK — the gap that let five invented tokens ship.
 *
 * QDS_LINT checks CLASS names against the design system. It does not check
 * TOKEN names, and an undefined custom property is invisible: CSS invalidates
 * the whole declaration and warns nobody. `--space-4xl` computed to 0px for
 * days (a comment box sat under the fixed footer, the selection tray covered
 * the last row of every list) and `--color-border-accent` meant seven
 * selection indicators drew with no colour at all.
 *
 * So: harvest every `var(--…)` the product CSS references and ask the BROWSER
 * to resolve each against the real cascade. A name that resolves to empty is
 * a name that does nothing.
 *
 * Runs once, against the first route — the token layer is global, so checking
 * it per route would repeat identical work.
 */
async function checkTokens() {
  const css = readFileSync("src/app/globals.css", "utf8");

  // Strip comments first: the post-mortems in this file NAME the tokens they
  // are warning about, and a comment is not a reference.
  const live = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const names = [
    ...new Set([...live.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].map((m) => m[1])),
  ];

  const unresolved = await page.evaluate((list) => {
    const cs = getComputedStyle(document.documentElement);
    return list.filter((n) => cs.getPropertyValue(n).trim() === "");
  }, names);

  if (unresolved.length) {
    console.error(
      `\n✗ TOKENS — ${unresolved.length} referenced token(s) resolve to nothing:`,
    );
    for (const n of unresolved) {
      console.error(`    ${n}  — declaration is invalid and silently dropped`);
    }
    return unresolved.length;
  }
  console.log(`✓ tokens — all ${names.length} referenced tokens resolve`);
  return 0;
}

let tokensChecked = false;
let totalErrors = 0;
let totalWarnings = 0;
let proved = false;
let stateCount = 0;

for (const route of routes) {
  const url = `${BASE}${route}`;
  // domcontentloaded, not networkidle: these pages hold many lazy CDN images,
  // so the network never goes quiet and networkidle times out on a healthy page.
  const res = await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
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

  if (!tokensChecked) {
    tokensChecked = true;
    totalErrors += await checkTokens();
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

  /**
   * Exact match first, then a SUFFIX match so dynamic routes find their
   * states: "/products/<cuid>/award" is keyed as "/products/award", because
   * the id is per-database and cannot be written into this file.
   */
  const statesFor =
    STATES[route] ??
    STATES[
      Object.keys(STATES).find((key) => {
        const parts = key.split("/").filter(Boolean);
        if (parts.length < 2) return false;
        // "/products/award" matches "/products/{anything}/award"
        return new RegExp(`^/${parts[0]}/[^/]+/${parts.slice(1).join("/")}$`).test(
          route,
        );
      })
    ] ??
    [];

  for (const state of statesFor) {
    try {
      await state.open(page);
    } catch (err) {
      console.error(`    ✗ could not reach state "${state.name}": ${err.message}`);
      totalErrors++;
      continue;
    }

    // A state that NAVIGATES loses the injected linter, so re-inject if it is
    // gone. Cheaper than forbidding navigation in a state, and some states —
    // reaching a draft RFP to test its add-vendors picker — genuinely need it.
    const live = await page.evaluate(() => typeof window.QDS_LINT === "function");
    if (!live) await page.addScriptTag({ content: lintSource });

    const sr = await page.evaluate(() => {
      const r = window.QDS_LINT();
      return {
        counts: r.counts,
        findings: (r.findings ?? []).map((f) => ({
          level: f.level,
          rule: f.rule,
          message: f.message,
          selector: f.selector,
        })),
      };
    });

    const se = sr.counts?.error ?? 0;
    const sw = sr.counts?.warn ?? 0;
    totalErrors += se;
    totalWarnings += sw;
    stateCount++;

    console.log(
      `${se === 0 ? "✓" : "✗"} ${route} · ${state.name} — ${se} errors, ${sw} warnings`,
    );
    for (const f of sr.findings) {
      console.log(
        `    ${f.level === "error" ? "ERROR" : "warn "}  ${f.rule ?? ""} — ${f.message ?? ""}${f.selector ? `  [${f.selector}]` : ""}`,
      );
    }
  }
}

await browser.close();

console.log(
  `\n${totalErrors === 0 ? "PASS" : "FAIL"} — ${totalErrors} errors, ${totalWarnings} warnings across ${routes.length} route(s)` +
    (stateCount ? ` and ${stateCount} interaction state(s)` : ""),
);
process.exit(totalErrors === 0 ? 0 : 1);
