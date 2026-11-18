#!/usr/bin/env node
/**
 * ci-check-var-resolves.mjs — the phantom `var()` gate (#452).
 *
 * Two bugs shipped in the same week and they were the same bug. An unresolved
 * `var()` with no fallback does not fall back: per CSS Variables §3.2 it makes
 * the declaration *invalid at computed-value time*, and the element loses the
 * property altogether.
 *
 *     font-family: var(--font-mono), monospace;   →  #450: rendered SANS
 *     background:  var(--accentColor);            →  #460: rendered NOTHING
 *
 * Read as source, both lines are correct, and that is the trap. `--font-mono`
 * is defined by Astro's `<Font>` component, which was rendered nowhere, so six
 * declarations quietly inherited sans and the brand's shell prompt stopped
 * being monospace. `--accentColor` comes from `define:vars` on a parent
 * component's `<style>`, which reaches that component's own template and not
 * its children, so on twelve vertical routes the primary CTA's background
 * vanished while its hard-coded white label did not: white on a white panel.
 *
 * Nothing in CI could see either. `ci-check-design-tokens.py` scans CSS as
 * text — it never starts a browser and never resolves a `var()`, so it is
 * blind to this class by construction, not by omission. And axe reported zero
 * contrast violations on all twelve routes, correctly: the button did not
 * become illegible, it became *absent*, and absence is not a contrast failure.
 *
 * So this gate asks the only authority that can answer, the rendered page:
 *
 *   G1  every custom property a matching rule references must RESOLVE on the
 *       elements that rule matches, on every route where it matches.
 *
 *   G2  a `var()` whose property is not declared on `:root` must carry a
 *       fallback. Those are precisely the runtime-injected ones — `define:vars`,
 *       inline `style=`, a component that may not have rendered — the ones
 *       whose presence is a *timing* question rather than a spelling one.
 *       G1 detects; G2 makes the worst case ink instead of nothing.
 *
 * G2 is deliberately not "every `var()` needs a fallback". `--color-primary`
 * is declared on `:root` in theme.css and resolves everywhere by construction;
 * demanding a fallback there is churn that trains readers to skip the rule.
 *
 * Usage: node scripts/ci-check-var-resolves.mjs [base-url]   default :8787
 */
import puppeteer from "puppeteer";
import { seedRoutes } from "./lib/seed-routes.mjs";
import { cdpDiagnosis, stackDiagnosis } from "./lib/stack-probe.mjs";
import { HOST_NEUTRAL } from "./lib/host-neutral.mjs";

const BASE = (process.argv[2] || "http://localhost:8787").replace(/\/$/, "");

const fail = (m) => { console.error(`✗ ${m}`); };
const ok = (m) => console.log(`✓ ${m}`);

process.on("unhandledRejection", async (e) => {
	console.error(await stackDiagnosis(BASE).catch(() => cdpDiagnosis(e)));
	process.exit(3);
});

/**
 * Everything below runs INSIDE the page, because everything below is a
 * question only the CSSOM can answer: which rules exist after the cascade,
 * which of them match something here, and what a custom property computes to
 * on that element.
 */
