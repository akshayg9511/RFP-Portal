/* Quince Core — output linter.
   ------------------------------------------------------------------
   QDS_AUDIT (spec.js) audits the STORYBOOK against its own usage data.
   This is the other direction: it audits a page YOU built, in the
   browser, against the rules the system documents. It needs nothing but
   the DS stylesheets — no stories, no usage.js — so it runs on a real
   product page.

       <script src="ds/lint.js"></script>
       QDS_LINT();            // whole document
       QDS_LINT('#root');     // a subtree

   Returns { passed, counts, findings[] } and prints a grouped table.
   Every finding names the rule it comes from, so the fix is lookup-able
   rather than a matter of taste.

   ERRORS are defects — a rule the system states, broken. WARNINGS are
   judgement calls and near-misses: a whole-screen inference the linter
   cannot make safely, or a class that only looks like a typo.

   Three deliberate limits. It only sees what is RENDERED, so a state
   nobody opened is not checked — open the drawer, the menu, the error,
   then run it again. It cannot judge whether the right component was
   chosen for the job; it checks that what is there is built correctly.
   And it says nothing about a page's OWN classes: an undefined class
   that resembles nothing in the system is the app's business, so only a
   near-miss of a real DS class is reported.
   The judgement calls stay in the handoff checklist in SKILL.md.
------------------------------------------------------------------ */
(function () {
  'use strict';

  /* ---------- helpers ---------- */

  const SEV = { error: 'error', warn: 'warn' };

  /* querySelectorAll never returns the element you call it on, so a check that
     walks a scope silently skips the scope's OWN attributes — QDS_LINT('#root')
     would not see #root's classes, so a subtree whose ROOT broke a rule linted
     clean and the tool reported PASSED, which is the worst thing an audit can
     do. Every check routes its element lookup through this. */
  function within(root, sel) {
    const list = [...root.querySelectorAll(sel)];
    if (root.matches && root.matches(sel)) list.unshift(root);
    return list;
  }

  /* Class names the CSS actually defines. A page referencing .btn--gost
     gets no styling and no error today; this is how that surfaces. Same
     read spec.js uses, with the cross-origin guard it needs on a real
     site where the DS may be served from a CDN. */
  let CSS_CLASSES = null;
  let CSS_UNREADABLE = 0;
  let CSS_READABLE = 0;
  function cssClasses() {
    if (CSS_CLASSES) return CSS_CLASSES;
    const set = new Set();
    /* Documented parts first. Some are deliberately STYLELESS — .lnk.ext is a
       semantic hook whose whole point is that it draws nothing — so a set
       derived from CSS rules alone does not contain them, and the system's own
       API gets reported as a typo. Read them from usage.js when it is present. */
    const U = window.QDS_USAGE;
    if (U) {
      Object.values(U).forEach(entry => {
        [].concat(entry.anatomy || [], entry.api || []).forEach(row => {
          const sel = Array.isArray(row) ? row[1] : null;
          if (typeof sel !== 'string') return;
          (sel.match(/\.[-_a-zA-Z][-_a-zA-Z0-9]*/g) || []).forEach(c => set.add(c.slice(1)));
        });
      });
    }
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (e) {
        /* A font service carries @font-face and nothing else, so it cannot
           affect the class table. INSTALL.md tells consumers to load Inter from
           Google Fonts, which meant this counter fired on every real page. */
        if (!/fonts\.(googleapis|gstatic)\.com|\/css2\?family=/.test(sheet.href || '')) CSS_UNREADABLE++;
        continue;
      }
      if (!rules) continue;
      CSS_READABLE++;
      /* WALK ORDER IS LOAD-BEARING: handle the rule, THEN recurse. Since CSS
         nesting shipped, a plain CSSStyleRule also carries a `cssRules` property
         — an EMPTY CSSRuleList, which is an object, which is truthy. So the
         tempting shape

             if (r.cssRules) { walk(r.cssRules); continue; }   // WRONG

         skips every ordinary style rule in the sheet and reports a confident
         empty result: 1169 rules scanned, zero matched. Recursing into an empty
         list after processing costs nothing and is correct for real nested rules;
         `continue`-ing past the rule is what breaks it. */
      const walk = (list) => {
        for (const r of list) {
          if (r.selectorText) {
            const m = r.selectorText.match(/\.[-_a-zA-Z][-_a-zA-Z0-9]*/g);
            if (m) m.forEach(c => set.add(c.slice(1)));
          }
          if (r.cssRules) walk(r.cssRules);
        }
      };
      walk(rules);
    }
    CSS_CLASSES = set;
    return set;
  }

  /* The spacing scale, resolved from the tokens rather than hardcoded, so
     this stays true if the scale ever changes. */
  function scaleValues(prefix) {
    const cs = getComputedStyle(document.documentElement);
    const out = new Set();
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
      if (!rules) continue;
      for (const r of rules) {
        if (!r.style) continue;
        for (const p of r.style) {
          if (p.startsWith(prefix)) {
            const v = cs.getPropertyValue(p).trim();
            if (v) out.add(v);
          }
        }
      }
    }
    return out;
  }

  const label = (el) => {
    const cls = (el.getAttribute && el.getAttribute('class')) || '';
    const txt = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return el.tagName.toLowerCase() + (cls ? '.' + cls.split(/\s+/).join('.') : '') + (txt ? ' \u201c' + txt + '\u201d' : '');
  };

  /* The ANCESTOR CHAIN, not just the leaf. Some rules are only findable from the
     component that emitted them: a glyph's font-size and its --icon-stroke are
     almost never declared on the glyph's own class, so a finding that says
     "svg.ms" sends the reader hunting through six sheets. "div.toast > button.x >
     svg.ms" names the rule. */
  const originPath = (el) => {
    const parts = [];
    let n = el;
    for (let i = 0; i < 4 && n && n.nodeType === 1 && n !== document.body; i++) {
      const cls = ((n.getAttribute('class') || '').match(/\S+/g) || []);
      parts.unshift(n.tagName.toLowerCase() + (cls.length ? '.' + cls.join('.') : ''));
      n = n.parentElement;
    }
    return parts.join(' > ');
  };

  /* ---------- the checks ---------- */
  /* Each returns an array of { severity, rule, message, el }.
     `rule` points at where the decision is written down. */

  /* THE DOCUMENTED EXCEPTIONS. There are none left, and that is worth stating
     rather than deleting. There used to be exactly one — the checkbox tick, set
     a step heavier than its rung because the old expanded-outline art rendered a
     1px line that read frail against the filled swatch. The cause went with the
     art: Lucide's stroke at the sm rung's 1.25px with round caps is solid on an
     18px swatch, checked at 4x before the exception was dropped. If a component
     ever needs its own weight again, list it HERE with the selector AND the
     value, so the finding can name the contract row that grants it — an
     exemption nobody can look up is indistinguishable from a bug. */
  /* ONE FINGERPRINT FOR THE WHOLE SET, and it has to read every drawable rather
     than just <path>. The markup carries no glyph name — QIC emits a bare
     <svg class="ms" viewBox> — so identifying a glyph means matching its geometry
     against window.QICONS. A path-only key looked fine and silently skipped a
     large slice of the set: Lucide builds `settings`, `search`, `calendar` and
     many others out of <circle>, <line>, <rect> and <polyline>, so those produced
     an EMPTY key and every check that depended on identification passed them
     without looking. Tag name plus geometry attributes plus transform resolves
     all of them.

     Earlier attempts, kept as a warning: the first path's `d` collides on four
     pairs including chevron_down/chevron_up; the whole body string is unique but
     never survives the DOM, because the browser reformats markup. Attribute
     VALUES do survive verbatim, which is why this reads them one at a time. */
  const ICON_GEOM = ['d','cx','cy','r','rx','ry','x','y','width','height','x1','y1','x2','y2','points','transform'];
  const iconKeyFromMarkup = (body) => (body.match(/<(?:path|circle|rect|line|polyline|polygon|ellipse)\b[^>]*>/g) || [])
    .map(t => {
      const tag = (t.match(/^<([a-z]+)/) || ['',''])[1];
      return tag + ':' + ICON_GEOM.map(a => {
        const m = t.match(new RegExp('\\s' + a + '="([^"]*)"'));
        return m ? a + '=' + m[1] : '';
      }).filter(Boolean).join(';');
    }).join('|');
  const iconKeyFromDom = (el) => [].slice.call(el.querySelectorAll('path,circle,rect,line,polyline,polygon,ellipse'))
    .map(n => n.tagName.toLowerCase() + ':' + ICON_GEOM.map(a => {
      const v = n.getAttribute(a);
      return v === null ? '' : a + '=' + v;
    }).filter(Boolean).join(';')).join('|');
  let ICON_BY_KEY = null;
  const iconNameOf = (el) => {
    const REG = (typeof window !== 'undefined' && window.QICONS) || null;
    if (!REG) return undefined;
    if (!ICON_BY_KEY) {
      ICON_BY_KEY = new Map();
      for (const [n, b] of Object.entries(REG)) {
        const k = iconKeyFromMarkup(b);
        if (k && !ICON_BY_KEY.has(k)) ICON_BY_KEY.set(k, n);
      }
    }
    const k = iconKeyFromDom(el);
    return k ? ICON_BY_KEY.get(k) : undefined;
  };

  /* Checks that audit the STYLESHEET rather than the rendered DOM. They would
     report the same authoring defect once per swept frame, so a frame context
     skips them — see lint(). */
  const ROOT_ONLY = ['radiusFollowsForm', 'breakpointDrift', 'elementQualifiedClass',
    /* touchHarvest asks whether the DERIVED touch stylesheet moves the type scale,
       and that question only has an answer in a document where the width query has
       NOT already moved it. A QDS_PHONE frame has a real narrow viewport, so type
       has stepped natively before the harvest is consulted — measured in-frame,
       --type-body-md-size is already 16px at the root, so the coarse re-declaration
       has nothing left to change and the check reports a difference it cannot find.
       The harvest is verified at the root, where the parent is wide and fine and
       the derived sheet is the only thing that could move it. */
    'touchHarvest'];

  const CHECKS = [

    /* —— Foundation: the root contract —— */
    function rootAttrs(root, doc) {
      const html = doc.documentElement;
      const out = [];
      const brand = html.getAttribute('data-brand');
      const mode = html.getAttribute('data-mode');
      if (!brand) out.push({ severity: SEV.error, rule: 'SKILL \u00b7 resolve the theme', message: 'No data-brand on the root. Every semantic token is re-declared per brand scope, so without it the page renders on the achromatic foundation and loses the accent entirely.', el: html });
      if (!mode) out.push({ severity: SEV.error, rule: 'SKILL \u00b7 resolve the theme', message: 'No data-mode on the root. Set light or dark; there is no unset mode.', el: html });
      if (brand === 'operations' || brand === 'b2b') out.push({ severity: SEV.error, rule: 'brands \u00b7 removed value', message: 'data-brand="' + brand + '" was REMOVED at v320 \u2014 it was the old name for ' + (brand === 'b2b' ? 'spacious' : 'default') + ', and no selector matches it any more, so this page is rendering the unbranded foundation. Write data-brand="' + (brand === 'b2b' ? 'spacious' : 'default') + '".', el: html });
      return out;
    },

    /* A DECLARED CONTROL DIMENSION IS A FLEX BASIS, NOT A FLOOR. Both of the
       navigation defects Phase 6B found were this one mistake in two places:
       .nav-item sets height: --size-control-md and lives in .pn, a flex COLUMN
       with overflow: auto; .nav-toggle sets a square width and lives in .hd, a
       nowrap flex ROW. In each case the declared size is the item's flex base
       size, min-*: auto floors it at its own content, and the algorithm is free
       to take the rest — so the rows compressed to 24px against a 44px touch
       floor instead of letting the panel scroll, and the trigger came out 20px
       wide beside a long product name instead of staying square.

       Both grade with available room, which is why neither was visible in a
       specimen: at 393x852 with four short destinations everything measures
       right, and the failure needs a small screen, a long list or a long brand
       name to appear. A computed-style assertion does not care how much room
       the specimen happened to have.

       Scoped to the two classes that were actually proven, rather than to a
       general rule about flex children with declared sizes — the general form
       would fire on every legitimately shrinkable item in the library. Nothing
       in this system wants a nav row or the nav trigger to give up size: the
       panel scrolls and the brandmark ellipsises, and both say so themselves. */
    function navControlShrink(root) {
      const out = [];
      root.querySelectorAll('.nav-item, .nav-toggle').forEach(function (el) {
        const parent = el.parentElement;
        if (!parent) return;
        const pd = getComputedStyle(parent).display;
        if (pd !== 'flex' && pd !== 'inline-flex') return;
        if (getComputedStyle(el).flexShrink === '0') return;
        const which = el.classList.contains('nav-toggle') ? '.nav-toggle' : '.nav-item';
        out.push({
          severity: SEV.error,
          rule: 'components.css \u00b7 nav controls do not shrink',
          message: which + ' is a shrinkable flex child (flex-shrink: ' +
            getComputedStyle(el).flexShrink + '). Its declared size is a flex BASIS, ' +
            'so the algorithm may take it back: a nav row compresses below the touch ' +
            'floor instead of letting .pn scroll, and the trigger stops being square ' +
            'beside a long product name. Set flex-shrink: 0 \u2014 the panel is what ' +
            'scrolls and the brandmark is what gives up width.',
          el: el
        });
      });
      return out;
    },

    /* A NEAR MISS of a DS class: .btn--gost, .data-gird, .nav-tem. Only
       near misses, and only a warning, because a page legitimately carries
       its own layout classes and JS hooks — reporting app-shell-wrapper or
       js-open as a defect would have an agent renaming working application
       code, and this is the highest-volume check in the set. An undefined
       class that resembles nothing of ours is the app's business. */
    function misspeltClasses(root) {
      const known = cssClasses();
      const out = [];
      const seen = new Set();
      /* DAMERAU-Levenshtein, capped. Damerau, not plain Levenshtein, because an
         adjacent transposition is the most common typo there is and plain
         Levenshtein scores it as TWO edits — with a tolerance of 1 on short
         names that made "data-gird", "nav-drawre" and "filter-abr" invisible,
         and almost the whole vocabulary is short: data-grid(9), nav-drawer(10),
         nav-item(8), select(6), field(5), chip(4). Transposition costs 1 here.

         Tolerance still scales with length, and that is what keeps ".ext" from
         matching ".dot": two SUBSTITUTIONS in a three-character name is 67%
         different, and no amount of transposition handling makes it a typo. */
      const near = (a, b) => {
        const tol = Math.min(2, Math.max(1, Math.floor(Math.min(a.length, b.length) / 6)));
        if (Math.abs(a.length - b.length) > tol) return false;
        const rows = [[...Array(b.length + 1).keys()]];
        for (let i = 1; i <= a.length; i++) {
          const cur = [i];
          let best = i;
          for (let j = 1; j <= b.length; j++) {
            const prev = rows[i - 1];
            let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            /* the transposition arm */
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
              v = Math.min(v, rows[i - 2][j - 2] + 1);
            }
            cur[j] = v;
            if (v < best) best = v;
          }
          if (best > tol) return false;
          rows[i] = cur;
        }
        const d = rows[a.length][b.length];
        return d <= tol && d > 0;
      };
      within(root, '[class]').forEach(el => {
        (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).forEach(c => {
          if (known.has(c) || seen.has(c) || c.length < 3) return;
          /* js- is a behaviour hook by convention and never a style class, so
             it is exempt outright: "js-open" is one character from ".is-open"
             and reporting it would be a false positive on every app that uses
             the convention. */
          if (/^js-/.test(c)) return;
          seen.add(c);
          const hit = [...known].find(k => k.length >= 3 && near(c, k));
          if (!hit) return;
          out.push({ severity: SEV.warn, rule: 'SKILL \u00b7 compose from documented components', message: 'Class "' + c + '" is undefined and is one or two characters from ".' + hit + '". Almost certainly a typo \u2014 an undefined class gets no styling and no error.', el: el });
        });
      });
      if (CSS_UNREADABLE && !CSS_READABLE) out.push({ severity: SEV.warn, rule: 'QDS_LINT \u00b7 coverage', message: 'No stylesheet could be read (all ' + CSS_UNREADABLE + ' are cross-origin), so this check is inert. Serve the DS same-origin to audit class names.' });
      return out;
    },

    /* —— Foundation: colour —— */
    /* A literal colour in the markup cannot re-skin, cannot invert for dark
       mode, and is not contrast-audited. This is the single most common way
       a generated page stops being the design system. */
    function hardcodedColour(root) {
      const out = [];
      within(root, '[style]').forEach(el => {
        const s = el.getAttribute('style') || '';
        const m = s.match(/(?:#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\))/g);
        if (!m) return;
        const bad = m.filter(v => !/^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/.test(v));
        if (bad.length) out.push({ severity: SEV.error, rule: 'Foundations \u2192 Color \u00b7 Tier 2 semantic tokens', message: 'Literal colour in an inline style (' + bad.slice(0, 3).join(', ') + '). It cannot re-skin per brand, does not invert in dark mode, and is not contrast-audited. Use a --color-* token.', el: el });
      });
      return out;
    },

    /* —— Foundation: type —— */
    /* The floors, measured on what actually rendered rather than on the
       markup, so an inherited size counts too. */
    function typeFloor(root) {
      const out = [];
      const seen = new Set();
      within(root, '*').forEach(el => {
        if (!el.firstChild || el.children.length && ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return;
        const px = parseFloat(getComputedStyle(el).fontSize);
        if (!px || px >= 12) return;
        const k = el.tagName + px;
        if (seen.has(k)) return;
        seen.add(k);
        out.push({ severity: SEV.error, rule: 'Foundations \u2192 Type \u00b7 minimum sizes', message: 'Text renders at ' + px + 'px. Nothing in the system sits below 12px, and 12px itself is only for timestamps, legal lines, counts and axis values.', el: el });
      });
      return out;
    },

    /* —— Icons: the NAME is a gate, not a suggestion ——
       QIC() does not throw on an unknown name; it renders a dashed placeholder
       carrying data-missing, so a typo degrades to something that looks almost
       like a glyph and ships. QDS_AUDIT already fails stories on this. Generated
       product UI never passes through QDS_AUDIT, so the same gate has to exist
       here or the rule only binds the people who did not need it.
       The suggestion is worth the few lines: the near misses are overwhelmingly
       a Figma PascalCase name (ChevronDown), a plural, or a synonym the set does
       not carry (pencil for edit, copy for order), and naming the nearest real
       one turns a dead end into a one-word fix. */
    function iconName(root) {
      const out = [];
      const names = Object.keys(window.QICONS || {});
      /* Common misses share NO letters with the real name, so string distance
         cannot reach them: an agent reaches for the word its training says, and
         this set is a commerce set with its own vocabulary. These are the ones
         seen in practice. A synonym that maps to nothing real is listed as null
         so the message can say the set has no such glyph rather than inventing a
         near miss \u2014 "no icon for this" is a more useful answer than a wrong one. */
      const ALIAS = {
        pencil: 'edit', write: 'edit', note: 'edit', compose: 'edit',
        trash: 'delete', bin: 'delete', remove: 'delete', discard: 'delete',
        gear: 'slider', cog: 'slider', settings: 'slider', filter: 'slider', sliders: 'slider',
        home: 'house', dashboard: 'house',
        user: 'profile', person: 'profile', account: 'profile', avatar: 'profile',
        cart: 'bag', basket: 'bag', shopping_cart: 'bag',
        mail: 'email', envelope: 'email',
        magnify: 'search', magnifier: 'search', find: 'search',
        cross: 'close', x: 'close', dismiss: 'close', cancel: 'close',
        tick: 'check', done: 'check', success: 'check',
        warning: 'alert_triangle', danger: 'alert_circle', error: 'alert_circle',
        info: 'info_circle', question: 'help_circle',
        download: 'arrow_down', upload: 'arrow_up', back: 'arrow_left',
        calendar_today: 'calendar', date: 'calendar',
        copy: null, duplicate: null, clone: null, folder: null, file: null,
        image: null, attachment: null, print: null, refresh: null, sync: null
      };
      const suggest = (bad) => {
        const raw = String(bad).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        if (Object.prototype.hasOwnProperty.call(ALIAS, raw)) {
          return ALIAS[raw]
            ? ' The set has no "' + raw + '"; use "' + ALIAS[raw] + '".'
            : ' The set has no equivalent \u2014 pick a different affordance or ship the glyph into the library first.';
        }
        const b = raw.replace(/[^a-z0-9]/g, '');
        if (!b || !names.length) return '';
        let best = '', score = 0;
        names.forEach(n => {
          const a = n.replace(/[^a-z0-9]/g, '');
          let s = 0;
          if (a === b) s = 100;
          else if (a.startsWith(b) || b.startsWith(a)) s = 60 + Math.min(a.length, b.length);
          else if (a.includes(b) || b.includes(a)) s = 40 + Math.min(a.length, b.length);
          else { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; s = i * 4; }
          if (s > score) { score = s; best = n; }
        });
        return score >= 12 ? ' Did you mean "' + best + '"?' : '';
      };
      within(root, '[data-missing]').forEach(el => {
        const bad = el.getAttribute('data-missing');
        out.push({ severity: SEV.error, rule: 'Components \u2192 Icon \u00b7 the set is the set', message: '"' + bad + '" is not in the icon library, so it renders as a dashed placeholder. Only the ' + names.length + ' runtime names in window.QICONS may be used \u2014 they are snake_case; Icon.d.ts\u2019s PascalCase IconDataName is the Figma build input and is NOT interchangeable.' + suggest(bad), el: el });
      });
      return out;
    },

    /* —— A region scrolls in ONE direction ——
       The rule is not "nothing scrolls sideways" — a carousel track, a data grid
       and the storybook's own wide() frames all scroll horizontally on purpose,
       and every one of them is fixed in the other axis. The rule is that a region
       scrolling in BOTH directions is almost always an accident: content grows
       down or it grows across, and something growing both ways is a canvas, not a
       panel. Checking the pair rather than the axis is what makes this precise
       enough to be an error instead of a list of exemptions.

       It also happens to be the exact signature of the defect it was written for.
       .drawer-b, .modal-b and .popover-b each set overflow-y: auto, which per
       spec makes overflow-x compute to AUTO rather than stay visible — so a
       vertical scroller silently became a two-axis one the moment a table or an
       unbroken URL arrived. Measured before the fix: 217px in a drawer at 375,
       241 in a modal at 375, and 136 in a modal at its NATURAL 480 DESKTOP WIDTH.
       Three components, every width, and four checkpoints of clean sweeps went
       past it because nothing was looking for it.

       Only what genuinely overflows is reported. A body with both axes set to
       auto and nothing spilling is a latent condition, not a defect, and flagging
       it would fire on every scrollable panel in every consumer app. */
    function twoAxisScroll(root) {
      const out = [];
      const seen = new Set();
      within(root, '*').forEach(el => {
        if (el.scrollWidth <= el.clientWidth + 1) return;
        if (el.scrollHeight <= el.clientHeight + 1) return;
        if (el.closest('[data-audit-skip]')) return;
        /* PREFORMATTED TEXT IS THE ONE HONEST TWO-AXIS REGION. Everywhere else
           the fix is to let the content reflow; in a <pre> that IS the content —
           the lines are as long as they are, deliberately, and wrapping them
           corrupts the thing being shown. Found by this check on its first run
           over the storybook, in the machine-spec block: 9339px across and
           scrolling down. Named here rather than the rule being widened, so the
           exception stays one category instead of becoming a habit. */
        if (el.tagName === 'PRE' || el.closest('pre')) return;
        const cs = getComputedStyle(el);
        const sx = cs.overflowX, sy = cs.overflowY;
        if (sx !== 'auto' && sx !== 'scroll') return;
        if (sy !== 'auto' && sy !== 'scroll') return;
        const cls = (el.getAttribute('class') || el.tagName).slice(0, 40);
        if (seen.has(cls)) return;
        seen.add(cls);
        out.push({ severity: SEV.error, el,
          rule: 'Foundations \u2192 Layout \u00b7 scroll one axis, not two',
          message: '"' + cls + '" scrolls in BOTH directions \u2014 ' +
            (el.scrollWidth - el.clientWidth) + 'px across and ' +
            (el.scrollHeight - el.clientHeight) + 'px down. A region scrolls in the direction its ' +
            'content grows, and something growing both ways is a canvas rather than a panel. The ' +
            'usual cause is not a second scrollbar being asked for: setting overflow-y: auto makes ' +
            'overflow-x compute to AUTO per spec, so one wide child turns a vertical scroller into ' +
            'a two-axis one. Fix the width rather than clamping it \u2014 min-inline-size: 0 on the ' +
            'children so a table or a field row can shrink, overflow-wrap: anywhere for strings ' +
            'with no break opportunity, and overflow-x: clip only as a backstop. Anything still ' +
            'wider belongs in its own scroll container.' });
      });
      return out;
    },

    /* —— Breakpoints: nameable, even though they are not usable as tokens ——
       A media query cannot read var(): it is evaluated before the cascade
       produces a computed value, so there is nothing to resolve against, and
       @custom-media needs a build step this library does not have. Every @media
       therefore writes a literal, which is exactly the "magic number" complaint —
       768 sat in nine places, 900 and 1100 in one each, and none of them was
       written down as a decision anywhere.

       The tokens cannot drive the queries, but they can make the number DECIDED
       in one place, and this check is what stops the literals drifting from it.
       Declare a breakpoint as --bp-* on the root and every @media in the ds/
       sheets must match one; a query at some width nobody named is an error.

       ONLY ds/ SHEETS. A product's own breakpoints are the product's business —
       the same principle that stops the class check reporting app-shell-wrapper
       as a typo. */
    /* —— The Interaction toggle's derived stylesheet is complete and live ——
       QDS_TOUCH_CSS lifts every @media (pointer: coarse) rule out of the loaded
       sheets and re-emits it scoped to an attribute, so the storybook can preview
       Touch on a desktop. A DERIVED COPY THAT SILENTLY COVERS LESS THAN ITS
       SOURCE IS WORSE THAN NO COPY — the specimen then shows pointer geometry
       while claiming to show touch, which is the exact defect the harvest
       replaced (nine phone specimens rendering 36px controls on a 373px
       viewport). Two assertions, because either alone can pass while the other
       fails: the arithmetic must reconcile, AND a known rule must actually
       RESOLVE on a probe rather than merely appear in the text. */
    function touchHarvest(root, doc) {
      const out = [];
      if (typeof window.QDS_TOUCH_CSS !== 'function') return out;
      const rep = window.QDS_TOUCH_CSS();
      if (!rep.source) return out;   /* no coarse rules to harvest — nothing to assert */

      if (rep.harvested !== rep.expected || rep.problems.length) {
        out.push({ severity: SEV.error, el: null,
          rule: 'Foundations → Layout · Interaction harvest',
          message: 'The derived Touch stylesheet covers ' + rep.harvested + ' of ' + rep.expected +
            ' component coarse rules (' + rep.source + ' found, ' + rep.skippedShell +
            ' shell rules skipped by design)' +
            (rep.problems.length ? '. Unscoped: ' + rep.problems.join(' | ') : '.') +
            ' A rule the harvest cannot transform is a rule the Touch preview silently omits, so the ' +
            'specimen shows pointer geometry while labelled Touch. Fix the transform in ' +
            'qdsScopeSelector (ds/stories-foundations.js) rather than hand-writing the rule.' });
      }

      /* THE PROBE RESOLVES, it is not merely present. The control ladder is the
         rule everything else leans on, so it is the one asserted: a probe wearing
         the scope attribute must compute the TOUCH md rung, not the pointer one.
         Read through a real length property — a custom property is substituted
         rather than computed, and --size-control-lg is a max() whose text
         parseFloat()s to NaN. */
      const px = (token, host) => {
        const el = doc.createElement('div');
        el.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;inline-size:var(' + token + ')';
        (host || doc.documentElement).appendChild(el);
        const v = parseFloat(getComputedStyle(el).inlineSize);
        el.remove();
        return isNaN(v) ? 0 : v;
      };
      const probe = doc.createElement('div');
      probe.setAttribute('data-pointer', 'coarse');
      probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
      doc.body.appendChild(probe);
      const underScope = px('--size-control-md', probe);
      probe.remove();
      /* A SECOND PROBE, ON THE TYPE AXIS, because the first one could not have
         caught what type steps got wrong. --size-control-md is declared directly
         in the coarse block, so a probe on it passes as soon as the block is
         injected; the type rungs are consumed through a second-level alias
         (--table-cell-size) and through an inherited font-size on body, and both
         went on reading their pointer values while the probe stayed green. This
         asserts the body rung actually differs under the scope, which is the
         cheapest thing that would have failed. */
      const typeProbe = doc.createElement('div');
      typeProbe.setAttribute('data-pointer', 'coarse');
      typeProbe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
      doc.body.appendChild(typeProbe);
      const typeUnderScope = px('--type-body-md-size', typeProbe);
      typeProbe.remove();
      const typeAtRoot = px('--type-body-md-size');
      /* THE PRECONDITION IS BOTH AXES QUIET, and getting that wrong made this
         check cry wolf the moment it was written. The type scale steps on the
         VIEWPORT as well as the pointer, so in a narrow window the root already
         holds 16 — scope and root then agree innocently and an assertion that
         reads equality as failure fires on a page where nothing is wrong. It can
         only compare the two when neither step is active: a wide window on a
         fine pointer, where the root is guaranteed to hold pointer values. */
      const turn = (getComputedStyle(document.documentElement)
        .getPropertyValue('--bp-turn').trim() || '768px');
      const bothAxesQuiet = !matchMedia('(pointer: coarse)').matches
        && !matchMedia('(max-width: ' + turn + ')').matches;
      if (bothAxesQuiet && typeAtRoot && typeUnderScope && typeUnderScope === typeAtRoot) {
        out.push({ severity: SEV.error, el: null,
          rule: 'Foundations \u2192 Layout \u00b7 Interaction harvest',
          message: 'The derived Touch stylesheet is not moving the TYPE scale: --type-body-md-size ' +
            'resolves to ' + typeUnderScope + 'px both at the root and under data-pointer="coarse", ' +
            'though the coarse block re-declares it. Type reaches components through aliases ' +
            '(--table-cell-size) and through an inherited font-size on body, so a step can be ' +
            'present in the block and still not arrive: an alias substitutes at the element that ' +
            'DECLARES it, and an inherited size can only be changed by a declaration on a ' +
            'descendant.' });
      }
      const wantTouch = px('--size-control-touch-md');
      if (wantTouch && underScope !== wantTouch) {
        out.push({ severity: SEV.error, el: null,
          rule: 'Foundations → Layout · Interaction harvest',
          message: 'The derived Touch stylesheet is not in effect: an element carrying ' +
            'data-pointer="coarse" resolves --size-control-md to ' + underScope + 'px, and the touch ' +
            'rung is ' + wantTouch + 'px. The text can be correct and still not apply — the block ' +
            'has to be injected LAST, because a scoped rule and the base rule it overrides can land ' +
            'on equal specificity. Call QDS_TOUCH_SCOPE() after the sheets are readable.' });
      }
      return out;
    },

    /* —— Foundation: radius follows FORM, never the viewport ——
       The rule: a corner changes because the component changed SHAPE, not because
       the screen got smaller. A dialog that becomes full-screen legitimately drops
       to 0 because it now touches four edges; a bottom sheet legitimately rounds
       only its top two because it is flush to three. A card is a card at every
       width and keeps --radius-container.

       WHY IT IS WORTH ENFORCING RATHER THAN TRUSTING: the tokens are already
       viewport-invariant — measured, not one --radius-* is redeclared inside any
       media query in ds/ — and the three radius changes that exist below the turn
       are all genuine form changes. So this check protects a passing state. The
       failure it prevents is the easy one: someone softens or squares a corner "for
       mobile" because it looked better on a phone, which quietly forks the shape
       language by screen size and is exactly what a separate mobile radius system
       would have institutionalised.

       FORM CHANGE IS DETECTABLE IN THE SAME RULE. A surface that has genuinely
       changed shape says so in CSS: it re-anchors (position, inset, top/right/
       bottom/left), re-sizes (inline-size/block-size/width/height/max-*), or
       changes display. All three legitimate cases do — the sheet sets position
       and three insets, the .full and drawer cases set inset-block and
       block-size: 100dvh. A lone border-radius in a width query, with no geometry
       beside it, is a corner changing on viewport alone.

       WIDTH-KEYED ONLY. A radius change under prefers-reduced-motion, print or
       forced-colors is a different argument and not this rule's business. */
    function radiusFollowsForm(root, doc) {
      const out = [];
      const FORM = /(^|[^-])(position|inset|inset-block|inset-block-start|inset-block-end|inset-inline|inset-inline-start|inset-inline-end|top|right|bottom|left|inline-size|block-size|width|height|max-inline-size|max-block-size|max-width|max-height|min-inline-size|min-block-size|display)\s*:/;
      const seen = new Set();
      for (const sheet of doc.styleSheets) {
        const href = sheet.href || '';
        if (!/\/ds\//.test(href)) continue;
        let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
        if (!rules) continue;
        const file = href.split('/').pop().split('?')[0];
        const walk = (rl, cond) => {
          for (const r of rl) {
            const nextCond = (r.media && r.conditionText) ? r.conditionText : cond;
            if (r.selectorText && r.style && nextCond && /\bwidth\b/.test(nextCond)) {
              const txt = r.style.cssText || '';
              const changesRadius = /(^|;|\s)border(-[a-z]+)*-radius\s*:/.test(txt) || /--radius-[a-z]+\s*:/.test(txt);
              if (changesRadius && !FORM.test(txt)) {
                const key = file + '|' + nextCond + '|' + r.selectorText;
                if (!seen.has(key)) {
                  seen.add(key);
                  out.push({ severity: SEV.error,
                    rule: 'Foundations → Radius · a corner follows form, not the viewport',
                    message: file + ' changes a radius on "' + r.selectorText.slice(0, 60) + '" inside ' +
                      '@media ' + nextCond + ', and that rule changes nothing else about the ' +
                      'surface’s shape — no position, no inset, no size, no display. A corner ' +
                      'should change because the COMPONENT changed form, not because the screen got ' +
                      'smaller: a dialog that becomes full-screen drops to 0 because it now touches ' +
                      'four edges, and a bottom sheet rounds only its top two because it is flush to ' +
                      'three. A card is a card at every width. If the surface really does change ' +
                      'shape here, the geometry belongs in this rule too; if it does not, the radius ' +
                      'does not belong in a media query at all.' });
                }
              }
            }
            /* Handle the rule, THEN recurse — a plain CSSStyleRule carries an
               empty but truthy cssRules under CSS nesting. */
            if (r.cssRules) walk(r.cssRules, nextCond);
          }
        };
        walk(rules, null);
      }
      return out;
    },

    function breakpointDrift(root, doc) {
      const out = [];
      const declared = scaleValues('--bp-');
      if (!declared.size) return out;
      const list = [...declared].sort();
      const seen = new Set();
      for (const sheet of doc.styleSheets) {
        const href = sheet.href || '';
        if (!/\/ds\//.test(href)) continue;
        let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
        if (!rules) continue;
        const file = href.split('/').pop().split('?')[0];
        const walk = (rl) => {
          for (const r of rl) {
            if (r.media && r.conditionText) {
              (r.conditionText.match(/\d+(?:\.\d+)?px/g) || []).forEach(w => {
                if (declared.has(w)) return;
                const key = file + '|' + r.conditionText + '|' + w;
                if (seen.has(key)) return;
                seen.add(key);
                out.push({ severity: SEV.error,
                  rule: 'Foundations \u2192 Layout \u00b7 name the breakpoint',
                  message: file + ' has @media ' + r.conditionText + ', and ' + w + ' is not a ' +
                    'declared breakpoint. The system names every other value; a width that changes ' +
                    'the whole layout should not be the one number nobody wrote down. Declared: ' +
                    list.join(', ') + '. Add a --bp-* token on the root for it, or use one of those ' +
                    '\u2014 the query still has to spell the literal out, because a media query cannot ' +
                    'read var(), but this is what keeps the literal and the token in step.' });
              });
            }
            /* Handle the rule, THEN recurse — never `continue` past it. A plain
               CSSStyleRule carries an empty (truthy) `cssRules` under CSS nesting,
               so skipping on that test silently drops every style rule. See the
               long note above cssClasses(). */
            if (r.cssRules) walk(r.cssRules);
          }
        };
        walk(rules);
      }
      return out;
    },

    /* —— WHAT USED TO BE HERE, and why it is not ——
       A second icon check ran in this slot, pairing the size with an arithmetic
       line-weight compensation: --icon-line-fix == viewBoxWidth / fontSize − 1,
       because the art was expanded outlines carrying a baked 1-unit line that
       could be thickened by stroking it in its own colour but never thinned.
       Lucide's open stroke paths removed the premise — the line is a property
       now, not a shape — and the arithmetic went with it.

       TWO THINGS FROM IT ARE STILL TRUE and live on in iconScale below, because
       they were never about the compensation:

       MEASURE THE RENDERED BOX, NOT font-size. Those are the same number almost
       everywhere, since .ms is sized in em — and they come apart the moment a
       rule sets width/height instead. .sb-group-h .chev does exactly that. A
       first cut keyed on font-size and reported all five of them: the same class
       of error the check exists to catch, made by the checker.

       KEYED ON THE ELEMENT, NEVER ON A COMPONENT LIST. A rule can hand a glyph a
       perfectly legal 12 together with the weight that belongs to 16, which is
       what .toast button.x, .thumb > button.x, .bar button.x and .crumbs .sep all
       did until v135. Nothing depends on which component asked for the size, so
       nothing consults a roster of components. */

    /* —— Foundation: the icon ladder, and the 12px rung is a closed list ——
       THREE INVARIANTS, and they replaced an arithmetic that no longer exists.
       The art is Lucide's open stroke paths on a 24-unit master, so the LINE IS A
       PROPERTY: .ms sets stroke-width from --icon-stroke with vector-effect:
       non-scaling-stroke, and the value is an OPTICAL LADDER — 1px at 12, 1.25 at
       16, 1.5 at 20 and 24. It is not one width and not one proportion, so the
       rung and the stroke have to be set together and the check reads the
       RENDERED pair. The old --icon-line-fix compensation — 31 literals holding a
       baked 1px line together below 20px — is gone with the art that needed it.

       WHAT IT CHECKS NOW. First, that a glyph is drawn at one of the four steps.
       Second, that 12px is only ever an ALLOWLISTED glyph: 12 is not a size anyone
       may reach for, it is a rung for marks bounded by the thing they sit in, and
       only for shapes simple enough to survive it. Measured across 1,818 rendered
       icons the system draws just three at 12px — close, chevron_right, arrow_down
       — while a detailed glyph reaches 46% ink coverage there against close's 19%.
       Third, that the rendered stroke is the token its rung declares, and fourth
       that the mechanism is in force at all: a missing vector-effect is invisible
       until you measure, because it paints half the value at 12px and looks
       merely "thin" rather than broken.

       THE GLYPH IS IDENTIFIED BY FINGERPRINT, since the markup carries no name —
       QIC emits a bare <svg class="ms" viewBox>. Path `d` plus `transform` per
       DRAWABLE — circle and line included, since Lucide builds many glyphs from
       them — resolves all 166 through the DOM; see chevronMeaning for why the
       cheaper keys do not.

       data-audit-skip is honoured, because a "Don't" demo that deliberately shows
       a wrong size is the one thing here that is not a defect. */
    function iconScale(root) {
      const out = [];
      const STEPS = [12, 16, 20, 24];
      const LADDER = '--size-icon-sm 16 · md 20 (default) · lg 24, with 12 a closed exception';
      const XS = new Set((typeof window !== 'undefined' && window.QICONS_XS) || []);
      const nameOf = iconNameOf;

      within(root, '.ms').forEach(el => {
        if (el.closest('[data-audit-skip]')) return;
        const cs = getComputedStyle(el);
        /* THE LAYOUT WIDTH, NOT THE BOUNDING BOX. getBoundingClientRect returns the
           axis-aligned box of the element AFTER transforms, so a rotating glyph
           reports its diagonal: the storybook's disclosure chevron animates a
           rotate() and measured 17.2, 21.9 and 22.6 against a computed 16 — 16 × √2
           is 22.6 exactly. Three "off the scale" errors, every one of them the
           checker watching an animation rather than a defect. Computed width is the
           used layout size and ignores transforms. */
        const box = parseFloat(cs.width);
        if (!box || !isFinite(box)) return;      /* not rendered — says nothing */
        const px = Math.round(box);
        const where = () => originPath(el);

        if (STEPS.indexOf(px) === -1) {
          out.push({ severity: SEV.error, el,
            rule: 'Foundations → Icons · the scale is the whole rule',
            message: 'ICON SIZE OFF THE SCALE. ' + where() + ' draws its glyph at ' + box.toFixed(1) +
              'px' + (Math.abs(box - parseFloat(cs.fontSize)) < 0.5 ? '' :
                ' (its box is ' + box.toFixed(1) + 'px while its font-size is ' + cs.fontSize +
                ' — .ms sizes in em, so those disagreeing means a rule set one and left the other behind)') +
              '. Valid sizes: ' + LADDER + ' — and nothing else, in product markup or in a ' +
              'component’s own rule.' });
          return;
        }

        if (px === 12 && XS.size) {
          const n = nameOf(el);
          if (n && !XS.has(n)) {
            out.push({ severity: SEV.error, el,
              rule: 'Foundations → Icons · 12px is a closed list',
              message: '"' + n + '" is drawn at 12px, and 12 is not a general size. It is the rung ' +
                'for marks BOUNDED BY the thing they sit in — a pill, banner, toast or thumbnail ' +
                'dismiss, a grid sort arrow, a breadcrumb chevron — and only for shapes simple ' +
                'enough to survive it: a detailed glyph reaches about 46% ink coverage at 12px ' +
                'against close’s 19%. Allowed: ' + [...XS].sort().join(', ') + '. Use 16 (compact), ' +
                '20 (default) or 24 (larger and mobile), or drop the glyph — a container too small ' +
                'for 16px is a container that should not carry one.' });
          }
        }

        /* THE STROKE IS CHECKED AGAINST THE RENDERED SIZE, not against a
           declaration. Quince's ladder is optical — 1px at 12, 1.25 at 16, 1.5 at
           20 and 24 — so size and stroke are ONE decision, and the failure worth
           catching is them drifting apart: a rule that moves a glyph to a different
           rung without moving --icon-stroke leaves a 1.25px line on a 20px icon,
           which looks like nothing and is wrong everywhere it appears. Reading the
           pair as rendered catches it whatever caused it, including a cascade
           collision no declaration would reveal. */
        const EXPECT = { 12: 'xs', 16: 'sm', 20: 'md', 24: 'lg' };
        if (!el.classList.contains('fill')) {
          const rung = EXPECT[px];
          const want = parseFloat(getComputedStyle(document.documentElement)
            .getPropertyValue('--icon-stroke-' + rung));
          const sw = parseFloat(cs.strokeWidth);
          if (isFinite(want) && isFinite(sw) && Math.abs(sw - want) > 0.01) {
            out.push({ severity: SEV.error, el,
              rule: 'Foundations → Icons · stroke follows the rung',
              message: where() + ' draws at ' + px + 'px with a ' + cs.strokeWidth + ' stroke, ' +
                'where the ' + rung + ' rung is ' + want + 'px. Size and stroke are one decision — ' +
                'the ladder is optical rather than proportional, so --icon-stroke has to move ' +
                'wherever font-size does. Set --icon-stroke: var(--icon-stroke-' + rung + ') in ' +
                'the same rule that sets the size.' });
          }
        }
        /* vector-effect is what makes the token mean rendered pixels. Without it the
           stroke scales with the viewBox and a 12px glyph paints half its token —
           which reads as "thin" rather than as broken, so nothing else would catch it. */
        const drawable = el.querySelector('path, circle, rect, line, polyline, polygon, ellipse');
        if (drawable && !el.classList.contains('fill') &&
            getComputedStyle(drawable).vectorEffect !== 'non-scaling-stroke') {
          out.push({ severity: SEV.error, el,
            rule: 'Foundations → Icons · the stroke is in rendered pixels',
            message: where() + ' has a drawable without vector-effect: non-scaling-stroke, so its ' +
              'stroke scales with the viewBox and the --icon-stroke token stops meaning rendered ' +
              'pixels — a 12px glyph paints half its value. vector-effect is NOT inherited, so ' +
              'setting it on the <svg> does nothing; .ms > * is what delivers it.' });
        }
      });
      return out;
    },

    function navItemLabel(root) {
      const out = [];
      within(root, '.nav-item').forEach(el => {
        if (el.querySelector('.lbl')) return;
        /* Only in a vertical nav. The two rules that make .lbl load-bearing are
           truncation in a fixed-height row and display:none in the collapsed
           rail — a .nav-bar item is shrink-to-fit and collapse applies to the
           panel, never the bar, so the wrapper buys it nothing and requiring it
           would report the documented top-nav pattern as a defect. */
        if (el.closest('.nav-bar')) return;
        const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
        if (!hasText) return;
        out.push({ severity: SEV.error, rule: 'Components \u2192 Navigation \u00b7 Label', message: 'Destination name is a bare text node. Wrap it in .lbl \u2014 the truncation rule and the collapse rule both hang off that class, so without it a long name wraps out of its fixed-height row and it cannot be hidden in the glyph rail.', el: el });
      });
      return out;
    },

    /* A grid needs its surface: the table cannot carry a radius while
       border-collapse is on, and the surface is also the scroll container. */
    function gridSurface(root) {
      const out = [];
      within(root, 'table.data-grid').forEach(el => {
        if (el.closest('.data-grid-surface')) return;
        out.push({ severity: SEV.error, rule: 'Components \u2192 Data grid \u00b7 Surface', message: '.data-grid is not inside a .data-grid-surface. The surface carries the elevation, the radius and the horizontal scroll; the table cannot, because border-collapse and a radius do not coexist.', el: el });
      });
      return out;
    },

    /* A field without a label is the accessibility failure the system
       states first, and helper text does not substitute. */
    function fieldLabel(root) {
      const out = [];
      within(root, '.field').forEach(el => {
        if (el.querySelector('label')) return;
        if (!el.querySelector('.control, .select, input, textarea')) return;
        out.push({ severity: SEV.error, rule: 'Components \u2192 Input \u00b7 a11y', message: '.field has a control but no <label>. A placeholder is not a label \u2014 it disappears on the first keystroke.', el: el });
      });
      return out;
    },

    /* .control IS the input box \u2014 it draws the border, the radius and the focus
       ring. .select draws its own. Nesting them gives a box inside a box, which
       reads as a dropdown sitting inside a text input. Wrap only bare
       <input>/<textarea>/affixes in .control; a .select, a .combobox or any
       self-bordered control goes straight into .field. */
    /* A class the CSS only ever styles on ONE element, used on another.
       `.x` is the case this exists for: every rule mentioning it is
       `button.x`, `.bar button.x`, `.thumb > button.x` … so a
       <svg class="ms x"> gets no disc, no 44px target, no hover and no focus
       ring, and is unfocusable, un-keyboardable and silent. Six code samples
       shipped exactly that, and nothing saw them — a bare svg is legal markup
       with a legal class.

       Only fires when NO rule styles the class bare. `.chip` has both `.chip`
       and `button.chip` rules, so a dismissible <span class="chip"> is correct
       and stays quiet; `.checkbox` likewise, since a decorative box inside a
       .opt label is a span on purpose. The rule therefore says nothing about
       taste — it says the CSS you are asking for does not exist for this
       element. */
    function elementQualifiedClass(root, doc) {
      const out = [];
      const bare = new Set();      // classes with at least one element-agnostic rule
      const tagged = new Map();    // class -> Set(tagName) it is qualified with
      let readable = 0;
      for (const sheet of doc.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
        if (!rules) continue;
        readable++;
        for (const rule of rules) {
          if (!rule.selectorText) continue;
          for (const part of rule.selectorText.split(',')) {
            /* last compound of the selector — the element actually matched */
            const last = part.trim().split(/[\s>+~]+/).pop() || '';
            const m = last.match(/^([a-z][a-z0-9]*)?((?:\.[-_a-zA-Z][-_a-zA-Z0-9]*)+)/);
            if (!m || !m[2]) continue;
            const tag = m[1];
            for (const cls of m[2].slice(1).split('.')) {
              if (!cls) continue;
              if (tag) { if (!tagged.has(cls)) tagged.set(cls, new Set()); tagged.get(cls).add(tag); }
              else bare.add(cls);
            }
          }
        }
      }
      if (!readable) return out;

      within(root, '[class]').forEach(el => {
        const tag = el.tagName.toLowerCase();
        for (const cls of el.classList) {
          if (bare.has(cls)) continue;
          const tags = tagged.get(cls);
          if (!tags || tags.has(tag)) continue;
          out.push({
            severity: SEV.error,
            rule: 'CSS · class is element-qualified',
            message: 'Class "' + cls + '" is only ever styled on <' + [...tags].join('>, <') +
              '> in the CSS, but this is a <' + tag + '>. It gets none of that styling — and where the element is the control (.x, .checkbox in a grid), a non-button is also unfocusable, un-keyboardable and silent.',
            el: el
          });
        }
      });
      return out;
    },

    function controlNesting(root) {
      const out = [];
      within(root, '.control > .select, .control > .control, .control > .combobox').forEach(el => {
        out.push({ severity: SEV.error, rule: 'Components \u2192 Input \u00b7 Control', message: 'A self-bordered control (' + (el.className.split(/\s+/)[0] || 'control') + ') inside a .control. .control is the input box itself, so this draws a border inside a border and reads as a dropdown nested in a text field. Put it directly in .field.', el: el });
      });
      return out;
    },

    /* A brand block declares only LIGHT values; dark lives in
       [data-brand][data-mode="dark"]. So data-brand alone on a subtree re-applies
       that brand's light tokens inside a dark page — light foregrounds on dark
       fills, which is a contrast failure that only appears in one mode and so
       never shows up in a light-mode review. The two attributes travel together. */
    function brandScopeMode(root) {
      const out = [];
      within(root, '[data-brand]:not([data-mode])').forEach(el => {
        out.push({ severity: SEV.error, rule: 'Themes \u2192 Scope \u00b7 mode', message: 'data-brand="' + el.getAttribute('data-brand') + '" with no data-mode. A brand block declares only its light values, so this subtree re-applies light tokens even when the page is dark \u2014 light foregrounds land on dark fills. Pin data-mode, or inherit the page\u2019s.', el: el });
      });
      return out;
    },

    /* The base that everything inherits. A page can load every stylesheet in the
       system and still render its uninherited text in 16px Times, because the
       foundation used to declare the type tokens without applying them to an
       element. Checked on the running page, since a base is only ever really
       resolved by the cascade. */
    function documentBase(root) {
      const out = [];
      const body = document.body;
      if (!body) return out;
      const cs = getComputedStyle(body);
      const tokenFam = getComputedStyle(document.documentElement).getPropertyValue('--font-family-sans').trim();
      const first = s => (s.split(',')[0] || '').replace(/["']/g, '').trim().toLowerCase();
      if (tokenFam && first(cs.fontFamily) !== first(tokenFam)) {
        out.push({ severity: SEV.error, rule: 'Foundations \u2192 Typography \u00b7 document base', message: 'body renders in ' + first(cs.fontFamily) + ', not the system face (' + first(tokenFam) + '). Every string a component does not style itself \u2014 grid cells, chip and badge labels, menu rows, drawer copy \u2014 inherits this. Load foundation.css, which carries the base.', el: body });
      }
      if (Math.round(parseFloat(cs.fontSize)) === 16 && first(cs.fontFamily) !== first(tokenFam)) {
        out.push({ severity: SEV.error, rule: 'Foundations \u2192 Typography \u00b7 document base', message: 'body is at the browser default 16px. The system base is --type-body-md-size (14).', el: body });
      }
      if (cs.boxSizing !== 'border-box') {
        out.push({ severity: SEV.error, rule: 'Foundations \u2192 Layout \u00b7 document base', message: 'body is content-box. .control and .select are sized by height plus padding, so a full-width control overflows its container. The base in foundation.css sets border-box.', el: body });
      }
      return out;
    },

    /* The specific misuse this rule exists for: a Banner pressed into service as a
       selection bar. Structurally it passes every other check \u2014 correct tone class,
       ghost action, no link \u2014 and it is still the wrong component, because a
       Banner's whole use list is persistent STATUS about the content and a
       selection is not status: nothing happened to the data, the user clicked some
       rows. The tell is a count of selected things in the body. */
    function bannerAsSelectionBar(root) {
      const out = [];
      within(root, '.bar').forEach(el => {
        const txt = [...el.querySelectorAll('*')].concat([el]).reduce((s, n) =>
          s + ' ' + [...n.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent).join(' '), '').toLowerCase();
        if (!/\d[\d,]*\s+\S*\s*selected|clear selection/.test(txt)) return;
        out.push({ severity: SEV.error, rule: 'Patterns \u2192 Filter & sort \u00b7 Selection', message: 'A selection count in a Banner. Banner is persistent status about the content \u2014 a delay, a validation summary, a paused capability \u2014 and its anatomy allows one ghost action. Selection is not status. Use .sel-bar instead \u2014 a raised bar floating over the content, with .cnt, Clear selection, and one Bulk actions menu; the toolbar stays live.', el: el });
      });
      return out;
    },

    /* One number in two places is a number that can disagree with itself. The
       pager's "1\u201320 of 84" already states how many the filter left, so a count
       above the grid is the same fact a second time.

       .pager-info, NOT .pager-bar, and the difference is the whole check. The
       duplicate is the RANGE READOUT, not the pager: a screen may put its count
       above the collection — that is where a caption belongs — and keep the
       paging controls under it, and then the number appears exactly once. Testing
       for .pager-bar flagged that arrangement as a duplicate of a number the bar
       no longer carried, which is this check contradicting its own first
       sentence. It still errors on the real fault, a .filter-meta above the grid
       and a .pager-info below it saying the same thing. */
    function duplicateResultCount(root) {
      const out = [];
      within(root, '.filter-meta').forEach(el => {
        const scope = el.closest('.filter-bar') && el.closest('.filter-bar').parentElement || root;
        if (!scope.querySelector('.pager-info')) return;
        out.push({ severity: SEV.error, rule: 'Patterns \u2192 Filter & sort \u00b7 Count', message: 'A result count above a grid that has a pager below it. \u201c1\u201320 of 84\u201d already says the filter left 84 \u2014 drop .filter-meta and let the pager carry it.', el: el });
      });
      return out;
    },

    /* ── THE TWO WAYS THIS BAR LOSES A CONTROL BELOW THE TURN ──────────────────
       Both are the same shape of fault: CSS hides something at a width, and
       whether the thing it does is still REACHABLE depends on markup CSS cannot
       supply. A hidden control with a home is a composition; a hidden control
       with no home is a feature the phone does not have.

       FACETS FIRST. Below the turn every .select in .fb-filters is display: none,
       because a select costs a whole row to state one criterion at that width.
       More filters is where those values are supposed to go — it exists to carry
       named values past the one the bar shows — so a bar whose facets disappear
       and that carries NO More filters trigger has removed a filter on mobile and
       said nothing. The trigger must carry a glyph, because the CSS that collapses
       it to an icon is gated on :has(> .ms) and a label-only trigger collapses to
       a blank box.

       What this cannot check is the other half: that the hidden facet is actually
       INSIDE the More filters surface and counted in its .ct. That surface is a
       popover the consumer opens, usually not in the DOM at rest. The contract
       states it; only a human or a test that opens the popover can confirm it. */
    function hiddenFacetNeedsMoreFilters(root) {
      const out = [];
      within(root, '.filter-bar .fb-filters').forEach(g => {
        const facets = [...g.children].filter(c =>
          c.classList.contains('select') ||
          (c.classList.contains('control') && !c.classList.contains('search')));
        if (!facets.length) return;
        const trigger = [...g.children].find(c =>
          c.classList.contains('btn') && c.querySelector('.ms'));
        if (trigger) return;
        out.push({ severity: SEV.error, el: g,
          rule: 'Patterns \u2192 Filter & sort \u00b7 Facets',
          message: 'Facet controls in .fb-filters with no More filters trigger beside them. Below the turn every .select here is hidden \u2014 one criterion is not worth a row on a phone \u2014 and More filters is where those values go. With no trigger to hold them the filter simply does not exist below 768px. Add a .btn carrying a glyph (the collapse to an icon is gated on it) whose surface holds every facet the bar hides, and count them in its .ct.' });
      });
      return out;
    },

    /* AND THE COLLECTION'S ACTIONS. .fb-actions is hidden below the turn only
       where the page header carries an .ovf to hand them to, so the layout
       degrades safely on its own \u2014 a bar with no overflow keeps its actions and
       stays a two-row bar. This reports that state rather than letting it ship,
       because two rows of chrome above the first record is the thing the narrow
       composition exists to remove.

       GATED ON A PAGE HEADER BEING PRESENT. Half the bars in this library are
       fragment specimens with no .page-hd at all, and a fragment has no header to
       put an overflow in \u2014 there is nothing to fix there and nothing to report. */
    function barActionsNeedOverflow(root) {
      const out = [];
      within(root, '.filter-bar .fb-actions').forEach(a => {
        if (!a.querySelector('.btn, .lnk, button, a')) return;
        const bar = a.closest('.filter-bar');
        const scope = (bar && bar.parentElement) || root;
        const hd = scope.querySelector('.page-hd');
        if (!hd) return;
        if (hd.querySelector(':scope > .row > .ovf')) return;
        out.push({ severity: SEV.error, el: a,
          rule: 'Patterns \u2192 Filter & sort \u00b7 Actions',
          message: 'A filter strip with actions on a page whose header has no .ovf. Below the turn the strip has no room for a trailing action group, and the page header\u2019s overflow is where those actions go \u2014 one more_vertical trigger beside the title. Without it the actions stay in the strip and the phone reads two rows of chrome before the first record. Add <div class="ovf"> to .page-hd > .row carrying the same actions as a menu.' });
      });
      return out;
    },

    /* A bar picks one rung. .select had a .sm variant and .control did not, so the
       usual outcome was a 28px facet select beside a 36px search field with no way
       to align them \u2014 the asymmetry, not the markup, was the bug. Chips are exempt:
       --size-control-sm is baked into the component.

       ONLY THREE COMPONENTS HAVE A SMALL RUNG as of v170 \u2014 .btn, .select and
       .control \u2014 so a bar built from anything else runs at the default rung and
       there is nothing to mix. .search.sm was retired outright: a search is where
       people type, and a bar holding one runs default. It is dropped from the count
       below rather than left in as a selector that can no longer match, because a
       dead selector reads as coverage. */
    function mixedControlRungs(root) {
      const out = [];
      within(root, '.filter-bar, .toolbar').forEach(bar => {
        const small = bar.querySelectorAll('.select.sm, .control.sm').length;
        const large = [...bar.querySelectorAll('.select, .control')].filter(el => !el.classList.contains('sm')).length;
        if (!small || !large) return;
        out.push({ severity: SEV.error, rule: 'Patterns \u2192 Filter & sort \u00b7 Density', message: 'Two control rungs in one bar (' + small + ' small, ' + large + ' default). Every bordered control in a bar takes the same rung \u2014 .control + .select, or .control.sm + .select.sm \u2014 or a 28px select ends up beside a 36px field. Chips are the exception.', el: bar });
      });
      return out;
    },

    /* Two ways to order the same rows is two places to look for the current order,
       and two places it can disagree with itself. The header is where people
       already reach, so a grid with sortable headers takes no sort control in its
       toolbar; the menu is for collections with no headers to click. */
    function duplicateSortControl(root) {
      const out = [];
      within(root, '.filter-bar').forEach(bar => {
        const trigger = [...bar.querySelectorAll('.btn, .select')].find(b => /^sort\b/i.test((b.textContent || '').trim()));
        if (!trigger) return;
        const scope = bar.parentElement || root;
        if (!scope.querySelector('.data-grid th > button.sort')) return;
        out.push({ severity: SEV.error, rule: 'Patterns \u2192 Filter & sort \u00b7 Sort', message: 'A sort control in the toolbar of a grid whose headers already sort. The header IS the sort \u2014 a second control beside it is a second answer to one question, and two places the current order can disagree. The toolbar menu is for a collection with no headers to click.', el: trigger });
      });
      return out;
    },

    /* A TEXTAREA IN A BARE .control RENDERS BROKEN AND NOTHING SAID SO. The base
       control declares a fixed height off the control rung and centres its single
       child, both of which are right for an input and wrong for a box you type
       paragraphs into: the textarea overflows the border, and its placeholder
       paints ABOVE the box, on top of the field's own label. .control.textarea is
       the variant that releases the height, stretches the child and gives it
       --textarea-min-height — it is not decoration, it is the half of the
       component that makes the element work.
       Objective and cheap to state, and it shipped through a full audit in a
       Phase 8 specimen because no check looked: the classes were all real, the
       element was legal, and the only tell was the picture. */
    /* .lnk.action IS SCOPED, AND THE SCOPE IS THE WHOLE ARGUMENT. Colour carries
       its affordance, which the base link deliberately refuses to do — a page of
       accent link text pulls the eye through prose, and hue alone does not survive
       greyscale. It holds only where POSITION is the second cue: a field's label
       row, a grid's action cell, a section header's action group. Outside those it
       is the exact defect --color-fg-link was made neutral to avoid, so the name
       is not left to keep people honest. */
    function actionLinkScope(root) {
      const out = [];
      const SLOT = '.field > .lbl-row > .acts, .control > .acts, .data-grid td.act, .data-grid th.act,' +
        ' .section > .hd .acts, .card-h .act, .page-hd .acts, .filter-bar .fb-actions';
      within(root, '.lnk.action').forEach(el => {
        if (el.closest(SLOT)) return;
        out.push({ severity: SEV.error, rule: 'Components \u2192 Link \u00b7 Action',
          message: 'A .lnk.action outside an action slot. This variant drops the underline and lets the accent carry the affordance, which only works where position already says "this acts" \u2014 a field label row, a grid action cell, a section header. Inline in prose it is accent-coloured link text with no greyscale signal: use a plain .lnk there.',
          el: el });
      });
      return out;
    },

    /* THE LABEL ROW IS STACKED-ONLY, and .form.labels would place it wrong rather
       than refuse it: the label lands in a 168px track and .acts has nowhere to
       go. Three layouts could resolve it and none is chosen, so this errors
       instead of shipping a silent mis-placement. */
    function labelRowNeedsStacked(root) {
      const out = [];
      within(root, '.form.labels .field > .lbl-row').forEach(el => {
        out.push({ severity: SEV.error, rule: 'Components \u2192 Input \u00b7 Field label row',
          message: 'A .lbl-row inside .form.labels. The label row is stacked-only: labels-left puts the label in a --form-label-col track (168px by default) with no room for the actions beside it, and no labels-left geometry has been chosen. Use the stacked form for fields that carry a label action.',
          el: el });
      });
      return out;
    },

    function textareaNeedsVariant(root) {
      const out = [];
      within(root, '.control:not(.textarea) textarea').forEach(el => {
        out.push({ severity: SEV.error, rule: 'Components \u2192 Input \u00b7 Textarea',
          message: 'A <textarea> inside a .control that is not .control.textarea. The base control is a fixed-height row built for an input, so the textarea overflows its border and the placeholder paints above the box on top of the label. Add the textarea variant.',
          el: el });
      });
      return out;
    },

    /* A COUNT OF ZERO IS NOT A COUNT. The pill exists to say "there are things in
       here"; at zero there is nothing to say and the badge is a mark the eye
       stops on for no reason. Empty is worse than "0" — .ct carries a
       min-width, so an empty one renders as a blank circle that reads as a
       loading state. Render the trigger with no .ct at all until the number is
       at least one. */
    function zeroCount(root) {
      const out = [];
      /* .ct IS TWO COMPONENTS SHARING A NAME, and only one of them is a count.
         The pill is defined by the CSS as `.tab .ct`, `.nav-item .ct` and
         `.btn .ct`; `.shell > .ct` is the page's CONTENT REGION, and an app-shell
         specimen with an empty <main class="ct"> read as an empty count pill —
         twice, in the one mobile-header frame that ships no content. Scoped to
         the three parents the stylesheet actually defines, so the scope cannot
         drift from the component. */
      within(root, ':is(.tab, .nav-item, .btn) .ct').forEach(el => {
        const t = el.textContent.trim();
        if (t !== '' && t !== '0') return;
        /* the collapsed rail's dot is a .ct with its number hidden on purpose —
           font-size:0 and transparent ink. It is an indicator, not a number. */
        if (parseFloat(getComputedStyle(el).fontSize) === 0) return;
        out.push({ severity: SEV.error, rule: 'Components \u2192 Count \u00b7 zero is not a count', message: t === '' ? 'An empty count pill. .ct carries a min-width, so an empty one renders as a blank circle and reads as something still loading \u2014 omit the element entirely when there is nothing to count.' : 'A count showing "0". The pill says "there is something in here"; at zero there is nothing to say and the badge is a mark the eye stops on for no reason. Omit the .ct until the number is at least one.', el: el });
      });
      return out;
    },

    /* THE APPLIED ROW IS WHAT THE PANEL SAYS, and the presence of a select
       beside the trigger no longer disqualifies it. An earlier version of this
       rule errored on any .filter-applied under a bar carrying a select, on the
       argument that the select states its own cut — true of the SELECT, and it
       says nothing about the criteria set inside More filters, which state
       nothing at all. A trigger reading "2" tells the user how many things are
       excluding their records and refuses to say which.
       So what is checked now is the other direction: a trigger carrying a count
       and NO applied row under it, which is the state that sends the user into
       the panel to find out what is in there. */
    function panelCriteriaUnnamed(root) {
      const out = [];
      within(root, '.filter-bar').forEach(el => {
        const ct = el.querySelector('.fb-filters .btn .ct');
        if (!ct) return;
        const n = parseInt(ct.textContent.trim(), 10);
        if (!n) return;
        /* THE COUNT EQUALS THE TOKENS. Exactly, in both directions, and with no
           viewport logic — which is what settling the convention bought.
           The badge counts criteria whose CONTROL is not on the toolbar, the
           consumer writes the panel's own number, and the contract requires a
           removable token for every criterion set inside that panel. So the two
           numbers describe the same set and must agree.
           A facet does not appear in either: visible, it states itself and takes
           no token and no count; hidden by the turn, the SYSTEM draws the mark
           from the select's own state rather than the consumer adding to a number
           that would then change with the viewport. That is the whole reason this
           check needs no width and no computed style — the first version of it
           subtracted every set facet and would have passed a desktop bar reading
           "2" with one token under it. */
        const tokens = el.querySelectorAll('.filter-applied .token').length;
        if (tokens === n) return;
        out.push({ severity: SEV.error, rule: 'Patterns \u2192 Filter & sort \u00b7 Applied',
          message: tokens < n
            ? 'More filters carries a count of ' + n + ' and the applied row names ' + tokens + '. A count says how many criteria are excluding the user\u2019s records and refuses to say which, so the ' + (n - tokens) + ' unnamed one(s) can only be found by opening the panel. Every criterion set inside it takes a removable .token in .filter-applied.'
            : 'The applied row names ' + tokens + ' criteria and More filters counts ' + n + '. The count is what the PANEL holds, so the two describe the same set and must agree \u2014 a lower count usually means a facet select was folded into the number, which the system draws as a dot below the turn instead.',
          el: el });
      });
      return out;
    },

    /* A token that repeats a facet select IS still a duplicate — the select
       reads "Origin FC: WEST-1" on its own, so a token saying the same thing is
       two places to read one criterion and two places to remove it. */
    function duplicateAppliedChips(root) {
      const out = [];
      within(root, '.filter-bar .filter-applied .token').forEach(el => {
        const key = (el.querySelector('.key')?.textContent || '').replace(/:\s*$/, '').trim().toLowerCase();
        if (!key) return;
        const bar = el.closest('.filter-bar');
        const stated = [...bar.querySelectorAll('.fb-controls .select .val')]
          .some(v => v.textContent.trim().toLowerCase().startsWith(key));
        if (!stated) return;
        out.push({ severity: SEV.error, rule: 'Patterns \u2192 Filter & sort \u00b7 Applied', message: 'A token repeating a criterion the row already states \u2014 the facet select for \u201c' + key + '\u201d names its own value. The applied row is for what the PANEL holds; a select speaks for itself.', el: el });
      });
      return out;
    },

    /* The selection bar floats over the content and the toolbar stays live. The
       earlier shape swapped the toolbar in place, which cost the user their filters
       at the exact moment they were working through a filtered list. */
    function selectionBar(root) {
      const out = [];
      within(root, '.filter-bar.selecting').forEach(el => {
        out.push({ severity: SEV.error, rule: 'Patterns \u2192 Filter & sort \u00b7 Selection', message: 'A toolbar swapped into selection mode. Selection is a floating .sel-bar over the content \u2014 the toolbar keeps its filters, its search and its count, because narrowing a list is the act most likely to interrupt selecting from it.', el: el });
      });
      within(root, '.sel-bar .btn--primary, .sel-bar .btn--secondary, .sel-bar .btn--danger, .sel-bar .btn--danger-secondary').forEach(el => {
        out.push({ severity: SEV.error, rule: 'Patterns \u2192 Filter & sort \u00b7 Selection', message: 'A filled or outlined button in the selection bar. Every bulk action collapses into ONE ghost menu at the trailing edge; the destructive option is a .menu-item.danger inside it.', el: el });
      });
      return out;
    },

    /* Icon-only controls carry their meaning nowhere else. */
    function iconOnlyName(root) {
      const out = [];
      within(root, '.btn.icon, button.x, .col-filter').forEach(el => {
        const named = el.getAttribute('aria-label') || el.getAttribute('title') || (el.getAttribute('aria-labelledby') && 1) || (el.textContent || '').trim();
        if (named) return;
        out.push({ severity: SEV.error, rule: 'Components \u2192 Button \u00b7 a11y', message: 'Icon-only control with no accessible name. The glyph is aria-hidden, so an aria-label is the only thing carrying the meaning.', el: el });
      });
      return out;
    },

    /* A filter chip is a control and has to report its state. */
    function chipPressed(root) {
      const out = [];
      within(root, 'button.chip').forEach(el => {
        if (el.hasAttribute('aria-pressed')) return;
        if (el.querySelector('button.x')) return; /* removable token-style chip */
        out.push({ severity: SEV.warn, rule: 'Patterns \u2192 Filter & sort \u00b7 a11y', message: 'Filter chip without aria-pressed. It is the most-used control on a collection screen and its state has to be reportable, not just visible.', el: el });
      });
      return out;
    },

    /* A sortable header states its state in the DOM, not only in an arrow. */
    function sortAria(root) {
      const out = [];
      within(root, 'th').forEach(th => {
        const btn = th.querySelector('button.sort');
        if (!btn) return;
        const anySorted = th.closest('table') && th.closest('table').querySelector('th[aria-sort]');
        if (!anySorted) out.push({ severity: SEV.warn, rule: 'Components \u2192 Data grid \u00b7 a11y', message: 'Sortable headers present but no th carries aria-sort. The arrow is not the state; aria-sort is.', el: th });
      });
      return out.slice(0, 1);
    },

    /* —— Components: weight and hierarchy —— */
    /* One commit per screen. Two filled buttons is two most-likely next steps,
       which is none. A WARNING, not an error: this is the only check that
       reasons about a whole screen rather than one element, so it cannot tell a
       real second primary from a specimen gallery or two panes linted together. */
    function buttonWeights(root) {
      const out = [];
      /* Skip the storybook's own scaffolding. A specimen gallery shows every
         variant of a control side by side, which is 20 primaries and not a
         hierarchy problem — this is the one check that counts across a whole
         screen, so it is the one that cannot tell a gallery from a page. None of
         these classes exist on a product page, so nothing is lost there. */
      const isSpecimen = b => b.closest('.vframe, .voice, .vbox, .sb-canvas');
      /* AN INERT BUTTON IS NOT AN OFFER. A modal over a page leaves the page's
         own primary in the document and unreachable — the consumer marks the
         background inert, which is exactly what the nav-drawer contract already
         requires of it — so counting it produced "2 primary buttons on one
         screen" for the one composition where there is provably one. Visibility
         alone cannot see this: the page behind a scrim still has an
         offsetParent. */
      const offered = b => b.offsetParent !== null && !isSpecimen(b) && !b.closest('[inert]');
      const primaries = within(root, '.btn--primary').filter(offered);
      const secondaries = within(root, '.btn--secondary').filter(offered);
      if (primaries.length > 1) out.push({ severity: SEV.warn, rule: 'SKILL \u00b7 Button weight follows the row', message: primaries.length + ' primary buttons on one screen. One commit per screen \u2014 the rest drop to secondary, then ghost.', el: primaries[1] });
      if (secondaries.length > 1) out.push({ severity: SEV.warn, rule: 'SKILL \u00b7 Button weight follows the row', message: secondaries.length + ' secondary buttons on one screen. The secondary is the PAGE\u2019s runner-up, not a row\u2019s; past one, actions are ghosts.', el: secondaries[1] });
      return out;
    },

    /* A banner action is a ghost button. A box inside a tinted strip reads
       as a surface floating on a surface. */
    function bannerAction(root) {
      const out = [];
      within(root, '.bar .acts').forEach(acts => {
        acts.querySelectorAll('.btn--primary, .btn--secondary, .btn--danger, .lnk').forEach(el => {
          const isLink = el.classList.contains('lnk');
          out.push({ severity: SEV.error, rule: 'Components \u2192 Banner \u00b7 Action', message: isLink
            ? 'A link in a banner\u2019s action slot. The banner action is a ghost BUTTON \u2014 the link treatment was retired because it was the one underlined action in the system and taught that chrome takes links.'
            : 'A filled or outlined button in a banner. Only ghost: a box inside a tinted strip reads as a surface floating on a surface.', el: el });
        });
      });
      return out;
    },

    /* TWO DISMISSALS IN TWO PLACES FOR ONE JOB. A form modal has an x in its header, and
       that x IS the way out — a Cancel beside it duplicates the job and hands the far,
       wider button to the answer nobody came to give. Spend the footer on the commit:
       Save draft and Add vendor, not Cancel, Save draft and Add vendor.

       A CONFIRM DIALOG IS THE EXCEPTION, and the rule runs the OTHER WAY there: it must
       keep an explicit Cancel, because Cancel is the initial focus target and the cost of
       focus landing on the destructive answer is a deleted record. An x is not an answer to
       a question the dialog asked. So this fires on a form that HAS a Cancel and on a
       destructive confirm that LACKS one.

       Forms are told from confirms by what the body holds: controls, or prose.

       DELIBERATELY NOT CHECKED: a disclosure (prose, informational, no destructive commit).
       The contract forbids a redundant Cancel there too, but a prose body with a
       non-destructive commit is also the shape of a legitimate confirm — "Discard draft?"
       with a primary Discard — and there is no signal in the markup that separates them.
       Flagging it would cost false positives on the one case where a wrong answer is
       expensive, so it is left to review. */
    function modalDismissal(root) {
      const out = [];
      const DISMISS = /^(cancel|close|dismiss|never mind)$/i;
      within(root, '.modal').forEach(m => {
        const foot = m.querySelector('.modal-f');
        if (!foot) return;
        const btns = [...foot.querySelectorAll('.btn')];
        if (!btns.length) return;
        const dismisser = btns.find(b => DISMISS.test((b.textContent || '').trim()));
        const body = m.querySelector('.modal-b');
        const isForm = !!(body && body.querySelector('.field, .control, input, textarea, select, .select'));
        const hasX = !!m.querySelector('.modal-h .x');
        if (isForm && hasX && dismisser) {
          out.push({ severity: SEV.error, rule: 'Components \u2192 Modal \u00b7 Action',
            message: '"' + dismisser.textContent.trim() + '" in the footer of a FORM modal that already has a header x. Two dismissals in two places for one job, and the far one gets the wider button \u2014 let the x be the way out and spend the footer on the commit. A confirm dialog is the exception; a form is not.',
            el: dismisser });
        }
        const danger = btns.find(b => b.classList.contains('btn--danger'));
        if (!isForm && danger && !dismisser) {
          out.push({ severity: SEV.error, rule: 'Components \u2192 Modal \u00b7 Action',
            message: 'A confirm dialog with a destructive commit and no explicit Cancel. Cancel is the INITIAL FOCUS TARGET here: the cost of focus landing on the destructive answer is a deleted record, and the header x is not an answer to the question the dialog asked.',
            el: danger });
        }
      });
      return out;
    },

    /* A status column is a set of peers, so filling one invents a rank. */
    function solidBadgeInGrid(root) {
      const out = [];
      within(root, 'td .badge.solid, td .badge--solid').forEach(el => {
        out.push({ severity: SEV.error, rule: 'Components \u2192 Badge \u00b7 tone', message: 'Solid badge in a table cell. Solid is one-per-view emphasis; a status column is a set of peers, so filling one invents a rank the data does not have. Use the tinted tone.', el: el });
      });
      return out;
    },

    /* A DOT IS NEVER ALONE. v143 loosened the data-grid contract so a status cell
       may be a tinted badge OR a labelled dot — the dot form is the right answer in
       a dense table, where a column of pills outshouts the rows the grid is about.
       The one thing that loosening cannot be allowed to license is a bare dot:
       colour alone is not a status. Eight pixels of green means "good" only to
       someone who already knows the legend, and it means nothing at all to a
       screen reader or to anyone who cannot separate the hues.

       Checked on .sdot rather than on .sdot-row, because the failure is a dot that
       never got wrapped in the row that carries its word. Any non-empty text in the
       ancestor row satisfies it — the label does not have to be a particular
       element, only present. An aria-label on the dot counts too: that is a real
       accessible name, which is the thing being required. */
    function bareStatusDot(root) {
      const out = [];
      within(root, '.sdot').forEach(dot => {
        if (dot.getAttribute('aria-label') || dot.getAttribute('aria-labelledby')) return;
        const row = dot.closest('.sdot-row') || dot.parentElement;
        const text = row ? (row.textContent || '').trim() : '';
        if (text) return;
        out.push({ severity: SEV.error, rule: 'Components \u2192 Badge \u00b7 Status dot',
          message: 'A status dot with no label. A dot carries a tone, not a meaning \u2014 wrap it in .sdot-row with its word, or give it an accessible name. Colour alone is not a status, and it is nothing at all to a screen reader.',
          el: dot });
      });
      return out;
    },

    /* Every cell is one size and one tone: inside a grid the COLUMN says
       what a value is, so a cell never shrinks to say it. */
    function gridCellTone(root) {
      const out = [];
      const seen = new Set();
      /* .data-grid only. The rule is "every grid cell is one size and one tone";
         a plain documentation or layout table is not a data grid, and reading
         every td on the page reported those as violations. */
      within(root, '.data-grid td').forEach(td => {
        const cs = getComputedStyle(td);
        const px = Math.round(parseFloat(cs.fontSize));
        /* Read the token off the CELL, not the root. A brand layer declares
           --table-cell-size from [data-brand], so a themed sample scoped to a
           wrapper carries a different value than the document does — and this
           compared a Default cell (14) against a Spacious ROOT (16) and called
           it a defect. It only fired when the two happened to disagree, which
           is why it stayed hidden. Same root-vs-element-scope trap as the touch
           ladder in v91: a custom property belongs to where it resolves. */
        const base = Math.round(parseFloat(cs.getPropertyValue('--table-cell-size')) || px);
        if (px < base && !seen.has('size')) { seen.add('size'); out.push({ severity: SEV.warn, rule: 'SKILL \u00b7 every grid cell is one size and one tone', message: 'A cell renders at ' + px + 'px against a --table-cell-size of ' + base + 'px. Inside a grid the column says what a value is; the cell does not shrink to signal that it is metadata.', el: td }); }
      });
      return out;
    },

    /* A tab row that contains its own siblings is a filter wearing tabs. */
    function statusTabs(root) {
      const out = [];
      within(root, '.tabs').forEach(tabs => {
        const labels = [...tabs.querySelectorAll('.tab')].map(t => (t.textContent || '').trim().toLowerCase());
        if (labels.some(l => l === 'all' || l.startsWith('all '))) {
          out.push({ severity: SEV.warn, rule: 'Components \u2192 Tabs \u00b7 the containment test', message: 'A tab row with an "All" tab. The All is the tell: it contains the other tabs, so these are cuts of one collection, not peer views. Filters combine and tabs do not \u2014 use chips in the toolbar, with no All chip, because none selected already means all.', el: tabs });
        }
      });
      return out;
    },

    /* A collection surface needs a written empty state. */
    function emptyStatePrimary(root) {
      const out = [];
      const headerPrimary = root.querySelector('.page-hd .btn--primary');
      if (!headerPrimary) return out;
      within(root, '.empty .btn--primary').forEach(el => {
        out.push({ severity: SEV.warn, rule: 'Components \u2192 Empty state \u00b7 Action', message: 'Primary button in an empty state on a page whose header already has one. The empty-state lead is SECONDARY \u2014 two filled buttons is two recommended paths, and it is often the same button twice.', el: el });
      });
      return out;
    },

    /* Underlines belong to Link alone; every other component clears them. */
    function linkInActionRow(root) {
      const out = [];
      within(root, '.acts .lnk, .modal-f .lnk, .drawer-f .lnk, .card-f .lnk').forEach(el => {
        if (el.closest('.bar')) return; /* reported by bannerAction with its own message */
        if (el.closest('.toast')) return; /* the documented exception */
        /* The informational leading slot is the third exception, and it is the
           rule's own reasoning that admits it: the objection is that everything
           in an ACTION ROW acts on the current surface while a link navigates.
           A .note is not an action row — .drawer-f.spread reserves it for status,
           guidance and documentation links precisely BECAUSE they are not
           actions. A doc link is the content the slot exists to hold. */
        if (el.closest('.drawer-f > .note, .popover-f > .note')) return;
        /* .lnk.action IS THE FOURTH EXCEPTION, AND ONLY OUTSIDE A SURFACE FOOTER.
           This rule's objection is that a surface footer is a row of COMMITS, and
           a link among them breaks both the rhythm and the promise. A label row or
           a section header action group is not that row: its occupants are
           per-field and per-region utilities — Edit in English, Undo changes,
           Setup Variable Content — which is the same reasoning that already admits
           a documentation link to .drawer-f > .note. So .lnk.action passes in those
           slots and still errors in .modal-f, .drawer-f, .card-f and .popover-f,
           where the lightest actor remains a ghost button. */
        if (el.classList.contains('action')
            && !el.closest('.modal-f, .drawer-f, .card-f, .popover-f')) return;
        out.push({ severity: SEV.error, rule: 'Components \u2192 Link \u00b7 avoid', message: 'A link in an action row or a surface footer. Everything there acts on the current surface; the lightest of them is a ghost button. A link navigates.', el: el });
      });
      return out;
    },

    /* Page content laid straight onto the canvas. A .section carries no fill by
       design — it is a divider WITHIN a surface — so a section whose nearest
       painted background is the canvas is a group of content with nothing under
       it: no edge, no elevation, and a hairline doing a card's job. This is the
       single most common way a generated screen stops looking like the system,
       which is why it is mechanical rather than left to the eye. */
    function contentOnCanvas(root) {
      const out = [];
      const canvas = getComputedStyle(document.documentElement).getPropertyValue('--color-bg-canvas').trim();
      /* Resolve the nearest ancestor that actually paints, the way the eye does:
         a transparent parent is not the background the reader sees. */
      const painted = (el) => {
        let n = el.parentElement;
        while (n) {
          const bg = getComputedStyle(n).backgroundColor;
          if (bg && bg !== 'transparent' && !/^rgba\(0,\s*0,\s*0,\s*0\)$/.test(bg)) return { el: n, bg: bg };
          n = n.parentElement;
        }
        return null;
      };
      const toRgb = (v) => { const d = document.createElement('div'); d.style.color = v; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; };
      const canvasRgb = canvas ? toRgb(canvas) : null;
      within(root, '.section').forEach(sec => {
        if (sec.closest('.card, .modal, .drawer, .popover, .data-grid-surface, .nav-drawer')) return;
        const p = painted(sec);
        if (!p) return;
        if (canvasRgb && p.bg !== canvasRgb) return;
        out.push({ severity: SEV.error, rule: 'Patterns \u2192 Record page \u00b7 content sits on a surface', message: 'A .section is sitting directly on the canvas. .section is a divider WITHIN a surface and carries no fill of its own, so this region of content has nothing holding it. Wrap each region in a .card \u2014 the canvas is what shows BETWEEN objects, not a surface to put things on.', el: sec });
      });
      return out;
    },

    /* Off-scale spacing in the markup. The scale is the rhythm; a value
       between two rungs is how a ladder rots. */
    function offScaleSpacing(root) {
      const out = [];
      const scale = scaleValues('--space-');
      if (!scale.size) return out;
      const allowed = new Set([...scale].map(v => parseFloat(v)).filter(n => !isNaN(n)));
      allowed.add(0);
      const props = ['gap', 'padding', 'margin', 'row-gap', 'column-gap'];
      const seen = new Set();
      within(root, '[style]').forEach(el => {
        const s = el.getAttribute('style') || '';
        props.forEach(p => {
          const re = new RegExp('(?:^|;)\\s*(' + p + '[a-z-]*)\\s*:\\s*([^;]+)', 'g');
          let m;
          while ((m = re.exec(s)) !== null) {
            const prop = m[1];
            const decl = m[2];
            if (decl.includes('var(')) continue;
            (decl.match(/-?\d*\.?\d+px/g) || []).forEach(v => {
              const n = parseFloat(v);
              if (allowed.has(n) || seen.has(prop + v)) return;
              seen.add(prop + v);
              out.push({ severity: SEV.warn, rule: 'Foundations \u2192 Spacing \u00b7 the scale is the rhythm', message: prop + ': ' + v + ' is off the spacing scale. Use a --space-* token; a value between two rungs is how a ladder rots.', el: el });
            });
          }
        });
      });
      return out;
    },

    /* —— The browser's own chrome, worn by a control that forgot to dress ——
       A form element does not inherit type: a <button> falls back to the system
       font at about 13.3px whatever the body says, and to a 2px outset border if
       nothing else declares one. So a class written for a <span> or a <div> looks
       correct until somebody renders it as the button it should always have been,
       and then it arrives in the middle of a component wearing Arial and a bevel.

       This is not hypothetical: .cal-day and .cal-h .nav both shipped that way,
       and a sweep for the signature found the carousel arrows, the stepper and
       .select-as-a-button in three patterns. Every one was reported by a person
       looking at the screen, because nothing here was checking.

       TWO SIGNATURES, both cheap. An outset or inset border is the UA button
       bevel and nothing in this library draws one deliberately. And a font family
       that matches none of the three the tokens define is a family nobody chose —
       compared against the tokens rather than against "Inter", so a brand that
       reskins the face does not start failing. */
    function uaFormChrome(root, doc) {
      const out = [];
      const rootStyle = getComputedStyle(doc.documentElement);
      const norm = f => String(f).replace(/["']/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
      const known = new Set(['--font-family-sans', '--font-family-mono', '--font-family-brand']
        .map(t => rootStyle.getPropertyValue(t))
        .filter(Boolean).map(norm));
      if (!known.size) return out;   /* tokens unreadable — say nothing rather than everything */
      const seen = new Set();
      root.querySelectorAll('button, input:not([type=hidden]), select, textarea').forEach(el => {
        if (el.closest('[data-audit-skip]')) return;
        const cs = getComputedStyle(el);
        const cls = (el.className || el.tagName).toString().trim().slice(0, 40) || el.tagName;
        const bs = cs.borderTopStyle;
        if (bs === 'outset' || bs === 'inset') {
          const k = 'border|' + cls;
          if (!seen.has(k)) {
            seen.add(k);
            out.push({ severity: SEV.error, el,
              rule: 'Foundations \u2192 Type \u00b7 a control wears the UA chrome',
              message: '"' + cls + '" renders with a ' + bs + ' border \u2014 that is the browser\u2019s button ' +
                'bevel, not a border this system draws. The class was almost certainly written for a ' +
                '<span> or <div> and is now on a real <button>. Give it the narrow reset the row ' +
                'elements take in components.css: appearance, border, background, margin.' });
          }
        }
        if (!known.has(norm(cs.fontFamily))) {
          const k = 'font|' + cls;
          if (!seen.has(k)) {
            seen.add(k);
            out.push({ severity: SEV.error, el,
              rule: 'Foundations \u2192 Type \u00b7 a control wears the UA chrome',
              message: '"' + cls + '" renders in a family none of --font-family-sans / -mono / -brand ' +
                'define (' + cs.fontFamily.slice(0, 40) + '). A form element does not inherit type, so this ' +
                'is the UA default leaking through. The document base sets `font: inherit` on form ' +
                'elements \u2014 if this still fails, something is overriding it.' });
          }
        }
      });
      return out;
    },

    /* —— Foundation: a sticky element that can never engage ——
       THE FAILURE THIS CATCHES IS SILENT AND LOOKS CORRECT IN THE SOURCE.
       position: sticky pins against the nearest SCROLLPORT, not against the
       viewport and not against the region you had in mind — and any ancestor with
       overflow other than visible/clip becomes that scrollport. So an inner
       container that scrolls on the OTHER axis, or does not scroll at all,
       intercepts the stickiness and the element simply travels with the content.
       No error, no warning, nothing in the computed style to inspect: `position`
       still reads `sticky` and the offsets are still there.

       MEASURED IN THIS SYSTEM: a `th { position: sticky; top: 0 }` inside
       .data-grid-surface never pins, because that surface carries overflow: auto
       so a .columnar grid can scroll SIDEWAYS, which makes it the block-axis
       scrollport too — and its height is content-determined, so it never scrolls
       vertically. The page scroller above it (.shell > .ct) is what actually
       moves. Header scrolled away with the rows, exactly as if the declaration
       were absent.

       THE DISCRIMINATOR IS "CAN IT EVER SCROLL", NOT "IS IT SCROLLING". Short
       content in a properly constrained region also cannot scroll right now, and
       that is legitimate and temporary — a three-row grid is not a defect. The
       first version of this check asked instead whether some ancestor scroller
       was scrolling, and that fires on almost everything, because the PAGE is
       nearly always scrolling: a 400px region holding one row reported the same
       error as the trapped grid header. Useless as a discriminator.

       So it is measured by MUTATION: append a 2000px spacer and see what happens.
       A container constrained on that axis overflows (scrollHeight passes
       clientHeight) and keeps its size. An unconstrained one simply GROWS, its
       height being content-determined, and never overflows at all — which is
       exactly the state in which a sticky child can never pin. Synchronous,
       reverted before returning, and it answers the structural question rather
       than a question about today's content. Computed style cannot answer it:
       `height` reports the used pixel value whether it came from a declaration
       or from the content, so 'auto' never appears to be read.

       IT ALSO CHECKS THE RUNG, because --z-sticky existed for a long time with no
       sticky consumer at all and one bar wearing a literal 20 instead. A sticky
       element painting at the wrong rung is a different bug from one that never
       pins, and both are invisible until content is long enough to overlap. */
    function stickyEngages(root, doc) {
      const out = [];
      const zSticky = parseFloat(getComputedStyle(doc.documentElement)
        .getPropertyValue('--z-sticky')) || 100;
      const overflows = (el, axis) => axis === 'block'
        ? el.scrollHeight > el.clientHeight + 1
        : el.scrollWidth > el.clientWidth + 1;
      /* Can this container EVER scroll on this axis, or is its size handed to it
         by its own content? See the note above for why this is a mutation. */
      const canEverScroll = (el, axis) => {
        if (overflows(el, axis)) return true;
        const keepTop = el.scrollTop, keepLeft = el.scrollLeft;
        const spacer = doc.createElement('div');
        spacer.setAttribute('aria-hidden', 'true');
        spacer.style.cssText = 'flex: none; position: static; ' + (axis === 'block'
          ? 'block-size: 2000px; inline-size: 1px;'
          : 'inline-size: 2000px; block-size: 1px;');
        el.appendChild(spacer);
        const grew = overflows(el, axis);
        spacer.remove();
        el.scrollTop = keepTop; el.scrollLeft = keepLeft;
        return grew;
      };
      const isScrollport = (el, axis) => {
        const o = getComputedStyle(el);
        const v = axis === 'block' ? o.overflowY : o.overflowX;
        return v !== 'visible' && v !== 'clip';
      };
      [].slice.call(root.querySelectorAll('*')).forEach(function (el) {
        const cs = getComputedStyle(el);
        if (cs.position !== 'sticky') return;
        /* Which axis is it actually pinned on? An element with no resolved offset
           on either axis is sticky in name only, which is its own defect. */
        const block  = cs.top !== 'auto' || cs.bottom !== 'auto';
        const inline = cs.left !== 'auto' || cs.right !== 'auto';
        if (!block && !inline) {
          out.push({ severity: SEV.error, el,
            rule: 'Foundations → Layout · sticky needs an edge',
            message: 'position: sticky with no top, bottom, left or right, so there is no edge to ' +
                     'pin against and the element behaves exactly like position: relative. Sticky is ' +
                     'the only position value that does nothing at all without an offset.' });
          return;
        }
        ['block', 'inline'].forEach(function (axis) {
          if (axis === 'block' ? !block : !inline) return;
          /* The nearest scrollport is the ONLY one that matters — it is what the
             element pins against, whatever is further out. No scrollport ancestor
             at all means it pins against the viewport, which works. */
          let nearest = null;
          for (let p = el.parentElement; p; p = p.parentElement) {
            if (isScrollport(p, axis)) { nearest = p; break; }
          }
          if (!nearest) return;
          if (canEverScroll(nearest, axis)) return;   // constrained; today's content is just short
          out.push({ severity: SEV.error, el,
            rule: 'Foundations → Layout · sticky pins to the nearest scrollport',
            message: 'This element is position: sticky on the ' + axis + ' axis, but the nearest ' +
                     'scrollport ("' + ((nearest.className || nearest.tagName) + '').toString().trim().slice(0, 40) +
                     '") can NEVER scroll on that axis — its size is handed to it by its own ' +
                     'content, measured by growing it. So the ' +
                     'stickiness is intercepted and the element travels with the content: no error, ' +
                     'nothing wrong in the computed style, and position still reads sticky. The usual ' +
                     'cause here is an overflow set for the OTHER axis, which makes the element a ' +
                     'scrollport on both. Either constrain that container’s size on this axis so it ' +
                     'genuinely scrolls, or move the sticky element out of it.' });
        });
        /* AN OPAQUE BACKGROUND IS PART OF BEING STICKY, not styling on top of it.
           A stuck element is the only thing in a layout that content deliberately
           passes underneath, so a transparent one shows the page sliding through
           it — and the failure is worst exactly where it matters, when there is
           enough content to scroll. In this component set the trap has a specific
           shape: thead carries the table-head fill rather than the th, so a sticky
           header cell is transparent by default and looks fine until it moves. */
        const bg = cs.backgroundColor || '';
        const alpha = (bg.match(/^rgba?\([^)]*?,\s*([\d.]+)\)$/) || [])[1];
        const transparent = bg === 'transparent' || alpha === '0';
        if (transparent && cs.backgroundImage === 'none') {
          out.push({ severity: SEV.error, el,
            rule: 'Foundations → Layout · a sticky surface is opaque',
            message: 'position: sticky with no background of its own, so content will scroll ' +
                     'through it once the region is long enough to scroll — which means it looks ' +
                     'correct in every short specimen and wrong in production. Paint it: the ' +
                     'surface fill for a bar, --color-bg-table-head for a header cell (thead ' +
                     'carries that fill, not the th, so a sticky th is transparent by default). ' +
                     'Declare it through :where() if row or hover state also paints this element, ' +
                     'or the fill will outrank the state.' });
        }
        const z = cs.zIndex;
        if (z !== 'auto' && parseFloat(z) !== zSticky) {
          out.push({ severity: SEV.warn, el,
            rule: 'Foundations → Layout · sticky takes --z-sticky',
            message: 'A sticky element painting at z-index ' + z + ' rather than --z-sticky (' +
                     zSticky + '). The scale exists so pinned chrome orders against dropdowns and ' +
                     'overlays by name rather than by a number nobody can look up. Stay below ' +
                     '--z-dropdown, or a menu opened from inside the pinned element renders behind it.' });
        }
      });
      /* COLLISION: TWO BARS STUCK TO THE SAME EDGE AT THE SAME OFFSET.
         Stacking sticky layers deliberately is fine — a filter bar at 0 and a
         subheader beneath it at the filter bar's height is a designed stack, and
         their offsets differ, which is how you can tell it was designed. What is
         never fine is two of them claiming the SAME offset on the same edge of the
         same scrollport: both stick to the same line and one hides the other, and
         which one wins is paint order rather than a decision.

         THE CROSS-AXIS TEST IS WHAT MAKES THIS USABLE. Every first cell in a
         pinned column is sticky, on the same edge, at the same offset, in the same
         scrollport — dozens of them — and none of them collide, because they sit in
         different rows. So two elements only conflict if their extents on the OTHER
         axis actually overlap. Without that, this check would fire on the feature
         it ships beside. */
      (function () {
        const groups = new Map();
        [].slice.call(root.querySelectorAll('*')).forEach(function (el) {
          const cs = getComputedStyle(el);
          if (cs.position !== 'sticky') return;
          let port = null;
          for (let p = el.parentElement; p; p = p.parentElement) {
            const o = getComputedStyle(p);
            if (o.overflowY !== 'visible' && o.overflowY !== 'clip') { port = p; break; }
            if (o.overflowX !== 'visible' && o.overflowX !== 'clip') { port = p; break; }
          }
          [['top', cs.top], ['bottom', cs.bottom], ['left', cs.left], ['right', cs.right]].forEach(function (pair) {
            if (pair[1] === 'auto') return;
            const key = [port ? (port.className || port.tagName) : 'viewport', pair[0], pair[1]].join('|');
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(el);
          });
        });
        groups.forEach(function (els, key) {
          if (els.length < 2) return;
          const edge = key.split('|')[1];
          const crossOverlaps = (a, b) => {
            const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
            return (edge === 'top' || edge === 'bottom')
              ? ra.left < rb.right - 1 && rb.left < ra.right - 1
              : ra.top  < rb.bottom - 1 && rb.top  < ra.bottom - 1;
          };
          for (let i = 0; i < els.length; i++) {
            for (let j = i + 1; j < els.length; j++) {
              if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
              if (!crossOverlaps(els[i], els[j])) continue;
              out.push({ severity: SEV.error, el: els[j],
                rule: 'Foundations → Layout · two sticky layers, one line',
                message: 'This element and a sibling are both stuck to the ' + edge + ' edge of the ' +
                         'same scrollport at the same offset (' + key.split('|')[2] + '), and their ' +
                         'extents overlap — so they land on the same line and one hides the other, ' +
                         'decided by paint order rather than by design. Stack them deliberately ' +
                         'instead: give the second an offset equal to the first one\u2019s height, ' +
                         'so the difference in offsets is what records that the stack was intended. ' +
                         'Or make only one of them sticky.' });
              return;   // one report per group is enough to act on
            }
          }
        });
      })();

      /* A COLUMNAR GRID WITH A SELECTION COLUMN AND NO DECLARED WIDTHS pins
         nothing, by design — see the note on the rule. The degradation is the
         safe one, but silence is exactly what this session kept finding to be
         dangerous, so it is reported rather than left to be discovered. */
      [].slice.call(root.querySelectorAll('.data-grid.columnar')).forEach(function (g) {
        if (!g.querySelector(':scope > :is(thead, tbody) > tr > .sel')) return;
        if (g.querySelector(':scope > colgroup')) return;
        out.push({ severity: SEV.warn, el: g,
          rule: 'Data grid → columnar · declare the columns to pin them',
          message: 'This columnar grid has a selection column and no <colgroup>, so NOTHING is ' +
                   'pinned while it scrolls sideways and the identifier travels out of view. The ' +
                   'pair can only pin exactly when the widths do not depend on content: `width` on ' +
                   'a cell is a suggestion under auto layout, and a squeezed table compressed the ' +
                   'checkbox from 36 to 34, leaving a 2px sliver of scrolling content beside the ' +
                   'pinned identifier. Declaring the columns puts the table into fixed layout and ' +
                   'the gap measures 0 — the same reason this component asks for a <colgroup> to ' +
                   'line a loading placeholder up with its rows. Pinning the checkbox alone is not ' +
                   'the fallback: ticking a row you can no longer identify is worse than scrolling.' });
      });
      return out;
    },

    /* ── A CHEVRON POINTING AGAINST ITS MEANING ──────────────────────────────
       The four directions carry four meanings and are not interchangeable:

         chevron_right  navigate, drill in, the step between breadcrumb crumbs
         chevron_down   expand, disclose — a select, a menu, an accordion header
         chevron_left   back, previous, collapse a panel toward its edge
         chevron_up     collapse a thing that is currently expanded

       Measured across the storybook the set is already used this way, which is
       exactly why it is worth writing down: a convention nothing enforces is one
       the next author has no way to discover, and the general "one meaning per
       glyph" rule does not name directions. This check exists to keep a passing
       state passing rather than to fix a violation — there are none today.

       IDENTIFYING THE GLYPH TAKES A FINGERPRINT, because the rendered markup does
       not carry its name: QIC emits a bare <svg class="ms" viewBox>. So the first
       path's `d` is matched against window.QICONS, which resolved 160 of 160 live
       icons with nothing unidentified. Four glyphs share a first path, so an
       ambiguous fingerprint is skipped rather than guessed.

       ONLY THE UNAMBIGUOUS CONTEXTS ARE CHECKED. A nav item that EXPANDS a group
       correctly takes chevron_down, and .nav-collapse correctly takes chevron_left
       to fold a panel toward its edge — so the check never asks "is this a nav
       item", it asks whether a horizontal chevron is sitting in a disclosure or a
       vertical one in a trail. Those two have no legitimate reading. */
    function chevronMeaning(root) {
      const out = [];
      const ICONS = (typeof window !== 'undefined' && window.QICONS) || null;
      if (!ICONS) return;
      /* THE FINGERPRINT NEEDS EVERY PATH AND ITS TRANSFORM, and getting there took
         three wrong answers worth recording. The first path alone collides on four
         pairs — and one of them is chevron_down / chevron_up, so the check silently
         skipped the exact glyphs it exists to police. The whole body string is
         unique across all 129 but does not survive the DOM: the browser reformats
         markup, so innerHTML never matches the source even normalised. Joining
         every path's `d` gets to 126 of 129, because three MIRRORED pairs share
         their geometry outright — chevron_up is chevron_down under
         transform="matrix(-1 0 0 -1 …)", and next/previous and forward/rewind are
         the same trick. Attribute VALUES do survive the round-trip verbatim, so
         `d` plus `transform` per path identifies all 129. */
      const byKey = new Map();
      const srcKey = (body) => {
        const out = [];
        const tags = body.match(/<path\b[^>]*>/g) || [];
        tags.forEach(t => {
          const d = (t.match(/\sd="([^"]*)"/) || ['', ''])[1];
          const tr = (t.match(/\stransform="([^"]*)"/) || ['', ''])[1];
          out.push(d + '@' + tr);
        });
        return out.join('|');
      };
      for (const [n, body] of Object.entries(ICONS)) {
        const k = srcKey(body);
        if (k && !byKey.has(k)) byKey.set(k, n);
      }
      const nameOf = (sv) => {
        const key = [].slice.call(sv.querySelectorAll('path'))
          .map(p => (p.getAttribute('d') || '') + '@' + (p.getAttribute('transform') || ''))
          .join('|');
        return key ? byKey.get(key) : undefined;
      };
      const DISCLOSURE = '.select, .acc-h, [aria-haspopup="menu"], [aria-haspopup="listbox"], [aria-haspopup="true"]';
      const TRAIL = '.crumbs .sep, .crumbs';
      const AXIS_OK = '.nav-collapse, .carousel-arrow, .pager .nav, .cal-h .nav';
      [].slice.call(root.querySelectorAll('svg.ms')).forEach(function (sv) {
        if (sv.closest('[data-audit-skip]')) return;
        const n = nameOf(sv);
        if (!n || n.indexOf('chevron_') !== 0) return;
        const horizontal = /_left$|_right$/.test(n);
        const vertical = /_up$|_down$/.test(n);
        if (sv.closest(AXIS_OK)) return;
        if (horizontal && sv.closest(DISCLOSURE)) {
          out.push({ severity: SEV.error, el: sv,
            rule: 'Foundations → Icons · a chevron points at its meaning',
            message: n + ' is sitting in a disclosure control (a select, a menu trigger or an ' +
                     'accordion header). A disclosure opens DOWNWARD, so it takes chevron_down at ' +
                     'rest and chevron_up when open — or, as Select does, one glyph rotated 180°. ' +
                     'A horizontal chevron there reads as "go somewhere", and the user finds out it ' +
                     'expands instead. chevron_right is navigate/drill in; chevron_left is back.' });
        } else if (vertical && sv.closest(TRAIL)) {
          out.push({ severity: SEV.error, el: sv,
            rule: 'Foundations → Icons · a chevron points at its meaning',
            message: n + ' is sitting in a breadcrumb trail, where the chevron marks the STEP from ' +
                     'one crumb to the next and points along the trail: chevron_right. A vertical ' +
                     'chevron there reads as a disclosure, which is what it means everywhere else ' +
                     'in this system.' });
        }
      });
      return out;
    }
  ];

  /* ---------- runner ---------- */

  /* An anti-pattern demo has to draw the wrong thing to argue against it, so
     the system's own "Don't" specimens are not findings. Same exemption
     spec.js makes with stripDemos(); without it, linting the storybook reports
     the very specimens that exist to warn against those patterns. */
  function inDemo(el) {
    /* data-audit-skip is the same escape hatch ds/spec.js honours, so the system
       has ONE way to say "this specimen draws the raw thing on purpose". A
       foundations story's job is to render the token itself — the colour page
       must ink a literal, the elevation page a box-shadow — and without this
       the linter reports the system's own documentation as defects. */
    return !!(el && el.closest && el.closest('.voice.bad, [data-qds-antipattern], [data-audit-skip]'));
  }

  /* SOME CHECKS ARE ABOUT THE STYLESHEET, NOT THE DOM, and those stay at the root.
     radiusFollowsForm, breakpointDrift and elementQualifiedClass all walk
     document.styleSheets and report on the RULES — a QDS_PHONE frame loads the
     same ds/ sheets, so running them per frame would report one authoring defect
     once per specimen on the page instead of once. They are marked rootOnly and
     skipped in a frame context; everything else is a question about rendered
     elements and is exactly as meaningful inside a specimen as outside it. */
  function lint(scope, ctx) {
    const doc = (ctx && ctx.doc) || document;
    const inFrame = !!(ctx && ctx.frame);
    const root = typeof scope === 'string' ? doc.querySelector(scope) : (scope || doc.body);
    if (!root) return { passed: false, findings: [{ severity: SEV.error, rule: 'QDS_LINT', message: 'Scope "' + scope + '" matched nothing.' }] };

    let findings = [];
    CHECKS.forEach(fn => {
      if (inFrame && ROOT_ONLY.indexOf(fn.name) !== -1) return;
      try { findings = findings.concat(fn(root, doc) || []); }
      catch (e) { findings.push({ severity: SEV.warn, rule: 'QDS_LINT', message: 'Check ' + fn.name + ' threw: ' + e.message }); }
    });
    findings = findings.filter(f => !inDemo(f.el));

    const counts = {
      error: findings.filter(f => f.severity === SEV.error).length,
      warn: findings.filter(f => f.severity === SEV.warn).length
    };
    /* THE CONDITIONS TRAVEL WITH THE RESULT, and are read HERE — in the same
       evaluation as the checks that depend on them. Half this file's rules are
       responsive: the mobile icon standard promotes a 12px toast dismiss to 20px,
       the touch rules only apply under (pointer: coarse), and the overlay rules
       become bottom sheets below the turn. A result reported without its viewport
       is a result about an unknown page.

       Read in the same call because a viewport measured in a SEPARATE evaluation
       can be stale by the time the check runs — a pane that is still settling
       after a resize reports the old width, and then a correct 20px mobile glyph
       looks like a defect at a desktop width that was never real. That cost a
       false diagnosis of the toast dismiss during the v166 pass: the size was read
       at one moment and the viewport at another, and the two never described the
       same page. Same call, or the numbers are not about each other. */
    const mq = (q) => { try { return matchMedia(q).matches; } catch (e) { return null; } };
    const conditions = {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      mobile: mq('(max-width: 768px)'),
      coarse: mq('(pointer: coarse)'),
      brand: doc.documentElement.getAttribute('data-brand'),
      mode: doc.documentElement.getAttribute('data-mode')
    };
    const result = { passed: counts.error === 0, counts: counts, findings: findings, conditions: conditions };

    /* Printed as well as returned: the point is for a person or an agent to
       read it, and a returned array in a console is a collapsed triangle. */
    const tag = result.passed ? (counts.warn ? 'PASSED with ' + counts.warn + ' warning(s)' : 'PASSED') : counts.error + ' error(s), ' + counts.warn + ' warning(s)';
    console.log('%cQuince Core \u00b7 output audit \u2014 ' + tag, 'font-weight:bold');
    console.log('  measured at ' + conditions.viewportWidth + '\u00d7' + conditions.viewportHeight +
      ' \u00b7 ' + (conditions.mobile ? 'MOBILE rules active' : 'desktop') +
      (conditions.coarse ? ' \u00b7 COARSE pointer' : '') +
      ' \u00b7 brand ' + conditions.brand + ' \u00b7 mode ' + conditions.mode);
    if (CSS_UNREADABLE) console.log('  (' + CSS_UNREADABLE + ' stylesheet(s) unreadable \u2014 cross-origin; class checks may under-report)');
    if (findings.length) {
      console.table(findings.map(f => ({ severity: f.severity, rule: f.rule, element: f.el ? label(f.el) : '', message: f.message })));
      findings.forEach(f => { if (f.el && f.el.style) { try { f.el.setAttribute('data-qds-lint', f.severity); } catch (e) {} } });
      console.log('  Offending elements carry data-qds-lint="error|warn" for inspection.');
    }
    return result;
  }

  /* ══ QDS_MOBILE — the gate for everything below the turn ═══════════════
     QDS_AUDIT and QDS_LINT both run in whatever viewport the page happens to
     have, and every mobile rule in this system keys on the viewport or the
     pointer. Run them on a desktop and the mobile rules are not merely unchecked
     — they are not APPLIED, so the page they inspect is the desktop page and it
     passes for reasons that have nothing to do with mobile.

     So this one checks its own precondition first and FAILS when it is not met,
     rather than returning a clean sheet. That is the whole reason it is a
     separate entry point: a check folded into QDS_LINT would have gone quiet on
     every desktop run, which is the failure mode this project has already hit
     three times (file:// sheets, an empty scope, an options object passed as a
     root). A gate that cannot tell whether it ran is not a gate.

     Run it with the window narrowed below --bp-turn, or with device emulation on so
     (pointer: coarse) matches. Both, ideally — some rules key on each. */
  const TOUCH_EXEMPT = [
    /* Bounded by their own pill: a 44px overlay would reach past the chip and
       take the neighbouring one's taps. Documented on button.x in components.css. */
    '.chip button.x', '.badge button.x', '.token button.x', '.thumb > button.x',
    /* Inline text. A 44px target on a link inside a paragraph overlaps the lines
       above and below it, so the line box is the target it can have. */
    '.lnk', '.crumb',
    /* A CAROUSEL DOT REPORTS POSITION; the swipe is the interaction. Exempt for a
       reason about what the control IS rather than about what fits: direct dot
       navigation is not what a thumb reaches for, the arrows in the track carry
       discrete steps, and holding eight 8px marks to 44 made the indicator row
       overflow the screen it was describing. The CSS agrees with this exemption
       — see the coarse rule beside .pager.dots — which is the difference between
       this and .thumb > button.x, excused from the check and then handed the
       exact overlay the excuse was about. */
    '.pager.dots .dot',
    /* The docs layer's own "Why" toggle, which is the same shape of thing: an
       inline control sitting inside a paragraph of prose. Same reasoning as .lnk
       verbatim — a 44px target would reach into the lines above and below the one
       it sits on. It is NOT exempt for being docs chrome; v117 floored the whole
       .sb-* shell precisely because this storybook holds itself to its own rules.
       It is exempt because it is inline text. */
    '.vnote-more'
  ];

  /* ctx IS HOW THIS AUDIT LEAVES THE TOP DOCUMENT. Every mobile specimen in this
     system is a QDS_PHONE iframe, and until now `const doc = document` meant the
     audit could not see into a single one of them — the frames rendered the only
     accurate mobile geometry in the storybook and were the one place nothing was
     ever checked. Two Phase 6B defects lived there for the life of the system.

     A context rather than a second implementation: the same CHECKS, the same
     mobileAudit, re-pointed at a frame's document and window. Element style reads
     need no rebinding at all — a parent-realm getComputedStyle returns the frame's
     own computed values, verified against the frame realm on both a font size and
     a resolved block-size — so only the DOCUMENT- and WINDOW-scoped reads change,
     which is what the rebinding below is. */
  function mobileAudit(scope, ctx) {
    const doc = (ctx && ctx.doc) || document;
    const win = (ctx && ctx.win) || window;
    const inFrame = !!(ctx && ctx.frame);
    const root = typeof scope === 'string' ? doc.querySelector(scope) : (scope || doc.body);
    /* The turn comes from --bp-turn, not from a number repeated here. A media
       query cannot read a token, but JavaScript can, so the one consumer that is
       able to stay in step does. */
    const TURN = (win.getComputedStyle(doc.documentElement)
      .getPropertyValue('--bp-turn').trim() || '768px');
    const TURN_PX = parseFloat(TURN) || 768;
    const narrow = win.matchMedia('(max-width: ' + TURN + ')').matches;
    const coarse = win.matchMedia('(pointer: coarse)').matches ||
      doc.documentElement.getAttribute('data-pointer') === 'coarse';
    const out = [];

    if (!narrow && !coarse) {
      return {
        ran: false, passed: false, viewport: win.innerWidth,
        counts: { error: 1, warn: 0 },
        findings: [{
          severity: SEV.error, rule: 'QDS_MOBILE \u00b7 precondition',
          message: 'Neither (max-width: ' + TURN + ') nor (pointer: coarse) matches, so no mobile rule is in ' +
                   'effect and there is nothing here to check. This is a FAILURE, not a pass \u2014 narrow ' +
                   'the window below ' + TURN_PX + ' or turn on device emulation, then run it again. Viewport is ' +
                   win.innerWidth + 'px.'
        }]
      };
    }
    if (!root) return { ran: false, passed: false, counts: { error: 1, warn: 0 },
      findings: [{ severity: SEV.error, rule: 'QDS_MOBILE', message: 'Scope matched nothing.' }] };

    /* ── 1. Touch targets ──
       The box is not always the target: the system grows small controls with a
       centred ::after rather than by resizing them, so the overlay counts. */
    const examined = { targets: 0, surfaces: 0, bars: 0, icons: 0, brandScopes: 0, sheets: 0, searchViews: 0, pinnedSurfaces: 0 };

    if (coarse) {
      const SEL = 'button, a[href], input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"]), ' +
                  '.nav-item, .menu-item, .tab, .chip, .cal-day, .dot';
      const seen = new Set();
      /* THE CALENDAR'S FLOOR IS CAUSAL, NOT A SECOND THRESHOLD. A day cell has no
         width of its own — the 1fr track owns it — so its target is whatever the
         surface can afford. .cal declares 314 (seven 44s, its padding, its
         border) and carries max-width:100%, so in a container narrower than that
         the cells shrink and NO rule inside the calendar can prevent it.
         Asking "is the cell 44?" therefore reports the container's width as a
         calendar defect. Asking "did the surface get its declared width?" reports
         the actual cause, which is the difference between a finding someone can
         act on and one they learn to scroll past.
         Measured from a probe rather than by re-deriving the formula here: the
         calendar has already been broken twice by a second copy of its own
         arithmetic going stale, and a lint that re-types the formula is a third
         copy. Fixed positioning gives the probe the viewport as its containing
         block, so max-width:100% cannot be clamped by whatever the caller's
         scope happens to be — the one blind spot is a viewport under 314 itself,
         which is below the narrowest screen this system targets. */
      let _calDeclared = null;
      const calDeclaredWidth = () => {
        if (_calDeclared !== null) return _calDeclared;
        const probe = doc.createElement('div');
        probe.className = 'cal';
        probe.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none';
        doc.body.appendChild(probe);
        _calDeclared = probe.getBoundingClientRect().width;
        probe.remove();
        return _calDeclared;
      };
      root.querySelectorAll(SEL).forEach(el => {
        if (el.closest('[data-audit-skip]')) return;
        if (TOUCH_EXEMPT.some(sel => { try { return el.matches(sel) || el.closest(sel) === el; } catch (e) { return false; } })) return;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        examined.targets++;
        /* BOTH PSEUDOS, because the system uses both and for a reason. Most overlays
           are ::after; the chip's is ::before, because a chip CONTAINS a control —
           its dismiss — and ::after paints over the children while ::before paints
           under them. An ::after overlay covered the × completely and dismiss did
           nothing. This check read ::after only, so the moment the chip's overlay
           moved to the pseudo that works it went invisible here and 13 chips across
           7 stories reported as 32px targets that are really 44. Whichever pseudo
           carries it, the target is the larger box.

           A pseudo-element has a computed width whether or not it GENERATES a box:
           with `content: none` this still reports the declared 44px, so counting it
           unchecked credits a control with an overlay that never renders. Found by
           trying to mutation-test the stepper's overlay away — `content: none` did
           not change the verdict, which is the tell that the check was reading a
           declaration rather than a box. */
        const pseudoBox = (which) => {
          const pcs = getComputedStyle(el, which);
          const gen = pcs.content && pcs.content !== 'none' && pcs.content !== 'normal';
          return gen ? { w: parseFloat(pcs.width), h: parseFloat(pcs.height) } : null;
        };
        const pseudos = [pseudoBox('::after'), pseudoBox('::before')].filter(Boolean);
        const ow = pseudos.length ? Math.max.apply(null, pseudos.map(b => b.w)) : NaN;
        const oh = pseudos.length ? Math.max.apply(null, pseudos.map(b => b.h)) : NaN;
        /* THE BOX IS NOT ALWAYS THE TARGET, and it fails to be in two documented
           ways. A small control grows by a centred ::after rather than by
           resizing (button.x), and a FIELD is wrapped: the <input> inside a
           .control is 23px tall while the .control around it is 44, and tapping
           anywhere in that padding focuses the field. Measuring the input alone
           reported a 23px target on a page where nothing was wrong. */
        /* ...BUT ONLY WHERE THE FIELD REALLY IS ONE TARGET. The wrapper stands in
           for a lone <input> because tapping the padding focuses it. It must not
           stand in for a control that SHARES the field: a stepper puts three
           targets in one .control, and the strip above the minus button focuses
           the input rather than pressing minus. Substituting the field there
           reported 44 for a 42px button and hid finding 8 for the whole
           migration — the check passed on the exact defect it exists to catch.
           One interactive child means the wrapper is the target; more than one
           means each child answers for its own box. */
        /* .drop IS ON THIS LIST BECAUSE IT IS A <label> AROUND ITS INPUT, which is the
           strongest form of the relationship this list exists for: the file input is
           clipped to 1px on purpose and the ZONE is what a finger hits. Without it the
           check measured the 1px input and reported a 1px target on a 420x207 affordance. */
        const wrap = el.closest('.control, .select, .token-field, .opt, .drop');
        /* The wrapper stands in for the field's TEXT ENTRY, whose padding really is
           part of its target — or for a wrapper holding a single control, which is
           the same thing said structurally. It must not stand in for a control that
           SHARES the field: a stepper has three targets in one .control, and the
           strip above the minus button focuses the input rather than pressing minus.
           A blunter "sole target" test alone was wrong in the other direction — it
           stopped standing in for the stepper's own input, which reported 23px for a
           field whose padding does focus it. */
        const entry = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
        const sole = wrap && wrap.querySelectorAll(SEL).length <= 1;
        const wr = wrap && wrap !== el && (entry || sole) ? wrap.getBoundingClientRect() : null;
        const w = Math.max(r.width, isNaN(ow) ? 0 : ow, wr ? wr.width : 0);
        const h = Math.max(r.height, isNaN(oh) ? 0 : oh, wr ? wr.height : 0);
        const min = Math.round(Math.min(w, h));
        /* THE FLOOR IS PER-CONTROL, and read from the tokens rather than typed here so
           the check cannot drift from the CSS the way it did when 44 was a literal.

           44 is the PREFERRED standard target and stays the floor for everything that
           answers with its own box. A COMPACT control is the documented exception: it is
           36 of ink expanded to a 40 target, because reaching 44 from 36 bleeds 4px a
           side and collided with eight of the 23 compact buttons measured in real
           toolbars, where 40 bleeds 2 and collides with three. An overlapping target is
           the worse failure — the wrong control answers the tap.

           Below 40 there is no smaller allowance to fall back to: that is a composition
           problem, and the message says so. */
        /* Same rule as the ladder check below: resolve through a property, because a
           token that grows a calc() or max() later would silently read as NaN here. */
        const px = (t, fallback) => {
          const el = doc.createElement('div');
          el.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;inline-size:var(' + t + ')';
          doc.documentElement.appendChild(el);
          const v = parseFloat(getComputedStyle(el).inlineSize);
          el.remove();
          return isNaN(v) ? fallback : v;
        };
        const STANDARD_FLOOR = px('--size-touch-min', 44);
        const COMPACT_FLOOR = px('--size-target-touch-sm', 40);
        let isCompact = false;
        /* .seg button belongs to the compact-touch family by DESIGN, not by
           accident: the segmented track adds --space-2xs a side, so 40px
           segments make a 44px control while 44px segments make a 48px one —
           the height of a prominent CTA for a compact pivot. Holding it to 44
           here is what made the strip ship at 48. */
        try { isCompact = el.matches('.btn.sm, .btn.icon:not(.lg), .seg button'); } catch (e) {}
        /* A day cell is allowed the compact target only when its surface was
           actually clamped — a calendar with its full 314 must produce 44, and
           letting it off at 40 unconditionally would have hidden the 42.57 the
           component shipped for eleven versions. */
        let clampedBy = null;
        try {
          if (el.matches('.cal-day')) {
            const cal = el.closest('.cal');
            if (cal) {
              const declared = calDeclaredWidth();
              const got = cal.getBoundingClientRect().width;
              if (got < declared - 0.5) {
                isCompact = true;
                clampedBy = { got: Math.round(got), declared: Math.round(declared),
                              parent: cal.parentElement };
              }
            }
          }
        } catch (e) {}
        const floorPx = isCompact ? COMPACT_FLOOR : STANDARD_FLOOR;
        if (min >= floorPx) return;
        /* Below even the compact target with a clamped surface, the calendar is
           not the thing to fix and the finding says whose problem it is. */
        if (clampedBy) {
          const ck = 'cal-clamped|' + clampedBy.got;
          if (seen.has(ck)) return;
          seen.add(ck);
          out.push({ severity: SEV.warn, el: clampedBy.parent || el,
            rule: 'Foundations \u2192 Layout \u00b7 --size-touch-min',
            message: 'Day cells are ' + min + 'px because the calendar was given ' + clampedBy.got +
                     'px of its declared ' + clampedBy.declared + 'px, not because of anything inside ' +
                     'the calendar: the cells fill a 1fr track, so they can only be as wide as the ' +
                     'surface. Below ' + COMPACT_FLOOR + 'px the fix is the CONTAINER \u2014 give it the ' +
                     clampedBy.declared + 'px, or stop nesting the calendar in padded chrome. Warned ' +
                     'rather than errored because no change to the calendar can clear it.' });
          return;
        }
        const key = (el.className || el.tagName) + '|' + min;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ severity: SEV.error, el,
          rule: 'Foundations \u2192 Layout \u00b7 --size-touch-min',
          message: 'Target is ' + min + 'px on a coarse pointer; the floor here is ' + floorPx +
                   (isCompact
                     ? 'px \u2014 this is a COMPACT control, so it is allowed the 40 compact target rather ' +
                       'than the preferred 44, and it is not reaching even that. Do not solve it by growing ' +
                       'the overlay past 40: that is what makes adjacent targets overlap. Fix the ' +
                       'COMPOSITION instead \u2014 widen the gap, move actions into an overflow, or promote ' +
                       'the control to the standard 44 rung.'
                     : 'px. Either the control sizes off --size-control-sm/md (which floor at the touch ' +
                       'rungs under coarse) or it needs a centred ::after the way button.x does. If it is ' +
                       'bounded by a smaller parent on purpose, add it to TOUCH_EXEMPT in lint.js with the ' +
                       'reason.') });
      });
    }

    /* ── 2. Nothing scrolls sideways ──
       A .wide() specimen scrolls ON PURPOSE inside its own overflow-x container,
       so only overflow that escapes every scroller counts. */
    /* ── A BREADCRUMB IS A DESKTOP AFFORDANCE, AND BELOW THE TURN IT IS GONE ──
       Not wrapped, not truncated, not scrolled sideways, and not clipped into the
       accessibility tree either: a trail whose whole job is to show where you are
       in a hierarchy is noise on a screen that shows one level at a time, and a
       hidden copy would narrate a hierarchy the page does not display. The page
       header removes it outright, and the space with it.

       SCOPED TO A BREADCRUMB INSIDE A .shell, which is what makes this checkable
       without false positives. The Breadcrumb component's own story renders ten
       trails at every width and every one of them is legitimate — a specimen of a
       desktop component is not a page using it. Measured across all 57 stories at
       a narrow viewport before this check was written: ten rendered trails, zero
       of them inside a shell, so this fires on nothing that exists today.

       getClientRects() rather than a display read: it is the same question the
       policy asks — does this occupy the page — and it answers it for a clip, an
       offscreen shift and a zero-size box alike, not just for display: none. */
    if (narrow) {
      root.querySelectorAll('.shell .crumbs').forEach(function (c) {
        if (c.getClientRects().length === 0) return;
        out.push({
          severity: SEV.error,
          rule: 'Patterns \u2192 page header \u00b7 no breadcrumb below the turn',
          message: 'A breadcrumb is rendering inside a page shell at ' + win.innerWidth +
            'px, below the turn. Quince removes the trail entirely below --bp-turn ' +
            '\u2014 it is a desktop affordance, and the page header drops it along ' +
            'with its layout space. Do not wrap it, truncate it, scroll it, or hide ' +
            'it while leaving it in the accessibility tree. If the flow needs a way ' +
            'back to the parent, that is a navigation decision for the page, not a ' +
            'breadcrumb in disguise.',
          el: c
        });
      });
    }

    if (narrow) {
      const de = doc.documentElement;
      if (de.scrollWidth > de.clientWidth + 1) {
        out.push({ severity: SEV.error, rule: 'Foundations \u2192 Layout \u00b7 no sideways scroll',
          message: 'The document scrolls horizontally by ' + Math.round(de.scrollWidth - de.clientWidth) +
                   'px. Something is wider than the viewport and is not inside an overflow-x scroller.' });
      }
      root.querySelectorAll('*').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width <= win.innerWidth + 1) return;
        let p = el.parentElement, scrolled = false;
        while (p && p !== doc.documentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') { scrolled = true; break; }
          p = p.parentElement;
        }
        if (scrolled) return;
        out.push({ severity: SEV.error, el, rule: 'Foundations \u2192 Layout \u00b7 no sideways scroll',
          message: 'Element is ' + Math.round(r.width) + 'px wide in a ' + win.innerWidth +
                   'px viewport and no ancestor scrolls. Give it a scroller or let it shrink.' });
      });
    }

    /* ── 3. One outer inset ──
       Below the turn every surface sits 16 from its own edge. Only the INLINE
       edges are checked: the vertical seams inside a surface are set against the
       type, not the screen, and v79 deliberately left them alone. */
    if (narrow) {
      const SURFACES = ['.shell > .hd', '.shell > .ft', '.shell > .pn', '.shell > .ct',
        '.modal-h', '.modal-b', '.modal-f', '.drawer-h', '.drawer-b', '.drawer-f',
        '.popover-h', '.popover-b'];
      /* .cal is deliberately NOT here. The 16px inset is for regions that touch
         the screen edge and for overlay chrome whose padding IS the page margin.
         A calendar is a fixed-size widget sitting inside one of those, so 16 a
         side is not an inset — it is 32px of a 375px screen spent on nothing,
         and it is what pushed the cells under the touch floor. Its padding is
         component chrome and it owns it. */
      SURFACES.forEach(sel => {
        root.querySelectorAll(sel).forEach(el => {
          if (el.closest('[data-audit-skip]')) return;
          examined.surfaces++;
          const cs = getComputedStyle(el);
          [['paddingLeft', 'inline-start'], ['paddingRight', 'inline-end']].forEach(([prop, side]) => {
            const v = Math.round(parseFloat(cs[prop]));
            if (v === 16) return;
            out.push({ severity: SEV.warn, el, rule: 'Foundations \u2192 Spacing \u00b7 one outer inset on mobile',
              message: sel + ' has ' + v + 'px of ' + side + ' padding; below the turn every surface sits 16 ' +
                       'from its own edge, so a card inside it lines up rather than stepping in twice.' });
          });
        });
      });
    }

    /* ── 4. At most two trailing actions ──
       WHICH actions a mobile header carries is the product's judgement and
       changes per view; HOW MANY is the system's, and it is two on every screen.
       See .hd-global in components.css for why two rather than three.

       NARROW ONLY. Above the turn a top-nav header legitimately runs four global
       actions — notifications, language, help, account — and that is documented
       behaviour, so a cap applied at every width would report the system's own
       pattern as a defect.

       Counted, never hidden. CSS could drop the third with :nth-child(n+3), and
       that is worse than a crowded bar: the product would still believe it
       shipped an action no user can reach. */
    if (narrow) {
      const ACTION_CAP = 2;
      root.querySelectorAll('.shell > .hd > .hd-global').forEach(g => {
        if (g.closest('[data-audit-skip]')) return;
        /* MEASURE THE BAR, NOT THE WINDOW. The mobile CSS keys on the viewport,
           so a desktop layout pinned wide inside a horizontal scroller — which is
           exactly how this system draws its side-by-side specimens — is in
           "mobile mode" while being 1040px across. The whole argument for two is
           that a phone bar is ONE LINE with its leading edge already spent; a bar
           with 1040px of room is not that bar, and reporting it flagged the
           system's own desktop top-nav specimen and its four documented global
           actions. Caught by running the gate, not by reading it. */
        const bar = g.closest('.hd');
        if (bar && bar.getBoundingClientRect().width > TURN_PX) return;
        examined.bars++;
        const actions = [].slice.call(g.children).filter(function (c) {
          return getComputedStyle(c).display !== 'none';
        });
        if (actions.length <= ACTION_CAP) return;
        out.push({ severity: SEV.error, el: g,
          rule: 'Components \u2192 App shell \u00b7 at most two trailing actions',
          message: 'The mobile header carries ' + actions.length + ' trailing actions and the cap is ' +
                   ACTION_CAP + ', on every screen. A phone header is one line and its leading edge is ' +
                   'already spent on the toggle and the brandmark, so a third action pushes the product ' +
                   'name into truncation to make room for something the user did not ask for. Decide ' +
                   'which two are reached for from THIS view and move the rest onto the page or behind ' +
                   'an overflow menu \u2014 which counts as one of the two.' });
      });
    }

    /* ── 5. Interactive icons draw at the master size ──
       Below the turn every icon belonging to a CONTROL draws at 20px. See the
       mobile icon standard at the end of components.css.

       THIS CHECK USED TO SCALE THE BOX BY 20/viewBox AND STOPPED BEING TRUE.
       The old registry drew 20-unit art and padded the viewBox to '-2 -2 24 24'
       for the lg rung, so box size and art size were different questions and
       only the art answered the one that mattered. Every glyph now comes from
       Lucide on a single '0 0 24 24' box with the art filling it, so art IS box
       — and the old arithmetic turned a correct 20px control icon into 16.7 and
       errored on all of them. The line weight is no longer implicated either:
       vector-effect: non-scaling-stroke makes the rendered stroke the value of
       --icon-stroke whatever the viewBox does.

       MEASURE THE COMPUTED WIDTH, NOT getBoundingClientRect. Half the chevrons
       in this system are one glyph under a rotate(), and the client rect is the
       post-transform AABB — a rotated 20px box reports up to 28.3.

       The exemptions are glyphs BOUNDED BY SOMETHING OTHER THAN THE POINTER: a
       dismiss inside a pill or a thumbnail corner, a tick drawn inside a 16px
       checkbox, a sort arrow sized to a column label. They are the same list the
       touch-target floor exempts, for the same reason. */
    if (narrow) {
      const ICON_CONTROLS = ['.btn', '.nav-item', '.menu-item', '.tab', '.acc-h', '.step', '.num',
        '.select', '.pager button', '.pager a', '.pager .nav', '.cal-h .nav', '.carousel-arrow',
        '.drawer-h .x', '.modal-h .x', '.popover-h .x', '.search > button.x'];
      const ICON_EXEMPT = ['.chip button.x', '.badge button.x', '.token button.x',
        '.thumb > button.x', '.checkbox', '.data-grid th > button.sort',
        /* The toast dismiss was in the CONTROLS list and moved here when the art
           was normalised to 12px. It is bounded by the toast, not by the pointer:
           a 20px cross beside a single line of body text reads as a second action,
           and the 44px target comes from a centred ::after rather than from the
           glyph. Same reason as the chip and badge dismisses above it. */
        '.toast button.x'];
      const closestAny = (el, list) => list.some(function (s) {
        try { return el.closest(s); } catch (e) { return false; }
      });
      root.querySelectorAll('.ms').forEach(ms => {
        if (ms.closest('[data-audit-skip]')) return;
        if (!closestAny(ms, ICON_CONTROLS)) return;
        if (closestAny(ms, ICON_EXEMPT)) return;
        const cs = getComputedStyle(ms);
        const drawn = parseFloat(cs.width);
        if (!drawn) return;                           /* not rendered */
        examined.icons++;
        if (Math.abs(drawn - 20) < 0.75) return;
        const over = drawn > 20;
        out.push({ severity: SEV.error, el: ms,
          rule: 'Foundations \u2192 Icons \u00b7 the mobile master size',
          message: 'This control\u2019s glyph draws at ' + drawn.toFixed(1) + 'px; below the turn the ' +
            'master size is 20. ' + (over
              ? 'Larger than the master reads as emphasis the control has not earned, and it is ' +
                'almost always --size-icon-lg applied to a control rather than to a display glyph. ' +
                'The lg rung is for larger and mobile CONTEXTS, not for making a button shout.'
              : 'Give it --size-icon-md. A control icon does not take the sm rung below the turn: ' +
                'the target grows on touch and a 16px glyph inside a 44px button reads as a mistake.') +
            ' The stroke follows the size on its own \u2014 --icon-stroke is paired to the rung in the ' +
            'same rule that sets font-size, and iconScale checks that pair.' });
      });
    }

    /* ── 6. The touch ladder survives every brand scope ──
       Checks the CAUSE, where the target check catches the symptom. Under a
       coarse pointer --size-control-sm and -md collapse to --size-control-touch,
       and that collapse is inherited: a brand layer declares the same rungs from
       [data-brand], so an element carrying data-brand BELOW the root re-declares
       them on a nearer ancestor and the collapse never reaches its subtree.

       Weight cannot fix inheritance, which is why this is worth its own check —
       the foundation already doubles :root:root and that only wins contests at
       the same level. A themed section, a preview pane or an embedded widget is
       a perfectly legitimate place to scope a brand, so the answer is not to
       forbid it; it is to confirm the rungs still resolve there.

       IT COMPARES EACH RUNG AGAINST ITS OWN TOUCH TOKEN, not against --size-touch-min.
       The floor and the chosen sizes are deliberately different numbers:
       --size-touch-min is the PLATFORM floor (44: Apple HIG, WCAG 2.5.5 AAA) and
       check 5 above enforces it as a minimum on the rendered TARGET. These are the
       visible heights the system chooses — 40 / 44 / 48 — and 48 is the CTA height
       rather than the universal one. Reading the floor here would fail on every brand
       scope the moment any chosen size differs from 44, which is what happened the
       first time this was written.

       Reading the token rather than the rendered control is deliberate: it fires
       on an empty themed container, before anyone has put a control in it. */
    if (coarse) {
      const rootCS = win.getComputedStyle(doc.documentElement);
      const TOUCH_RUNGS = [
        ['--size-control-sm', '--size-control-touch-sm'],
        ['--size-control-md', '--size-control-touch-md'],
        ['--size-control-lg', '--size-control-touch-lg'],
      ];
      /* within(), not root.querySelectorAll — the scope you point this at is very
         often the themed wrapper itself, and querySelectorAll never returns the
         element it was called on. The first liveness probe pointed the gate
         straight at a broken [data-brand] element and it reported zero, which is
         the exact failure the helper at the top of this file was written to stop
         and which I reproduced by not using it. */
      /* AND THE LADDER MUST STAY MONOTONIC. Checked because it silently was not:
         -lg is a fixed 44 at pointer size, so raising -md to 48 for touch made the
         LARGE control the smallest one on a phone — a .btn.lg at 44 beside a default
         .btn at 48. Nothing reported it; it was found by measuring the button story.
         One assertion stops that returning, and it belongs here rather than in the
         target check because it is a property of the SCALE, not of any element. */
      /* RESOLVE THROUGH A REAL PROPERTY, never by parsing the token string. A custom
         property is SUBSTITUTED, not computed: getPropertyValue('--size-control-lg')
         returns the literal text, which became "max(44px, 48px)" the moment the coarse
         block started taking a max — and parseFloat of that is NaN, which this helper
         turned into 0 and then reported as an inverted ladder. A false positive of my
         own making, caught immediately because the number was 0 rather than merely
         wrong. Assigning the token to a length property and reading the USED value is
         the only form that survives calc(), max(), min() and clamp(). */
      const rung = (t) => {
        const el = document.createElement('div');
        el.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;inline-size:var(' + t + ')';
        document.documentElement.appendChild(el);
        const v = parseFloat(getComputedStyle(el).inlineSize) || 0;
        el.remove();
        return v;
      };
      const ladder = [['--size-control-sm', rung('--size-control-sm')],
                      ['--size-control-md', rung('--size-control-md')],
                      ['--size-control-lg', rung('--size-control-lg')]];
      /* AND TOUCH MAY RAISE A RUNG, NEVER LOWER ONE. A separate invariant from the order
         above, and the ladder check is blind to it: Spacious runs lg at 56 for a pointer,
         so pinning touch to a flat 48 made its prominent button SHRINK when a finger
         arrived — while 44/44/48 stayed perfectly monotonic. The defect is across the
         BRAND axis, not within the rung order, and a Figma pilot surfaced it rather than
         any check here. --size-control-lg-pointer is the brand's own value, published
         under a name the coarse block does not overwrite. */
      /* GENERALISED FROM THE ONE RUNG THAT TAUGHT IT. This was hard-coded to
         --size-control-lg, so the badge rungs added later would have been able to
         shrink exactly the same way, silently, and the check that exists because
         of one instance would have watched the second go by. The -pointer SUFFIX
         IS THE CONTRACT now: publish a rung's pointer value under that name and
         it is guarded, with no edit here. Discovered from the stylesheets rather
         than listed, so a rung cannot be added and forgotten. */
      const pointerTwins = (() => {
        const names = new Set();
        for (const sheet of doc.styleSheets) {
          let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
          const walk = (list) => { for (const r of list) {
            if (r.style) for (let i = 0; i < r.style.length; i++) {
              const prop = r.style.item(i);
              if (/^--.+-pointer$/.test(prop)) names.add(prop);
            }
            if (r.cssRules) walk(r.cssRules);
          } };
          walk(rules);
        }
        return [...names];
      })();
      for (const twin of pointerTwins) {
        const base = twin.replace(/-pointer$/, '');
        const want = rung(twin), now = rung(base);
        if (!want || !now || now >= want) continue;
        out.push({ severity: SEV.error, el: doc.documentElement,
          rule: 'Foundations \u2192 Layout \u00b7 touch may raise a rung, never lower one',
          message: 'Under a coarse pointer ' + base + ' is ' + now + 'px, SMALLER than the ' + want +
                   'px this brand uses for a POINTER (' + twin + '). Touch may raise a rung and never ' +
                   'shrink one. The coarse block should take max(' + twin + ', <the touch floor>) for ' +
                   'exactly this reason, so a brand whose pointer rung already sits at or above the ' +
                   'floor keeps its own value. This was found once on --size-control-lg, where pinning ' +
                   'touch to a flat 48 shrank Spacious from 56 when a finger arrived, and the ladder ' +
                   'check could not see it because 44/44/48 is still monotonic.' });
      }
      for (let i = 1; i < ladder.length; i++) {
        if (ladder[i][1] >= ladder[i - 1][1]) continue;
        out.push({ severity: SEV.error, el: doc.documentElement,
          rule: 'Foundations \u2192 Layout \u00b7 --size-control-touch',
          message: 'Under a coarse pointer ' + ladder[i][0] + ' is ' + ladder[i][1] + 'px, SMALLER than ' +
                   ladder[i - 1][0] + ' at ' + ladder[i - 1][1] + 'px. The control ladder has inverted: a ' +
                   'larger rung must never render smaller than the one below it. Every rung that is not in ' +
                   'the (pointer: coarse) block keeps its pointer value while the others grow.' });
      }
      within(root, '[data-brand]').forEach(el => {
        if (el === doc.documentElement) return;
        if (el.closest('[data-audit-skip]')) return;
        examined.brandScopes++;
        const cs = getComputedStyle(el);
        TOUCH_RUNGS.forEach(([tok, wantTok]) => {
          const expected = rootCS.getPropertyValue(wantTok).trim();
          const v = cs.getPropertyValue(tok).trim();
          if (!v || !expected || v === expected) return;
          out.push({ severity: SEV.error, el,
            rule: 'Foundations \u2192 Layout \u00b7 --size-touch-min',
            message: 'data-brand="' + el.getAttribute('data-brand') + '" on a non-root element ' +
              'resolves ' + tok + ' to ' + v + ', not the ' + expected + ' that ' + wantTok +
              ' sets for touch. A brand layer ' +
              'declares the control ladder from [data-brand], so scoping a brand to a wrapper puts ' +
              'that declaration on a NEARER ANCESTOR than the coarse-pointer collapse \u2014 and a ' +
              'custom property resolves to the closest ancestor that declares it, so specificity ' +
              'cannot reach past it. Every control in this subtree renders at pointer size. The ' +
              'foundation covers this with [data-brand][data-brand]; if you are seeing it, a brand ' +
              'file is declaring the rungs at a weight above that.' });
        });
      });
    }

    /* ── 7. A sheet at its cap should be a full page ──
       Below the turn a portalled modal, drawer or popover becomes a bottom sheet
       that grows to its content and stops --sheet-peek short of the top. That is
       right while the content FITS. Once the sheet is pinned at its cap and still
       scrolling, the strip of page above it is no longer context — it is a 56px
       band of screen spent on nothing, and .full is the honest shape.

       Two conditions, and both are needed. A short sheet that happens to scroll
       by a pixel is not a full page, and a tall sheet with room to spare is not
       either. Measured on the element and its scrolling region rather than
       inferred from how much markup went in, because "how much content" is a
       fact about the rendered surface. */
    if (narrow) {
      const SHEET_BODY = { modal: '.modal-b', drawer: '.drawer-b', popover: '.popover-b' };
      within(root, 'body > .modal, body > .drawer, body > .popover').forEach(el => {
        if (el.closest('[data-audit-skip]')) return;
        if (el.classList.contains('full')) return;
        const kind = ['modal', 'drawer', 'popover'].find(k => el.classList.contains(k));
        if (!kind) return;
        examined.sheets++;
        const cap = parseFloat(getComputedStyle(el).maxBlockSize);
        const h = el.getBoundingClientRect().height;
        if (!cap || h < cap - 1) return;                 /* room to spare — a sheet */
        const body = el.querySelector(SHEET_BODY[kind]);
        const scroller = body || el;
        if (scroller.scrollHeight <= scroller.clientHeight + 1) return;   /* fits */
        out.push({ severity: SEV.error, el,
          rule: 'Components \u2192 Overlays \u00b7 sheet or full page',
          message: 'This ' + kind + ' is a bottom sheet pinned at its ' + Math.round(cap) + 'px cap ' +
            'with ' + Math.round(scroller.scrollHeight - scroller.clientHeight) + 'px still to scroll, ' +
            'so the strip of page above it has stopped being context and become a band of unused ' +
            'screen. A sheet is a glance \u2014 one decision, a few fields, a list you can see the end ' +
            'of. Add .full for the full-page shape: no peek, no radius, no seam.' });
      });
    }

    /* THE MOBILE SEARCH SURFACE, TWO WAYS IT SILENTLY BREAKS.

       OUTSIDE THE `narrow` BLOCK, unlike the sheet check above: a .search-view
       nested in a transformed ancestor is wrong at every size, since the width
       does not decide whether `position: fixed` resolves against the viewport.
       The gate's own precondition still applies \u2014 QDS_MOBILE returns a FAILURE
       on a desktop viewport with a fine pointer and never reaches any check \u2014 so
       this runs on a coarse-pointer run at any width, not on every run.

       (1) NESTING. Same trap the bottom-sheet rule documents: a fixed element
       inside a transformed ancestor positions against that ancestor, so a search
       view dropped inside a card renders inside the card, at the card's size,
       looking like a component that happens to be small. Nothing else reports it.

       (2) A BAR THAT GREW ACTIONS. The whole point of this surface is that the
       field owns the line. A .hd-global copied across from the app shell, or a
       second button, or a breadcrumb, puts the phone header's problem back on the
       one screen that had escaped it \u2014 and it fits, so it looks fine until the
       query is long enough to truncate. Counted rather than eyeballed. */
    within(root, '.search-view').forEach(el => {
      if (el.closest('[data-audit-skip]')) return;
      examined.searchViews++;
      if (el.parentElement !== doc.body) {
        out.push({ severity: SEV.error, el,
          rule: 'Components \u2192 Search \u00b7 .search-view is a child of body',
          message: 'This .search-view is nested inside <' +
            el.parentElement.tagName.toLowerCase() +
            (el.parentElement.className ? ' class="' + el.parentElement.className + '"' : '') +
            '>. It is position: fixed, and a fixed element inside a TRANSFORMED ancestor ' +
            'positions against that ancestor rather than the viewport \u2014 so it renders inside ' +
            'the container, at the container\u2019s size, and looks like a small component rather ' +
            'than a broken full-screen one. Portal it to body, the same rule every other ' +
            'full-viewport surface here follows.' });
      }
      const hd = el.querySelector('.search-view-h');
      if (!hd) return;
      const extras = [];
      if (hd.querySelector('.hd-global')) extras.push('.hd-global');
      if (hd.querySelector('.crumbs')) extras.push('.crumbs');
      if (hd.querySelector('.brandmark')) extras.push('.brandmark');
      const btns = [...hd.children].filter(c => c.matches('button, .btn')).length;
      if (btns > 1) extras.push(btns + ' buttons');
      if (!extras.length) return;
      out.push({ severity: SEV.error, el: hd,
        rule: 'Components \u2192 Search \u00b7 the search bar carries two things',
        message: 'The search view\u2019s bar carries ' + extras.join(' and ') + '. It takes a back ' +
          'control and the field and nothing else. The mobile header caps trailing actions at ' +
          'two because a phone bar has one line; here the field wants the whole line, so the cap ' +
          'is zero. What the user is doing is typing.' });
    });

    /* ── A TILE CARRYING BOTH ACTIONS, ON A TILE TOO SMALL FOR BOTH ──────────
       Below the floor there is no arrangement that gives a picking surface and a
       dismiss their own 44 inside one tile: subtract a 44 corner from a T×T tile
       and the largest square left is T − 44, so T has to reach 88, and 96 is the
       smallest rung on the dimension scale that does it. The component's answer
       for a smaller tile is deliberate and documented — the dismiss claims the
       whole tile, because a tap that might open and might delete depending on a
       few pixels of aim is worse than a tile that does one thing.

       BUT THAT ANSWER SILENTLY DROPS AN ACTION, and the author who wrote both
       controls is the one person who cannot see it happen: .pick is still in the
       markup, still focusable, still hovering on a desktop, and simply never
       answers a finger. So it is reported. Not an error — the degradation is the
       intended one and it is safe — but the fix is one class, and nobody would
       choose to lose the action if they knew. */
    [].slice.call(root.querySelectorAll('.thumb')).forEach(function (t) {
      /* Honoured here for the same reason iconScale honours it: a specimen whose
         POINT is to show the degradation is not an instance of it. */
      if (t.closest('[data-audit-skip]')) return;
      if (!t.querySelector(':scope > button.x')) return;
      if (!t.querySelector(':scope > button.pick')) return;
      if (t.classList.contains('lg')) return;
      const w = t.getBoundingClientRect().width;
      if (!w) return;
      const floor = parseFloat(win.getComputedStyle(doc.documentElement)
        .getPropertyValue('--size-touch-min')) || 44;
      if (w >= floor * 2) return;
      out.push({ severity: SEV.warn, el: t,
        rule: 'Thumbnail → both actions need the .lg rung',
        message: 'This tile carries BOTH a picking surface and a dismiss, and at ' +
                 Math.round(w) + 'px it cannot seat a ' + floor + 'px target for each — subtract a ' +
                 floor + ' corner and the largest square left for .pick is ' + Math.round(w - floor) +
                 'px. So on a coarse pointer the dismiss claims the whole tile and REMOVE becomes the ' +
                 'tile\u2019s only action: .pick keeps its focus stop and its hover, and never answers ' +
                 'a finger again. That is the intended degradation, not a bug \u2014 a tap that might ' +
                 'open and might delete depending on a few pixels of aim is worse. But if both actions ' +
                 'are genuinely needed under a finger, add .lg (96px, the smallest rung on the scale ' +
                 'where both fit) and the dismiss goes back to being a corner. Alternatively give ' +
                 'preview its own region or its own interaction, and leave the tile to remove.' });
    });

    /* ── SAFE AREA: THE PRECONDITION, AND THEN THE COVERAGE ──────────────────
       This check exists because the failure it catches already happened. The
       action bar read env(safe-area-inset-bottom) with a comment saying that
       without it the bar would sit under the home indicator — and no document in
       this repo sets viewport-fit=cover, so that env() had always resolved to 0
       and the guard had never once fired. A guard whose PRECONDITION is missing
       reads exactly like a guard that works, which is the whole reason to check
       the precondition separately from the rule.

       TWO DIFFERENT SEVERITIES, BECAUSE THEY ARE DIFFERENT CLAIMS.

       No viewport-fit=cover is a NOTE, not an error. Without it iOS shrinks the
       layout viewport to the safe region, so nothing can reach an unsafe edge and
       every inset rule in the system is correctly a no-op. Not opting in is safe —
       it just means no surface can bleed to the physical edge. The note says the
       rules are inert so nobody reads their presence as protection.

       With viewport-fit=cover it becomes an ERROR for an edge-pinned surface to
       carry no safe inset on the edge it touches, because now it genuinely paints
       under the hardware.

       PINNED IS MEASURED, NOT PARSED. A rule mentioning inset-block-end could be
       overridden, scoped to a media query that is not matching, or beaten by
       another sheet — so the test is where the box actually LANDS: fixed, and its
       own edge within a pixel of the viewport's. And the inset is detected by
       harvesting which SELECTORS carry a --safe-inset from the stylesheets and
       asking whether the element matches one, rather than by string-matching a
       computed value: calc() resolves to a plain length, so a padding that came
       from a safe inset and one that did not are indistinguishable after the
       cascade. Same reason the touch harvest reads rules rather than values. */
    const vpMeta = doc.querySelector('meta[name="viewport"]');
    const wantsCover = /viewport-fit\s*=\s*cover/i.test((vpMeta && vpMeta.content) || '');
    /* Selectors that carry a safe inset, and which EDGES each one covers. */
    const safeSel = [];
    [].slice.call(doc.styleSheets).forEach(function (sheet) {
      let rules; try { rules = sheet.cssRules; } catch (e) { return; }
      /* Handle the rule THEN recurse, never `return walk(...)` — the shape this
         file already marks WRONG at the top. A plain CSSStyleRule carries an empty
         but truthy `cssRules` since CSS nesting shipped, so returning early skips
         every declaration in the sheet and reports a confident zero. This check's
         first run did exactly that: 404 rules in components-extra.css, 0 found to
         mention --safe-inset, and both branches of the assertion silently wrong. */
      (function walk(list) {
        [].slice.call(list || []).forEach(function (r) {
          if (r.cssRules) walk(r.cssRules);
          if (!r.selectorText || !r.style) return;
          const txt = r.style.cssText || '';
          if (txt.indexOf('--safe-inset') === -1) return;
          const edges = {
            top:    /padding-(block-start|top)\s*:[^;]*--safe-inset-top/.test(txt) || /block-size[^;]*--safe-inset-top/.test(txt),
            bottom: /(padding-(block-end|bottom)|bottom)\s*:[^;]*--safe-inset-bottom/.test(txt),
            left:   /padding-(left|inline-start)\s*:[^;]*--safe-inset-left/.test(txt),
            right:  /padding-(right|inline-end)\s*:[^;]*--safe-inset-right/.test(txt)
          };
          safeSel.push({ sel: r.selectorText, edges: edges });
        });
      })(rules);
    });
    const coversEdge = function (el, edge) {
      return safeSel.some(function (e) {
        if (!e.edges[edge]) return false;
        try { return el.matches(e.sel); } catch (err) { return false; }
      });
    };
    /* STICKY COUNTS, NOT ONLY FIXED. A stuck element sits wherever its scrollport
       puts it, and a scrollport that reaches the bottom of the screen puts a
       bottom-stuck bar on the home indicator just as surely as position: fixed
       would. The first version of this check filtered on fixed alone, so every
       sticky bar in the system would have walked straight past it. The test below
       is where the box actually LANDS, which is the same test for both. */
    const pinned = [].slice.call(root.querySelectorAll('*')).filter(function (el) {
      const pos = getComputedStyle(el).position;
      if (pos !== 'fixed' && pos !== 'sticky') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    examined.pinnedSurfaces = pinned.length;
    if (!wantsCover) {
      /* GATED ON A SURFACE ACTUALLY BEING PINNED, so this is a nudge where it
         matters and silence where it does not. A page with nothing at a viewport
         edge has no stake in the safe area and does not need telling every run;
         a page WITH one does, because the rules that look like its protection are
         not doing anything yet. */
      if (safeSel.length && pinned.length) {
        out.push({ severity: SEV.warn, rule: 'Foundations → Layout · safe area is inert',
          message: 'The document has no viewport-fit=cover, so every env(safe-area-inset-*) ' +
                   'resolves to 0 and all ' + safeSel.length + ' safe-area rule(s) in the loaded ' +
                   'sheets are a no-op. That is SAFE — without cover the layout viewport is ' +
                   'already the safe region, so nothing can paint under the notch or the home ' +
                   'indicator. It is reported because the presence of those rules is not ' +
                   'protection on this document, and reading it as protection is the mistake ' +
                   'this check was written for. Add viewport-fit=cover to opt in to full-bleed ' +
                   'surfaces, at which point they start doing something and the coverage errors ' +
                   'below become live.' });
      }
    } else {
      pinned.forEach(function (el) {
        const r = el.getBoundingClientRect();
        /* AN EDGE IS ONLY TOUCHED BY A BOX THAT IS ACTUALLY IN THE VIEWPORT, which
           is why each test below pairs a "reaches the edge" half with an "intersects
           the viewport on that axis" half. The first version had the first half
           alone — `r.bottom >= innerHeight - 1` — and that is true of every pinned
           box BELOW the fold as well as every one sitting on the edge: a sticky
           cell 15,178px down the page reported as flush to the bottom of a 900px
           screen. It produced a false positive for all 25 sticky cells of a frozen
           data-grid column the first time the branch ever ran, because the branch
           is gated on viewport-fit=cover and no document in the library set it
           until this one. A one-sided comparison against a viewport edge is the
           bug to look for whenever a check has never had the chance to be wrong.

           Reaching PAST the edge still counts — a bar deliberately bled to
           `bottom: -10px` is on the indicator more than a flush one is — so the
           edge halves stay inequalities and the intersection halves are what
           excludes the out-of-view boxes. */
        const touching = [];
        if (r.top    <=              1 && r.bottom > 0)           touching.push('top');
        if (r.left   <=              1 && r.right  > 0)           touching.push('left');
        if (r.bottom >= win.innerHeight - 1 && r.top   < win.innerHeight) touching.push('bottom');
        if (r.right  >= win.innerWidth  - 1 && r.left  < win.innerWidth)  touching.push('right');
        const uncovered = touching.filter(function (edge) { return !coversEdge(el, edge); });
        if (!uncovered.length) return;
        out.push({ severity: SEV.error, el,
          rule: 'Foundations → Layout · clear the safe area',
          message: 'This pinned surface (fixed or sticky) is flush to the ' + uncovered.join(' and ') + ' edge of the ' +
                   'viewport and no rule gives it --safe-inset-' + uncovered[0] + '. The document ' +
                   'sets viewport-fit=cover, so that edge is the PHYSICAL one and the notch, the ' +
                   'rounded corner or the home indicator sits on top of whatever is there. Add the ' +
                   'inset to the consolidated safe-area block in components-extra.css rather than ' +
                   'to this component — the value of that block is being the one place the ' +
                   'question "is anything still unhandled?" can be answered. Pad the surface, do ' +
                   'not move it: shifting it inward leaves a strip of page showing at the edge.' });
      });
    }

    /* AN EMPTY RUN IS NOT A PASS. The same trap QDS_LINT documents, and one this
       gate walks into more easily: it is meant to be pointed at a scope, and a
       scope that matched nothing returns a clean sheet that looks exactly like a
       clean page. Reported as a finding rather than a note, so it cannot be
       skimmed past \u2014 the first scoped run of this gate examined two targets
       and zero surfaces and said "0 errors". */
    if (coarse && examined.targets === 0) {
      out.push({ severity: SEV.warn, rule: 'QDS_MOBILE \u00b7 coverage',
        message: 'No interactive targets were found in this scope, so the touch-target check ' +
                 'passed against nothing. Check the scope is the one you meant.' });
    }
    if (narrow && examined.surfaces === 0) {
      out.push({ severity: SEV.warn, rule: 'QDS_MOBILE \u00b7 coverage',
        message: 'No padded surfaces were found in this scope, so the outer-inset check passed ' +
                 'against nothing. Check the scope is the one you meant.' });
    }

    const counts = { error: 0, warn: 0 };
    out.forEach(f => { counts[f.severity]++; });
    const result = { ran: true, passed: counts.error === 0, viewport: win.innerWidth,
      conditions: { narrow: narrow, coarse: coarse }, examined: examined,
      counts: counts, findings: out };
    if (typeof console !== 'undefined' && console.log) {
      console.log('QDS_MOBILE \u2014 viewport ' + innerWidth + 'px, narrow=' + narrow + ', coarse=' + coarse);
      console.log('  examined ' + examined.targets + ' target(s), ' + examined.surfaces +
        ' surface(s), ' + examined.pinnedSurfaces + ' edge-pinned surface(s)');
      console.log('  ' + counts.error + ' error(s), ' + counts.warn + ' warning(s)');
      if (!narrow) console.log('  NOTE: viewport is above ' + TURN_PX + ' \u2014 layout rules were not checked.');
      if (!coarse) console.log('  NOTE: pointer is not coarse \u2014 touch targets were not checked.');
    }
    return result;
  }

  /* ══ THE SPECIMEN FRAMES ═══════════════════════════════════════════════
     Every mobile specimen in this system is a QDS_PHONE iframe, and an iframe is
     a different document: root.querySelectorAll never reaches into one, so the
     frames that carry the only accurate mobile geometry in the storybook were the
     one place nothing was ever checked. Two Phase 6B defects lived there for the
     life of the system and were found by hand.

     Discovery is by the data-qds-phone marker rather than by sniffing srcdoc, so
     an application iframe that happens to sit in a story is never swept.

     READINESS IS CHECKED, NOT ASSUMED, and a frame that is not ready is REPORTED
     rather than skipped quietly — a sweep that silently ignores half the frames is
     the same false pass this file already refuses elsewhere. QDS_PHONE marks its
     frames loading="lazy", so one that has never been scrolled into view holds an
     empty about:blank document; that is a normal state, not an error, and it is
     named in the result so a clean run cannot hide it. The signal is deterministic
     — readyState, a rendered body, a readable stylesheet — never a timeout. */
  function frames(scope) {
    const host = typeof scope === 'string' ? document.querySelector(scope) : (scope || document);
    const list = [];
    if (!host) return list;
    const nodes = (host.querySelectorAll ? host : document).querySelectorAll('iframe[data-qds-phone]');
    [].slice.call(nodes).forEach(function (fr) {
      let doc = null, win = null, why = null;
      try { doc = fr.contentDocument; win = fr.contentWindow; }
      catch (e) { why = 'cross-origin — not auditable'; }
      if (!why && (!doc || !win)) why = 'no document';
      if (!why && doc.readyState !== 'complete') why = 'still loading (readyState ' + doc.readyState + ')';
      if (!why && (!doc.body || doc.body.children.length === 0))
        why = 'not rendered — loading="lazy" and never scrolled into view';
      if (!why) {
        let readable = 0;
        try {
          [].slice.call(doc.styleSheets).forEach(function (sh) {
            try { if (sh.cssRules) readable++; } catch (e) {}
          });
        } catch (e) {}
        if (!readable) why = 'no readable stylesheet — computed styles would be meaningless';
      }
      list.push({ frame: fr, title: fr.getAttribute('title') || '(untitled)',
                  doc: doc, win: win, ready: !why, why: why });
    });
    return list;
  }

  /* One call that audits the page AND its specimens. The frame runs the same
     lint() and mobileAudit() re-pointed at its own document — no second
     implementation, and no check re-typed for the frame case. */
  function sweep(scope) {
    const rootLint = lint(scope);
    const rootMobile = mobileAudit(scope);
    const found = frames(scope);
    const audited = [], pending = [];
    found.forEach(function (f) {
      if (!f.ready) { pending.push({ title: f.title, why: f.why }); return; }
      const ctx = { doc: f.doc, win: f.win, frame: true };
      const l = lint(f.doc.body, ctx);
      const m = mobileAudit(f.doc.body, ctx);
      audited.push({
        title: f.title,
        viewport: f.win.innerWidth + 'x' + f.win.innerHeight,
        coarse: f.doc.documentElement.getAttribute('data-pointer') === 'coarse',
        lint: l, mobile: m,
        errors: l.counts.error + ((m.findings || []).filter(function (x) {
          return x.severity === SEV.error; }).length)
      });
    });
    const frameErrors = audited.reduce(function (n, a) { return n + a.errors; }, 0);
    return {
      passed: rootLint.counts.error === 0 && frameErrors === 0,
      root: { lint: rootLint, mobile: rootMobile },
      frames: audited,
      framesPending: pending,
      totals: {
        rootErrors: rootLint.counts.error,
        frameErrors: frameErrors,
        framesAudited: audited.length,
        framesPending: pending.length
      }
    };
  }

  window.QDS_FRAMES = frames;
  window.QDS_SWEEP = sweep;
  window.QDS_LINT = lint;
  window.QDS_MOBILE = mobileAudit;
})();
