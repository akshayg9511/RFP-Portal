import { chromium } from 'playwright';

/* Screenshot a route.
   Waits on a real readiness signal, not networkidle: these pages hold many
   lazy-loaded CDN images, so the network never goes quiet and networkidle
   times out on a page that is perfectly fine. */
const route = process.argv[2] ?? '/';
const out = process.argv[3] ?? '/tmp/procura-shot.png';
const waitFor = process.argv[4];

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await p.goto('http://localhost:3000' + route, { waitUntil: 'domcontentloaded' });
if (waitFor) await p.waitForSelector(waitFor, { timeout: 20000 });
// Let in-flight images paint.
await p.waitForLoadState('load').catch(() => {});
await p.waitForTimeout(2500);
await p.screenshot({ path: out });
await b.close();
console.log('captured', out);