const AUDIT = () => {
	// `var( --x , fallback )` — the name, and whether a comma follows it at
	// depth 0. Nesting matters: `var(--a, var(--b))` has a fallback, and the
	// inner `--b` is its own reference with none.
	const refs = (value) => {
		const out = [];
		for (let i = 0; (i = value.indexOf("var(", i)) !== -1; i += 4) {
			let depth = 1, j = i + 4, comma = -1;
			while (j < value.length && depth > 0) {
				const c = value[j];
				if (c === "(") depth++;
				else if (c === ")") depth--;
				else if (c === "," && depth === 1 && comma === -1) comma = j;
				j++;
			}
			const head = value.slice(i + 4, comma === -1 ? j - 1 : comma).trim();
			if (/^--[\w-]+$/.test(head)) out.push({ name: head, fallback: comma !== -1 });
		}
		return out;
	};

	/**
	 * Declarations are read from `cssText`, NOT by iterating `rule.style`, and
	 * that is the whole reason this gate can see #460.
	 *
	 * A shorthand whose value contains a `var()` is stored as a
	 * *pending-substitution value*: `background: var(--accentColor)` makes
	 * `rule.style` list all nine background longhands and return the EMPTY
	 * STRING for every one of them. The authored `var()` is nowhere in the
	 * object model. The first draft of this gate iterated `rule.style` and was
	 * therefore blind to precisely the shape that motivated it — caught by the
	 * positive control below, which is the argument for having one.
	 *
	 * `cssText` keeps what was written. Split the block on `;` at paren depth
	 * zero (so a `data:` URI or a nested `var()` survives), then on the first
	 * `:` at depth zero.
	 */
	const declarations = (cssText) => {
		const open = cssText.indexOf("{");
		const close = cssText.lastIndexOf("}");
		if (open === -1 || close <= open) return [];
		const body = cssText.slice(open + 1, close);
		const out = [];
		let depth = 0, start = 0;
		const push = (chunk) => {
			const text = chunk.trim();
			if (!text) return;
			let d = 0, colon = -1;
			for (let i = 0; i < text.length; i++) {
				const c = text[i];
				if (c === "(") d++;
				else if (c === ")") d--;
				else if (c === ":" && d === 0) { colon = i; break; }
			}
			if (colon === -1) return;
			out.push({ prop: text.slice(0, colon).trim(), value: text.slice(colon + 1).trim() });
		};
		for (let i = 0; i < body.length; i++) {
			const c = body[i];
			if (c === "(") depth++;
			else if (c === ")") depth--;
			else if (c === ";" && depth === 0) { push(body.slice(start, i)); start = i + 1; }
		}
		push(body.slice(start));
		return out;
	};

	// Flatten @media / @supports / @layer. A rule inside a media query that
	// does not currently apply still matters: it applies at another width, and
	// the gate runs at more than one.
	const rules = [];
	const walk = (list, sheetHref) => {
		for (const r of list) {
			if (r.cssRules && !r.selectorText) { walk(r.cssRules, sheetHref); continue; }
			if (r.selectorText && r.style) rules.push({ rule: r, href: sheetHref });
		}
	};
	for (const sheet of document.styleSheets) {
		let list;
		try { list = sheet.cssRules; } catch { continue; }   // cross-origin, not ours
		if (list) walk(list, sheet.href || "inline");
	}

	// Every custom property any stylesheet DECLARES, anywhere — not just on
	// `:root`. A property declared in a rule cannot go missing because a
	// template forgot to emit it; whether that rule matches is G1's question,
	// not G2's. What is left after removing these is precisely the set whose
	// only provider is an inline `style=` or a `define:vars` — where presence
	// is a timing question, and where #450 and #460 both lived.
	const declaredInCss = new Set();
	for (const { rule } of rules)
		for (const { prop } of declarations(rule.cssText))
			if (prop.startsWith("--")) declaredInCss.add(prop);

	const rootStyle = getComputedStyle(document.documentElement);
	const provided = (name) =>
		declaredInCss.has(name) || rootStyle.getPropertyValue(name).trim() !== "";

	// EmDash ships its own comment and form components from node_modules, with
	// their own `--ec-*` properties. Their contract is theirs; a fallback we
	// invented would be a house value silently overriding a vendor default the
	// next time they define one. G1 still watches them — if one of those rules
	// ever matches an element here and its property is missing, that is a real
	// broken render and it gets reported. G2 is the authoring rule, and we do
	// not author them.
	const foreign = (name) => name.startsWith("--ec-");

	const unresolved = [];   // G1
	const noFallback = [];   // G2
	const seen = new Set();

	// `getComputedStyle` is cheap to call and expensive to *read*: every
	// `getPropertyValue` on a fresh declaration can force a style recalc, and
	// 633 rules × a few elements each was enough to blow puppeteer's protocol
	// timeout. Cache per element, and per property within it — rules overlap
	// heavily, so the same `--cc` gets asked of the same `<a>` many times.
	const styleCache = new WeakMap();
	const resolves = (el, name) => {
		let byName = styleCache.get(el);
		if (!byName) { byName = new Map(); styleCache.set(el, byName); }
		if (!byName.has(name)) {
			if (!byName.has("@cs")) byName.set("@cs", getComputedStyle(el));
			byName.set(name, byName.get("@cs").getPropertyValue(name).trim() !== "");
		}
		return byName.get(name);
	};

	for (const { rule, href } of rules) {
		const decls = [];
		for (const { prop, value } of declarations(rule.cssText)) {
			const r = refs(value);
			if (r.length) decls.push({ prop, value, refs: r });
		}
		if (!decls.length) continue;

		// G2 first: it is a property of the rule, not of any element, so it
		// does not need the selector to match anything on this route.
		for (const d of decls) {
			for (const r of d.refs) {
				if (r.fallback || provided(r.name) || foreign(r.name)) continue;
				const key = `G2|${rule.selectorText}|${d.prop}|${r.name}`;
				if (seen.has(key)) continue;
				seen.add(key);
				noFallback.push({ selector: rule.selectorText, prop: d.prop, name: r.name, href });
			}
		}

		let els;
		try { els = document.querySelectorAll(rule.selectorText); } catch { continue; }
		if (!els.length) continue;   // does not match here; another route may

		// One element is enough to decide resolution for this rule on this
		// route: custom properties inherit, and a rule that matches many
		// elements with different ancestors is exactly what the loop below
		// would have to enumerate. Check the first few, not all of them —
		// `main h2` matches 37 elements and they share their ancestry.
		for (const el of [...els].slice(0, 3)) {
			for (const d of decls) {
				for (const r of d.refs) {
					if (resolves(el, r.name)) continue;
					if (r.fallback) continue;   // degrades to the fallback: survivable
					const key = `G1|${rule.selectorText}|${d.prop}|${r.name}`;
					if (seen.has(key)) continue;
					seen.add(key);
					unresolved.push({
						selector: rule.selectorText, prop: d.prop, name: r.name,
						value: d.value, href,
						sample: el.tagName.toLowerCase() + (el.className && typeof el.className === "string"
							? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""),
					});
				}
			}
		}
	}
	return { unresolved, noFallback, ruleCount: rules.length };
};

