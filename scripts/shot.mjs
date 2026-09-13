import { chromium } from 'playwright';
const out = process.argv[3] ?? '/tmp/procura-shot.png';
const route = process.argv[2] ?? '/';
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:1440,height:900}, deviceScaleFactor:2 });
await p.goto('http://localhost:3000'+route, { waitUntil:'networkidle' });
await p.screenshot({ path: out });
await b.close();
console.log('captured', out);
