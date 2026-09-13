import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:1440,height:900} });
await p.goto('http://localhost:3000/', { waitUntil:'networkidle' });
const r = await p.evaluate(() => {
  const g = (s)=>{const e=document.querySelector(s); if(!e) return null;
    const b=e.getBoundingClientRect(); const c=getComputedStyle(e);
    return {h:Math.round(b.height), minH:c.minHeight, display:c.display, gridTemplateRows:c.gridTemplateRows};};
  return { viewport: innerHeight, html:getComputedStyle(document.documentElement).height,
           body:getComputedStyle(document.body).height, shell:g('.shell'), pn:g('.pn'), ct:g('.ct') };
});
console.log(JSON.stringify(r,null,2));
await b.close();