/* ---------------------------------------------------------------- positive control
 *
 * Before it trusts a clean site, the gate plants the two bugs it exists to
 * catch — as *shapes*, on a throwaway page — and asserts it still finds them.
 * A gate that cannot re-find its own motivating defect is not green, it is
 * blind, and the exit code says which (3 vs 1).
 *
 * The stronger control is not here because it cannot be: reverting #450's
 * `<Font>` render and #460's accent fallbacks on a scratch commit and watching
 * this gate go red. That was run by hand when the gate was written, and the
 * output is in the pull request. */
async function positiveControl(browser) {
	const page = await browser.newPage();
	await page.setContent(`<!doctype html><html><head><style>
		:root { --real: #1e1e1e; }
		.plant-a { background: var(--never-defined); }              /* G1 + G2 */
		.plant-b { color: var(--outer-has-one, var(--inner-has-none)); }   /* the inner ref is its own reference */
		.plant-c { border-color: var(--real); }                     /* clean: on :root */
		.plant-d { outline-color: var(--nope, red); }               /* clean: has a fallback */
		.plant-e { --in-a-rule: #333; }                             /* declared in an ordinary rule … */
		.plant-e { text-decoration-color: var(--in-a-rule); }       /* … so this needs no fallback */
	</style></head><body>
		<div class="plant-a"></div><div class="plant-b"></div>
		<div class="plant-c"></div><div class="plant-d"></div><div class="plant-e"></div>
	</body></html>`);
	const r = await page.evaluate(AUDIT);
	await page.close();

	const blind = [];
	const g1 = r.unresolved.map((u) => u.name);
	const g2 = r.noFallback.map((u) => u.name);

	if (!g1.includes("--never-defined"))
		blind.push("G1 did not report `background: var(--never-defined)` on a matching element — this is #460's shape");
	if (!g2.includes("--never-defined"))
		blind.push("G2 did not report `var(--never-defined)` as lacking a fallback");
	if (!g2.includes("--inner-has-none"))
		blind.push("G2 did not look inside `var(--outer-has-one, var(--inner-has-none))` — a fallback that is itself " +
			"an undefined `var()` is not a fallback, and the nesting is where that hides");
	if (g2.includes("--in-a-rule"))
		blind.push("a property declared in an ordinary rule (not `:root`) was reported — G2 must only flag " +
			"properties whose sole provider is a template");
	if (g2.includes("--outer-has-one"))
		blind.push("`var(--outer-has-one, …)` was reported despite carrying a fallback — the depth-0 comma scan is wrong");
	if (g1.includes("--real") || g2.includes("--real"))
		blind.push("a property declared on `:root` was reported as missing — the gate's notion of `resolves` is wrong");
	if (g1.includes("--nope") || g2.includes("--nope"))
		blind.push("`var(--nope, red)` was reported despite carrying a fallback — the fallback parser is wrong");

	if (blind.length) {
		console.error("✗ the gate is blind, so its green means nothing:");
		for (const b of blind) console.error(`    ${b}`);
		process.exit(3);
	}
	ok("5 planted defects judged correctly — an undefined var, a nested one, and three clean controls it left alone");
}

/* ------------------------------------------------------------------------- run */
const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", ...HOST_NEUTRAL], protocolTimeout: 300_000 });
await positiveControl(browser);

const routes = seedRoutes();
// Both widths: a rule inside a `@media` block matches elements at one width
// and not the other, and #451's whole subject lived in those blocks.
const WIDTHS = [1440, 390];

const g1 = [];
const g2 = new Map();
let rulesSeen = 0;

for (const width of WIDTHS) {
	for (const route of routes) {
		const page = await browser.newPage();
		await page.setViewport({ width, height: 900, isMobile: width < 768, hasTouch: width < 768 });
		await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 60_000 });
		await page.evaluate(() => document.fonts.ready);
		const r = await page.evaluate(AUDIT);
		rulesSeen = Math.max(rulesSeen, r.ruleCount);
		for (const u of r.unresolved) g1.push({ ...u, route, width });
		for (const u of r.noFallback) {
			const key = `${u.selector}|${u.prop}|${u.name}`;
			if (!g2.has(key)) g2.set(key, u);
		}
		await page.close();
	}
}
await browser.close();

let bad = false;

if (g1.length) {
	bad = true;
	fail(`${g1.length} declaration(s) reference a custom property that does not resolve where the rule matches.`);
	console.error("  An unresolved `var()` with no fallback drops the WHOLE declaration (#450, #460):");
	for (const u of g1) {
		console.error(`    ${u.route} @${u.width}  ${u.selector} { ${u.prop}: ${u.value} }`);
		console.error(`        \`${u.name}\` is empty on <${u.sample}>  —  ${u.href}`);
	}
} else {
	ok(`every \`var()\` resolves where its rule matches — ${routes.length} routes × ${WIDTHS.length} widths, ${rulesSeen} rules`);
}

if (g2.size) {
	bad = true;
	fail(`${g2.size} \`var()\` reference(s) to a property no stylesheet declares, with no fallback.`);
	console.error("  No stylesheet declares these: their only provider is a template — an inline `style=` or a");
	console.error("  `define:vars`. If the template stops emitting one, the whole declaration dies (#450, #460).");
	console.error("  A fallback makes the worst case a default instead of nothing:");
	for (const u of g2.values()) {
		const where = u.href === "inline" ? "inline <style>" : u.href.replace(/^.*\//, "");
		console.error(`    ${where}  ${u.selector} { ${u.prop}: … var(${u.name}) … }`);
	}
	console.error("  Give each one a fallback that is right for ITS property — a colour token for a colour,");
	console.error("  `0s` for a delay, `0` for an index. The point is that the declaration survives, not that");
	console.error("  it looks the same.");
} else {
	ok("no runtime-injected `var()` is used without a fallback");
}

process.exit(bad ? 1 : 0);
