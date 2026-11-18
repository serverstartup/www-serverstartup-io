#!/usr/bin/env node
/**
 * ci-check-a11y.mjs — the accessibility gate (#343).
 *
 * Lighthouse already scores a11y 100 on the audited routes, and that number
 * did not stop two real WCAG failures shipping on 2026-08-20: a search control
 * unreachable by keyboard (2.1.1) and a document-wide `/` shortcut (2.1.4).
 * Automated rule engines cover roughly a third of the criteria; this gate adds
 * the checks that live in the other two thirds and that a browser can actually
 * decide — traversal, focus visibility, obscuring, reflow, shortcut scoping.
 *
 * It runs against an already-booted stack (the gate runner boots one for the
 * HTML and header checks; this reuses it) and fails loudly, naming the route
 * and the element.
 *
 * Usage: node scripts/ci-check-a11y.mjs [base-url]      default http://localhost:8787
 */
import puppeteer from "puppeteer";
import { createRequire } from "node:module";
import { availableParallelism } from "node:os";
import { entryPath, readSeed, seedRoutes } from "./lib/seed-routes.mjs";
import { cdpDiagnosis, stackDiagnosis } from "./lib/stack-probe.mjs";
import { HOST_NEUTRAL } from "./lib/host-neutral.mjs";

const BASE = (process.argv[2] || "http://localhost:8787").replace(/\/$/, "");

// Without this, a stack that dies mid-run surfaces as a raw puppeteer stack
// trace: a navigation timeout, or a socket error, at whichever route happened
// to be next. Nothing in that output says the server is gone, so the reader
// starts by suspecting their own change (#390). Answer the question here, once.
//
// BOTH events, and that is not belt-and-braces: a rejected top-level `await`
// in the entry module does NOT reach `unhandledRejection`. Measured — with
// only that hook registered, killing the stack still printed a bare puppeteer
// trace and Node's default handler took the process down.
const explainStackDeath = async (error) => {
	// The stack trace stays. This hook exists to ADD the one fact the trace
	// never carries; swallowing the trace would trade one blind spot for another
	// on every failure that is not a dead stack.
	console.error(`\nERROR: ${error?.stack ?? error}`);
	console.error(
		(await stackDiagnosis(BASE)) ||
			cdpDiagnosis(error) ||
			"  The stack IS answering, so a dead stack is not the cause.",
	);
	process.exit(2);
};
process.on("unhandledRejection", explainStackDeath);
process.on("uncaughtException", explainStackDeath);
const require = createRequire(import.meta.url);
const axeSource = require("fs").readFileSync(
	require.resolve("axe-core/axe.min.js"),
	"utf8",
);

/**
 * Routes worth auditing: all of them, both locales, derived from the same seed
 * the sitemap and the copy baseline read.
 *
 * #343 asked for the whole site traversable by keyboard, "en las 12 rutas y
 * los dos idiomas". The hand-written list this replaces had ten entries, eight
 * of them ES: both legal pages, the AI vertical and nine of the thirteen EN
 * routes were never audited, and a list of routes tells you nothing about the
 * routes it omits. Deriving it means the audit cannot fall behind the next
 * page the way a transcribed list does — and the count stops being a number
 * anyone has to keep true.
 *
 * The derivation itself lives in `lib/seed-routes.mjs`, shared with the copy
 * baseline: two copies of it meant a change to the seed's shape had to be
 * caught, and fixed, twice.
 */
function auditRoutes() {
	// The search results page is declared by no collection, and it is where both
	// WCAG failures of 2026-08-20 lived (2.1.1 and 2.1.4).
	//
	// The 404 is declared by no collection either, and it is in no sitemap by
	// design — so nothing derived from the seed will ever reach it, and #418
	// gave it markup of its own (a console window whose forty frames are the
	// widest text on the site). Naming it here is what keeps it audited: axe,
	// keyboard traversal, 1.4.10 reflow and image aspect ratio all read this
	// list. Both locales, because the page picks its language off the missed
	// path and that is exactly the part that can regress.
	return [
		...seedRoutes(),
		"/search?q=cloudflare",
		"/en/search?q=cloudflare",
		"/404",
		"/en/404",
	].sort();
}

const ROUTES = auditRoutes();

/**
 * axe runs on every audited route. It did not always: until #387 the list was
 * a sample of ten, because widening it surfaced four real `color-contrast`
 * failures (WCAG 1.4.3) that were not the gate's to decide. Three of the greys
 * belonged to the foreign chrome those instruments imitate — Google's BigQuery
 * console and a javadoc page — and the fourth was the house muted ink used on
 * a dark bar it was never measured against.
 *
 * The founder's call (2026-08-25) was to raise all four to the smallest value
 * that clears AA, on the reasoning that fidelity here meant reproducing an
 * interface that fails AA itself. So the sample has no reason to exist, and
 * the audit is the full route list again.
 *
 * Do not narrow it back to make a failure go away. A route dropped from this
 * list is a route nobody checks, and the drop leaves no trace in a green run.
 */
const AXE_ROUTES = ROUTES;

// Positive control on the list itself (#385). The founder named twelve routes
// per locale; the seed declares thirteen. A parse that silently returned fewer
// would shrink the audit without shrinking any of its green lines.
if (ROUTES.length < 24) {
	console.error(`✗ THIS GATE IS BLIND — auditRoutes() enumerated ${ROUTES.length} route(s) ` +
		"from seed/seed.json, below the 12-per-locale floor #343 asks for.");
	console.error("  → the seed's shape or collection names changed; fix auditRoutes().");
	process.exit(3);
}

/** Reveal animations must finish before geometry is read — measuring during a
 *  transition reports the start frame and makes working code look broken. */
const SETTLE_MS = 400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


/**
 * What the traversal asks about the focused element. A named function, not an
 * inline arrow, so the positive control can run the SAME probe over a page it
 * builds itself — a control that reimplements the predicate agrees with its
 * own copy, never with the gate.
 */
const FOCUS_PROBE = () => {
	const el = document.activeElement;
	if (!el || el === document.body) return null;
	const r = el.getBoundingClientRect();
	const h = document.querySelector(".site-header")?.getBoundingClientRect();
	const cs = getComputedStyle(el);
	return {
		name: el.tagName.toLowerCase() + "." + (el.className.toString().split(" ")[0] || ""),
		offscreen: r.width === 0 && r.height === 0,
		// obscured = overlapped by the fixed header while not part of it
		obscured: !!h && r.top < h.bottom && r.bottom > h.top && !el.closest(".site-header"),
		ring: cs.outlineStyle !== "none" && cs.outlineWidth !== "0px",
	};
};

/**
 * What the aspect-ratio check measures (#416).
 *
 * A stretched logo is not a rounding error, it is a different logo. The one
 * that shipped was two correct rules meeting: the global `img { max-width:
 * 100% }` clamped the width, a declared `height` held, and a 480×120 mark
 * rendered 105×32 on a phone. No rule engine decides this and no static
 * stylesheet read can either — it depends on how wide the container came out.
 *
 * Only `object-fit: fill` (the initial value) can distort. `cover`, `contain`,
 * `scale-down` and `none` crop, letterbox or overflow — never squash — so a
 * deliberate crop must not be reported as a defect.
 */
const RATIO_PROBE = () => {
	const out = [];
	for (const img of document.querySelectorAll("img")) {
		// naturalWidth is 0 for an unloaded image and for an SVG with no
		// intrinsic size: nothing to compare against, not a finding.
		if (!img.naturalWidth || !img.naturalHeight) continue;
		const cs = getComputedStyle(img);
		if (cs.objectFit !== "fill") continue;
		// the layout box, not the bounding rect: a rotation (#531, the bridge is
		// turned 6°) widens the bounding rect without squashing anything, and
		// only the box the image is laid out into can distort it
		const r = { width: parseFloat(cs.width), height: parseFloat(cs.height) };
		if (!(r.width >= 1) || !(r.height >= 1)) continue;
		const nat = img.naturalWidth / img.naturalHeight;
		const skew = Math.abs(nat - r.width / r.height) / nat;
		// 2%: below it lies subpixel layout, above it lies a visible squash
		if (skew <= 0.02) continue;
		out.push({
			src: (img.currentSrc || img.src).replace(location.origin, "").slice(-48),
			nat: `${img.naturalWidth}×${img.naturalHeight}`,
			box: `${Math.round(r.width)}×${Math.round(r.height)}`,
			pct: Math.round(skew * 100),
		});
	}
	return out;
};

/** What the 1.4.10 check measures — same reason it is named. */
const REFLOW_PROBE = () => {
	const de = document.documentElement;
	const over = [...document.querySelectorAll("*")]
		.filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== "auto")
		.map((e) => e.tagName.toLowerCase() + "." + (e.className.toString().split(" ")[0] || ""))
		.slice(0, 3);
	return { doc: de.scrollWidth, view: de.clientWidth, over };
};

const failures = [];
const fail = (route, msg) => failures.push(`${route}: ${msg}`);
const ok = (msg) => console.log(`  ok   ${msg}`);

/**
 * Bounded concurrency over a route list, with the output of a sequential run.
 *
 * #522. Five loops below were 222 s of this gate's 258 s and all five had one
 * shape: open a page, visit one route, measure, close, next — one page in
 * flight on a runner doing nothing else. #515 had just made this gate the only
 * thing the whole run waits for, so that idleness became the critical path.
 *
 * Two properties are load-bearing and neither is a nicety:
 *
 * ORDER. A worker never calls `ok`/`fail`. It gets a `report` whose lines are
 * buffered and replayed in INPUT order once every lane has finished, so the
 * log and the failure list come out byte for byte as the sequential run wrote
 * them. A CI log that reshuffles itself run to run cannot be diffed against
 * the last green one, and that diff is how a reader separates a new failure
 * from one that was already there.
 *
 * NO RETRY. A lane that throws takes the run down exactly as the `for` loop
 * did: the rejection still reaches `explainStackDeath`, which still answers
 * "was the stack alive?" before anyone blames the diff (#390). Catching here
 * would turn the flake it exists to explain into a green.
 *
 * The pool size is the one number worth tuning. `A11Y_CONCURRENCY=1` restores
 * the sequential run exactly, which is how this change was verified: same
 * stack, same bytes.
 *
 * The default is derived rather than picked. Four lanes on a sixteen-core
 * laptop and four lanes on a two-core runner are not the same request, and the
 * far end of both is ONE `wrangler dev` — a single process rendering every
 * route, which is as likely to be the ceiling here as the browser is. Cap at
 * four: past that the lanes queue on the stack instead of on the CPU, and a
 * navigation that waits long enough fails as a timeout rather than as a slow
 * route.
 */
const CONCURRENCY = Math.max(
	1,
	Number(process.env.A11Y_CONCURRENCY) || Math.min(4, availableParallelism()),
);
const inParallel = async (items, worker) => {
	const buffered = items.map(() => []);
	const results = new Array(items.length);
	let next = 0;
	await Promise.all(
		browsers.slice(0, Math.min(CONCURRENCY, items.length)).map(async (lane) => {
			// `next++` between awaits is atomic here — one thread, one claim.
			for (let i = next++; i < items.length; i = next++) {
				const lines = buffered[i];
				results[i] = await worker(items[i], lane, {
					ok: (msg) => lines.push({ msg }),
					fail: (route, msg) => lines.push({ route, msg }),
				});
			}
		}),
	);
	for (const lines of buffered) {
		for (const line of lines) {
			if (line.route === undefined) ok(line.msg);
			else fail(line.route, line.msg);
		}
	}
	return results;
};

/**
 * ONE BROWSER PER LANE, not one page per lane (#522).
 *
 * Chrome shows one page of a browser at a time: every other page reports
 * `document.visibilityState === "hidden"`, is given no animation frames, and
 * therefore does not advance a CSS transition. Measured on CI at pool 4 — the
 * skip link sat at `matrix(1, 0, 0, 1, 0, -96)`, the full `translateY(-200%)`,
 * with `focus=true` and `anims=running`: focused, animating, and frozen on its
 * first frame, so the gate reported a link that "never became visible" on four
 * routes that are fine. Three attempts to wait more cleverly all failed for the
 * same reason — no wait helps a clock that is not running, and `polling: "raf"`
 * cannot poll a page that is given no frames.
 *
 * The three `--disable-*-backgrounding` flags are the obvious answer and were
 * tried first; they do not help, because the page is not backgrounded, it is
 * hidden — a different state, and not one a launch flag turns off. So they are
 * not here.
 *
 * A browser with one page always shows it. Every lane then measures the page
 * the sequential run measured, which is what makes the byte-for-byte identity
 * at `A11Y_CONCURRENCY=1` worth anything at pool 4 as well. The cost is four
 * Chromes instead of one: ~90 MB of RSS each on the runner, against a job that
 * has 7 GB and was never near it.
 */
const LAUNCH = {
	headless: "new",
	args: [
		"--no-sandbox",
		"--disable-dev-shm-usage",
		...HOST_NEUTRAL,
	],
	// Puppeteer 23.11.1 defaults this to 180 000 ms, and a loaded machine can
	// spend all three minutes of it not answering one CDP call (#425). Raised,
	// not removed: a browser that is genuinely hung still fails the run, and a
	// retry — the other obvious move — is how a flake becomes invisible.
	protocolTimeout: 300_000,
};
const browsers = await Promise.all(
	Array.from({ length: CONCURRENCY }, () => puppeteer.launch(LAUNCH)),
);
// The sequential phases and every positive control run on the first one.
const browser = browsers[0];


// ── Measuring ink against a ground no library can read ─────────────────────
// Two sections below paint text over a drawn SVG. axe refuses those by
// design: `color-contrast` returns INCOMPLETE with "background color could
// not be determined due to a background image", which is honest and useless.
// These two helpers are the substitute — run in the page, not in node.
//
// `readBoxes` collects every visible text box with its ink and the ratio
// 1.4.3 owes it; `worstAgainst` decodes a screenshot taken with the ink
// blanked and reports the worst ground behind each box.
const readBoxes = (sel) => {
	const srgb = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
	const out = [];
	for (const el of document.querySelectorAll(sel)) {
		const cs = getComputedStyle(el);
		if (cs.display === "none" || cs.visibility === "hidden") continue;
		// The hero stacks its six frames in one grid cell and fades between
		// them; the five that are not showing are still laid out. Measuring
		// ink nobody can see would report failures nobody can hit.
		if (Number(cs.opacity) < 0.9) continue;
		const r = el.getBoundingClientRect();
		if (r.width < 2 || r.height < 2) continue;
		if (r.bottom <= 0 || r.top >= innerHeight) continue;
		// placeholder ink, when that is the only text the element shows
		const raw = el.tagName === "INPUT" && !el.value
			? getComputedStyle(el, "::placeholder").color || cs.color
			: cs.color;
		const m = raw.match(/[\d.]+/g);
		if (!m) continue;
		const [r8, g8, b8] = m.slice(0, 3).map(Number);
		// The ALPHA, which this used to throw away. `--color-hero-ink-soft` is
		// rgba(255,255,255,.82) — the hero's kicker, and the menu's too until
		// #431 put that panel back on paper and opaque ink — and read as solid
		// white it scores about a third more contrast than a reader ever sees,
		// which is a gate signing off on copy that fails. Every tint on the
		// open panel is still translucent, so this stays where it is. It is
		// composited over whatever pixel wins the percentile, below.
		const alpha = m.length > 3 ? Number(m[3]) : 1;
		// Borders and underlines are DECORATION, not the ground the glyphs sit
		// on: `.s-hero__name` wears a 1px rule in its vertical's colour, and a
		// box that includes it reads that colour as the background. Inset by
		// the border, plus a pixel of antialiasing and three at the baseline.
		const bl = parseFloat(cs.borderLeftWidth) || 0, bt = parseFloat(cs.borderTopWidth) || 0;
		const br = parseFloat(cs.borderRightWidth) || 0, bb = parseFloat(cs.borderBottomWidth) || 0;
		const size = parseFloat(cs.fontSize);
		const weight = Number(cs.fontWeight) || 400;
		out.push({
			name: (el.className.toString().split(" ")[0] || el.tagName.toLowerCase()),
			text: (el.textContent || el.getAttribute("placeholder") || "").trim().slice(0, 22),
			x: Math.max(0, Math.round(r.left + bl + 1)), y: Math.max(0, Math.round(r.top + bt + 1)),
			w: Math.max(1, Math.round(r.width - bl - br - 2)),
			h: Math.max(1, Math.round(r.height - bt - bb - 4)),
			ink: [r8, g8, b8],
			alpha,
			lum: 0.2126 * srgb(r8 / 255) + 0.7152 * srgb(g8 / 255) + 0.0722 * srgb(b8 / 255),
			// 1.4.3: 3:1 for large text (>=24px, or >=18.66px bold), else 4.5:1
			need: size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5,
		});
	}
	return out;
};

// Worst case per box, at the 98th percentile of background lightness.
//
// Not the single lightest pixel: the ground is a starfield, and one 1.5px
// star behind a glyph is a near-white pixel that would score 1.1:1 and
// fail every line on the panel. A star is not the background of the text
// — a point of light a glyph sits over is not what a reader's eye
// integrates. A region that IS too light is thousands of pixels, far
// above the 2% this trims: on a 322×40 box, 258 pixels have to be lighter
// before the verdict moves, and the whole starfield inside such a box is
// well under a hundred. The percentile ignores sparkle and keeps any
// real lightening, which is exactly the distinction 1.4.3 cares about.
const worstAgainst = async (b64, boxes) => {
	const img = new Image();
	img.src = "data:image/png;base64," + b64;
	await img.decode();
	const cv = document.createElement("canvas");
	cv.width = img.width; cv.height = img.height;
	const ctx = cv.getContext("2d", { willReadFrequently: true });
	ctx.drawImage(img, 0, 0);
	const srgb = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
	// The box is clamped to the IMAGE, not trusted as given. `getImageData`
	// answers out-of-bounds pixels with transparent black, and a box that
	// straddles the bottom of the viewport — the last site link on a phone,
	// with the panel scrolled to the top — is half real ground and half that
	// black. On the ink panel of #417 the two were indistinguishable and this
	// never showed; on paper it reported "#000000 behind it" for eleven links
	// that are perfectly legible once you scroll to them. Sample what was
	// photographed, and nothing else.
	return boxes.map((b) => {
		const x0 = Math.max(0, Math.min(cv.width - 1, Math.round(b.x)));
		const y0 = Math.max(0, Math.min(cv.height - 1, Math.round(b.y)));
		const w = Math.max(1, Math.min(Math.round(b.w), cv.width - x0));
		const h = Math.max(1, Math.min(Math.round(b.h), cv.height - y0));
		const d = ctx.getImageData(x0, y0, w, h).data;
		const lums = [], rgbs = [];
		for (let i = 0; i < d.length; i += 4) {
			lums.push(0.2126 * srgb(d[i] / 255) + 0.7152 * srgb(d[i + 1] / 255) + 0.0722 * srgb(d[i + 2] / 255));
			rgbs.push([d[i], d[i + 1], d[i + 2]]);
		}
		const order = lums.map((L, i) => i).sort((a, c) => lums[a] - lums[c]);
		// paper ink → the light tail is the danger; dark ink → the dark tail
		const dark = b.lum > 0.5;
		const idx = order[Math.min(order.length - 1,
			Math.max(0, Math.round((dark ? 0.98 : 0.02) * (order.length - 1))))];
		const L = lums[idx];
		// Translucent ink is not its own colour: it is its colour laid over
		// THIS pixel. Composite before comparing, or 82% paper reads as paper.
		const a = b.alpha == null ? 1 : b.alpha;
		const [ir, ig, ib] = b.ink || [0, 0, 0];
		const [br, bg, bb] = rgbs[idx];
		const inkL = a >= 1 ? b.lum
			: 0.2126 * srgb((a * ir + (1 - a) * br) / 255)
			+ 0.7152 * srgb((a * ig + (1 - a) * bg) / 255)
			+ 0.0722 * srgb((a * ib + (1 - a) * bb) / 255);
		const hi = Math.max(L, inkL), lo = Math.min(L, inkL);
		const hex = "#" + rgbs[idx].map((v) => v.toString(16).padStart(2, "0")).join("");
		return { ...b, ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 10) / 10, hex };
	});
};

// ── 0. Positive control: prove each probe can still fail ───────────────────
// #385. The four checks below all report by NOT firing, which is exactly what
// a broken selector, an unloaded axe or a stale predicate also look like. So
// before auditing a single real route, each probe runs over a page this file
// builds itself, carrying the exact defect it hunts. The fixture is a string
// here — never a route the site serves — so it cannot be audited by accident
// and cannot trip the gate it proves.
console.log("── positive control (#385)");

/** A header 80px tall, a link parked under it with its ring suppressed, a
 *  block 720px wide, and an `<img>` with no alt. One planted defect per probe. */
const CONTROL_HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>canario</title><style>
body { margin: 0 }
.site-header { position: fixed; top: 0; left: 0; right: 0; height: 80px; background: #eee }
#buried { position: absolute; top: 30px; left: 0 }
#buried:focus { outline: none }
#wide { width: 720px; height: 10px; background: #ccc }
#column { width: 105px }
#squashed { height: 32px; width: auto; max-width: 100% }
#cropped { width: 105px; height: 32px; object-fit: cover }
</style></head><body>
<header class="site-header"><a href="#x" id="inheader">en la cabecera</a></header>
<main><a href="#y" id="buried">bajo la cabecera, sin anillo</a>
<div id="wide"></div>
<img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">
<div id="column"><img id="squashed" alt="marca aplastada" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHdpZHRoPSc0ODAnIGhlaWdodD0nMTIwJz48cmVjdCB3aWR0aD0nNDgwJyBoZWlnaHQ9JzEyMCcgZmlsbD0nIzg4OCcvPjwvc3ZnPg=="></div>
<img id="cropped" alt="marca recortada a proposito" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHdpZHRoPSc0ODAnIGhlaWdodD0nMTIwJz48cmVjdCB3aWR0aD0nNDgwJyBoZWlnaHQ9JzEyMCcgZmlsbD0nIzg4OCcvPjwvc3ZnPg==">
</main></body></html>`;

{
	const blind = [];

	// The viewport is set BEFORE the content on each page: `setViewport` with
	// `isMobile` re-emulates the device and drops a document that was written
	// with setContent — measured, it left an empty page whose only axe
	// violations were "document-title" and "html-has-lang".
	const desktop = await browser.newPage();
	await desktop.setViewport({ width: 1280, height: 900 });
	await desktop.setContent(CONTROL_HTML);

	// FOCUS_PROBE — must report the planted element as obscured and ringless
	await desktop.evaluate(() => document.getElementById("buried").focus());
	const probed = await desktop.evaluate(FOCUS_PROBE);
	if (!probed) blind.push("the focus probe returned nothing for a focused element");
	else {
		if (!probed.obscured) blind.push("an element parked under the fixed header was not reported as obscured (2.4.11)");
		if (probed.ring) blind.push("an element with `outline: none` was reported as having a focus ring (2.4.7)");
	}
	// …and must NOT accuse the header's own link, which is not obscured by itself
	await desktop.evaluate(() => document.getElementById("inheader").focus());
	const inHeader = await desktop.evaluate(FOCUS_PROBE);
	if (inHeader?.obscured) blind.push("the header's own link was reported as obscured by the header");

	// RATIO_PROBE — must see the squashed mark and must NOT accuse the crop.
	// The negative half is the one that matters: a probe that flags every
	// `object-fit: cover` photo would be turned off within a week.
	{
		const seen = await desktop.evaluate(RATIO_PROBE);
		if (!seen.some((f) => f.src.endsWith("=") && f.pct >= 15)) {
			blind.push("a 480×120 mark rendered 105×32 was not reported as stretched (#416) — " +
				`the probe returned [${seen.map((f) => f.pct + "%").join(", ") || "nothing"}]`);
		}
		if (seen.length !== 1) {
			blind.push(`the deliberate \`object-fit: cover\` crop was reported as a defect ` +
				`(${seen.length} findings on a fixture carrying one)`);
		}
	}

	// axe — must be loaded, running, and finding a violation that is really there
	await desktop.evaluate(axeSource);
	const canary = await desktop.evaluate(async () =>
		window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a"] } }));
	if (!canary.violations.some((v) => v.id === "image-alt")) {
		blind.push("axe did not report the planted `<img>` with no alt (image-alt) — it returned " +
			`[${canary.violations.map((v) => v.id).join(", ") || "nothing"}] over ${canary.passes.length} passes`);
	}
	await desktop.close();

	// REFLOW_PROBE — must see the overflow at the width the norm names
	const narrow = await browser.newPage();
	await narrow.setViewport({ width: 320, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
	await narrow.setContent(CONTROL_HTML);
	const reflow = await narrow.evaluate(REFLOW_PROBE);
	if (!(reflow.doc > reflow.view + 1)) {
		blind.push(`a 720px block in a 320px viewport was not seen as overflow (got ${reflow.doc}/${reflow.view})`);
	}
	await narrow.close();

	if (blind.length) {
		console.error("\n✗ THIS GATE IS BLIND — its probes can no longer find the defects");
		console.error("  they exist to find, so every 'ok' below would be meaningless:");
		for (const b of blind) console.error(`    ${b}`);
		console.error("  → fix FOCUS_PROBE / REFLOW_PROBE / the axe load before trusting a green run.");
		await browser.close();
		process.exit(3);
	}
	ok("5 planted defects found — obscured focus, missing ring, 320px overflow, image-alt, squashed logo");
}

// ── 1. axe-core: the rules a machine can decide, on every audited route ─────
console.log(`── axe-core (WCAG 2.0/2.1/2.2 A+AA, plus best practices) — ${AXE_ROUTES.length} routes`);
await inParallel(AXE_ROUTES, async (route, lane, report) => {
	const page = await lane.newPage();
	await page.setViewport({ width: 1280, height: 900 });
	await page.goto(BASE + route, { waitUntil: "networkidle2", timeout: 60000 });
	await page.evaluate(axeSource);
	const res = await page.evaluate(async () =>
		window.axe.run(document, {
			runOnly: {
				type: "tag",
				values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"],
			},
		}),
	);
	if (res.violations.length) {
		for (const v of res.violations) {
			report.fail(route, `${v.id} (${v.impact}) ×${v.nodes.length} — ${v.help}`);
		}
	} else {
		report.ok(`${route} — 0 violations`);
	}
	// #416 rides along: the page is open, loaded and settled, and a stretched
	// image costs one more evaluate rather than one more navigation.
	for (const f of await page.evaluate(RATIO_PROBE)) {
		report.fail(route, `image stretched ${f.pct}% at 1280px: ${f.nat} rendered ${f.box} — ${f.src}`);
	}
	await page.close();
});

// ── 2. Keyboard traversal: reachable, visible, never obscured ───────────────
// 2.1.1, 2.4.1, 2.4.3, 2.4.7, 2.4.11 — none of which axe decides.
// #343: every route, not a sample of three. "Toda la web recorrible con Tab,
// en las 12 rutas y los dos idiomas" — a traversal that visits three pages
// says nothing about the twenty-three it skips.
console.log(`── keyboard traversal (${ROUTES.length} routes)`);
await inParallel(ROUTES, async (route, lane, report) => {
	const page = await lane.newPage();
	await page.setViewport({ width: 1280, height: 900 });
	await page.goto(BASE + route, { waitUntil: "networkidle2", timeout: 60000 });

	// The first stop must be the skip link, and it must actually appear.
	//
	// Start the traversal at the top of the document, explicitly. /search and
	// /en/search carry `autofocus` on the query field, so the first Tab would
	// otherwise start from the middle of the page and the gate would report a
	// missing skip link on two pages that have one.
	//
	// `blur()` is not enough, and this is the part worth remembering: it clears
	// `document.activeElement` — measured, it reads `body` afterwards — but NOT
	// the sequential focus navigation starting point, which stays on the
	// blurred input, so Tab still went to the submit button next to it.
	// Focusing `body` moves the starting point itself. The tabindex is added
	// and removed around the call so the page is left as it was found.
	await sleep(SETTLE_MS);
	await page.evaluate(() => {
		document.body.setAttribute("tabindex", "-1");
		document.body.focus();
		document.body.removeAttribute("tabindex");
	});
	await page.keyboard.press("Tab");
	await sleep(SETTLE_MS);
	const first = await page.evaluate(() => {
		const el = document.activeElement;
		const r = el.getBoundingClientRect();
		return {
			isSkip: el.classList.contains("skip-link"),
			href: el.getAttribute("href"),
			onScreen: r.top >= 0 && r.height > 0,
			text: el.textContent.trim(),
		};
	});
	if (!first.isSkip) report.fail(route, `first Tab stop is not the skip link (got "${first.text}")`);
	else if (!first.onScreen) report.fail(route, "the skip link does not become visible when focused");
	else if (first.href !== "#content") report.fail(route, `skip link points at ${first.href}, not #content`);
	else report.ok(`${route} — skip link first, visible, → #content`);

	// Every subsequent stop: visible focus indicator, not under the fixed header.
	let stops = 0;
	let obscured = 0;
	let ringless = 0;
	// "De principio a fin": Tab until focus leaves the document rather than
	// until a counter runs out, so a page longer than the counter is not
	// reported as fully traversed when half of it was never reached.
	let reachedEnd = false;
	for (let i = 0; i < 120; i++) {
		await page.keyboard.press("Tab");
		const s = await page.evaluate(FOCUS_PROBE);
		if (!s) { reachedEnd = true; break; }
		stops++;
		if (s.obscured) { obscured++; report.fail(route, `focused element hidden behind the fixed header: ${s.name}`); }
		if (!s.ring && !s.offscreen) { ringless++; report.fail(route, `focused element has no visible focus indicator: ${s.name}`); }
	}
	if (!reachedEnd) {
		report.fail(route, `focus was still inside the document after 120 Tab presses ` +
			`(${stops} stops) — the traversal never reached the end`);
	} else if (!obscured && !ringless) {
		report.ok(`${route} — ${stops} stops to the end, none obscured, all with a focus ring`);
	}
	await page.close();
});

// ── 3. The menu: opens from the keyboard, holds focus, gives the cube back ──
// 2.1.1 (everything the cube does, the keyboard does), 2.1.2 (what you enter,
// you leave) and 3.2.1 (nothing navigates on focus alone).
//
// The dialog is opened with `showModal()`, so the trap and `esc` come from the
// platform — but the close is deferred 500ms for the slide-out animation, and
// nothing proved the focus ever came back to the cube that opened it. A menu
// that closes and drops focus on `<body>` sends the next Tab to the top of the
// document: the reader is silently returned to the beginning of the page.
console.log("── the menu: keyboard open, focus trap, and the cube back");
for (const route of ["/", "/en"]) {
	const page = await browser.newPage();
	await page.setViewport({ width: 1280, height: 900 });
	await page.goto(BASE + route, { waitUntil: "networkidle2", timeout: 60000 });

	const state = () => page.evaluate(() => {
		const dialog = document.getElementById("menu-dialog");
		return {
			open: dialog?.open === true,
			focusInside: !!dialog && dialog.contains(document.activeElement),
			active: document.activeElement?.id || document.activeElement?.tagName.toLowerCase(),
			// Set by the traversal below on its first stop, so a full cycle can be
			// recognised by returning to where it began.
			atFirstStop: document.activeElement === window.__menuFirstStop,
		};
	});

	// Positive control (#385): the same three readings, taken while the menu is
	// shut and the cube has focus, must come back the OTHER way. Without it a
	// probe hard-wired to "open, inside, menu-trigger" would pass every
	// assertion below without ever looking at the page.
	await page.evaluate(() => document.getElementById("menu-trigger")?.focus());
	const shut = await state();
	if (shut.open || shut.focusInside) {
		fail(route, "THIS CHECK IS BLIND — with the menu closed the probe still " +
			`reports open=${shut.open}, focusInside=${shut.focusInside}`);
	} else if (shut.active !== "menu-trigger") {
		fail(route, `THIS CHECK IS BLIND — the probe cannot see focus on the cube (got "${shut.active}")`);
	} else {
		ok(`${route} — control: closed menu reads closed, cube reads focused`);
	}

	// Enter on the cube opens it — the keyboard doing what the pointer does.
	await page.keyboard.press("Enter");
	let opened = true;
	try {
		await page.waitForFunction(() => document.getElementById("menu-dialog")?.open === true,
			{ timeout: 5000 });
	} catch {
		opened = false;
		fail(route, "Enter on the cube does not open the menu (2.1.1)");
	}

	if (opened) {
		await sleep(SETTLE_MS);
		const inside = await state();
		if (!inside.focusInside) {
			fail(route, `opening the menu left focus outside it (on "${inside.active}") — ` +
				"the first Tab would land back in the page behind the panel");
		}

		// Walk past the end of the panel: focus must come back into it rather
		// than reach the page behind. A modal dialog is a deliberate trap, and
		// `esc` is the way out.
		//
		// `document.body` is NOT a leak. Tabbing past the last element of the
		// cycle hands focus to the browser's own chrome, and a headless Chrome
		// has none, so `activeElement` reads `body` for exactly one stop before
		// wrapping — measured: menu-close → 6 spec → 5 site → body → menu-close.
		// Failing on it would report the wrap point as a broken trap.
		let escaped = null;
		let wrapped = false;
		for (let i = 0; i < 30 && !escaped && !wrapped; i++) {
			await page.keyboard.press("Tab");
			const s = await state();
			if (i === 0) {
				await page.evaluate(() => { window.__menuFirstStop = document.activeElement; });
			} else if (s.focusInside && s.atFirstStop) {
				// Back where the walk began: the cycle closed without ever leaving
				// the panel. This is the reading that matters, and it does not
				// depend on the browser parking focus on `body` on the way round.
				wrapped = true;
			} else if (!s.focusInside) {
				if (s.active === "body" || s.active === "html") wrapped = true;
				else escaped = s.active;
			}
		}
		if (escaped) {
			fail(route, `Tab leaves the open menu and lands on "${escaped}" behind the panel (2.1.2)`);
		} else if (!wrapped) {
			fail(route, "30 Tab presses never completed a cycle of the open menu — " +
				"either the panel has almost no stops, or focus is stuck on one");
		}

		// Escape closes it, and the cube gets the focus back.
		await page.keyboard.press("Escape");
		let closed = true;
		try {
			await page.waitForFunction(() => document.getElementById("menu-dialog")?.open === false,
				{ timeout: 5000 });
		} catch {
			closed = false;
			fail(route, "Escape does not close the menu (2.1.2 — no way out with the keyboard)");
		}
		if (closed) {
			const back = await state();
			if (back.active !== "menu-trigger") {
				fail(route, `closing the menu left focus on "${back.active}", not the cube ` +
					"that opened it — the next Tab restarts at the top of the document");
			} else if (!escaped && inside.focusInside) {
				ok(`${route} — Enter opens, focus cycles inside, Escape closes, cube refocused`);
			}
		}
	}
	await page.close();
}

// ── 4. The OPEN menu, measured — every tone on the panel (#417, #431) ─────
// §1 runs axe on 28 routes and never sees this panel: a closed `<dialog>` is
// `display: none`, so every node inside it is skipped and the run comes back
// green having looked at nothing. Whatever the panel is wearing, it is a
// surface no other section of this gate reaches.
//
// #417 put it on ink behind a drawing and axe could not decide it at all: a
// background IMAGE makes `color-contrast` return INCOMPLETE nodes with
// "background color could not be determined" and zero violations. #431 took
// the drawing away, so axe can read the ground again — and the pixel pass
// stays anyway, because the ground under a row is not the panel's colour: it
// is the panel plus a `color-mix` tint at 16-24%, plus the console's own box,
// and "the lightest pixel actually behind this text" is the only reading of
// that which cannot be argued with. The ink is blanked, the panel is
// photographed, every text box is compared against what is really there.
//
// The darkest pixel would be the question on ink and the lightest is the
// question on paper; `worstAgainst` takes the tail that hurts, so the sense
// of the measurement did not have to flip with the ground.
//
// The routes are read off the menu itself rather than transcribed: the six
// specialty links ARE the list, and each is visited so the `aria-current`
// tint of every vertical is measured on its own page, in both locales.
console.log("── the open menu: contrast on the paper panel");
{
	// The ink is removed, not the elements: the boxes must stay exactly where
	// they are so what is measured is the ground UNDER the text, tint and all.
	const BLANK_INK =
		"#menu-dialog, #menu-dialog *, #menu-dialog *::placeholder " +
		"{ color: transparent !important; -webkit-text-fill-color: transparent !important; }";

	const TEXT_SELECTOR = [
		".spec-title", ".site-link", ".menu-kicker", ".die-hint",
		".menu-bar__word", ".menu-bar__path",
		".search-ps", ".search-chrome", ".search-hint", ".search-input",
	].map((c) => `#menu-dialog ${c}`).join(", ");

	const menuRoutes = [];
	for (const home of ["/", "/en"]) {
		const page = await browser.newPage();
		await page.setViewport({ width: 1280, height: 900 });
		await page.goto(BASE + home, { waitUntil: "networkidle2", timeout: 60000 });
		const hrefs = await page.evaluate(() =>
			[...document.querySelectorAll(".spec-link")].map((a) => a.getAttribute("href")));
		await page.close();
		menuRoutes.push(home, ...hrefs);
	}
	// A menu that stopped rendering its links would leave two routes and a
	// green section. The seed declares six specialties per locale.
	if (menuRoutes.length < 14) {
		console.error(`✗ THIS GATE IS BLIND — the menu offered ${menuRoutes.length - 2} specialty ` +
			"link(s) across both locales, not 12.");
		console.error("  → MenuDialog stopped rendering .spec-link, or the seed lost a service.");
		process.exit(3);
	}

	// Positive control (#385) on the pixel pass, which is the half no library
	// backs. It reports by finding nothing, and a stale selector, a screenshot
	// that never blanked the ink and a percentile pointing at the wrong tail
	// all look exactly like a clean panel. So one panel is deliberately broken
	// first — the site links repainted a near-PAPER grey that scores about
	// 1.3:1 on this ground — and the measurement has to say so before any real
	// route is trusted. The plant is thrown away with the page.
	//
	// The plant is ground-bound and that is the point: #417's near-black
	// (#262626) planted here would score 15:1 on paper and be caught by
	// nothing, which is exactly what this control announced the day the panel
	// turned white. A positive control that survives a redesign untouched was
	// never testing the redesign.
	{
		const page = await browser.newPage();
		await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
		await page.goto(BASE + "/", { waitUntil: "networkidle2", timeout: 60000 });
		await page.click("#menu-trigger");
		await page.waitForFunction(() => document.getElementById("menu-dialog")?.open === true,
			{ timeout: 5000 });
		await sleep(600);
		await page.addStyleTag({ content: "#menu-dialog .site-link { color: #EDEDED !important; }" });
		const boxes = await page.evaluate(readBoxes, TEXT_SELECTOR);
		await page.addStyleTag({ content: BLANK_INK });
		const shot = await page.screenshot({ encoding: "base64", captureBeyondViewport: false });
		const rows = await page.evaluate(worstAgainst, shot, boxes);
		await page.close();
		const caught = rows.filter((r) => r.name === "site-link" && r.ratio + 0.05 < r.need);
		const links = rows.filter((r) => r.name === "site-link").length;
		if (!links || caught.length !== links) {
			console.error(`✗ THIS GATE IS BLIND — ${links} planted near-paper site link(s) on the ` +
				`panel, and the pixel pass called ${caught.length} of them a failure.`);
			console.error("  → readBoxes/worstAgainst or the blanking style stopped working; " +
				"a green run below would mean nothing.");
			process.exit(3);
		}
		ok(`control — ${links} planted near-paper links all measured under AA ` +
			`(tightest ${Math.min(...caught.map((r) => r.ratio))}:1)`);
	}

	// A phone shows what a desktop does not: the console lives inside the menu
	// only below 768px, and the short labels only below 701px.
	const SIZES = [{ width: 1280, height: 900 }, { width: 390, height: 844 }];
	const perRoute = await inParallel(menuRoutes, async (route, lane, report) => {
		let axeSaw = 0, measured = 0, tightest = { ratio: Infinity };
		for (const vp of SIZES) {
			const page = await lane.newPage();
			await page.setViewport({ ...vp, deviceScaleFactor: 1 });
			await page.goto(BASE + route, { waitUntil: "networkidle2", timeout: 60000 });
			await page.click("#menu-trigger");
			await page.waitForFunction(() => document.getElementById("menu-dialog")?.open === true,
				{ timeout: 5000 });
			await sleep(600); // the panel slides in; mid-transition reads the start frame

			// axe first, while the ink is still on the page
			await page.evaluate(axeSource);
			const res = await page.evaluate(async () =>
				window.axe.run("#menu-dialog", {
					runOnly: {
						type: "tag",
						values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"],
					},
				}));
			for (const bucket of [res.passes, res.incomplete, res.violations]) {
				const cc = bucket.find((r) => r.id === "color-contrast");
				axeSaw += cc ? cc.nodes.length : 0;
			}
			for (const v of res.violations) {
				report.fail(route, `menu open @${vp.width}: ${v.id} (${v.impact}) ×${v.nodes.length} — ${v.help}`);
			}

			// then the pixels, which is the part axe could not decide
			const boxes = await page.evaluate(readBoxes, TEXT_SELECTOR);
			await page.addStyleTag({ content: BLANK_INK });
			const shot = await page.screenshot({ encoding: "base64", captureBeyondViewport: false });
			const rows = await page.evaluate(worstAgainst, shot, boxes);
			measured += rows.length;
			for (const r of rows) {
				if (r.ratio < tightest.ratio) tightest = { ...r, route, vp: vp.width };
				if (r.ratio + 0.05 < r.need) {
					report.fail(route, `menu open @${vp.width}: .${r.name} ("${r.text}") is ${r.ratio}:1 against ` +
						`${r.hex} behind it — 1.4.3 asks ${r.need}:1`);
				}
			}
			await page.close();
		}
		report.ok(`${route} — menu open at 1280 and 390, axe clean, ink measured against the ground`);
		return { axeSaw, measured, tightest };
	});

	// Reduced in input order, so the tie-break that picks `tightest` is the
	// one the sequential run made: strictly-less-than, first occurrence wins.
	let axeSaw = 0, measured = 0, tightest = { ratio: Infinity };
	for (const r of perRoute) {
		axeSaw += r.axeSaw;
		measured += r.measured;
		if (r.tightest.ratio < tightest.ratio) tightest = r.tightest;
	}

	// Both halves report by NOT firing, and both have a silent way to look at
	// nothing: axe scoped to an unrendered subtree, and a pixel pass that
	// collected no boxes. Eleven text boxes per panel is the floor — six
	// specialty rows plus the site links.
	const panels = menuRoutes.length * SIZES.length;
	if (axeSaw < panels * 11 || measured < panels * 11) {
		console.error(`✗ THIS GATE IS BLIND — across ${panels} open panels axe saw ${axeSaw} ` +
			`contrast node(s) and the pixel pass measured ${measured} text box(es), below the ~11 each must find.`);
		console.error("  → the dialog is not actually open when they run, or a selector is stale.");
		process.exit(3);
	}
	ok(`${measured} text boxes measured against the rendered ground; tightest was ` +
		`.${tightest.name} at ${tightest.ratio}:1 on ${tightest.route} @${tightest.vp}`);
}

// ── 5. The hero band, measured — ink over six drawn plates (#413) ─────────
// Same blindness as §4 and a bigger surface: the home paints its headline,
// its kicker and the vertical's own paragraph over one of six drawn SVGs, and
// every vertical page repeats the trick with its own plate. axe answers
// INCOMPLETE for all of it, so until this section existed the loudest text on
// the site was the least audited.
//
// It is not hypothetical. The first sweep of the scrim faded to 0.20 by 64%
// of the frame while the copy column runs to 78%; on the greenfield plate,
// whose lit cube sits at ~68%, the pitch measured 3.1:1 against a 4.5:1
// requirement, and it had shipped. The scrim stops being a matter of taste
// the moment a gate reads it.
//
// The carousel is stepped through its own manual state (`.is-manual` +
// `data-slide`, what the arrows set) rather than by clicking and hoping: the
// CSS clock is running against the document timeline, so a click lands on
// whichever plate the wall clock happens to be showing. Setting the state
// directly makes plate 4 plate 4 on every run.
console.log("── the hero band: ink over the plates");
{
	const BLANK_INK =
		".s-hero, .s-hero *, .s-hero *::placeholder " +
		"{ color: transparent !important; -webkit-text-fill-color: transparent !important; }";

	const TEXT_SELECTOR = [
		"h1", ".s-hero__kicker p", ".s-hero__pitch-item",
		".s-hero__name", ".s-hero__vname", ".s-hero__n", ".s-hero__tag", ".s-hero__body", ".s-hero__stop-name",
	].map((c) => `.s-hero ${c}`).join(", ");

	// Freeze the band on plate `k`. Returns how many plates the band has, so
	// a home that lost five of them cannot pass as a home with one.
	//
	// A scene hero (#529 radar, #531 bridge) has no plate: its art is a photo
	// that becomes a drawing beside the copy, and the copy sits on the band's
	// tint over drawn lines — a background axe still cannot read. It counts as
	// one plate, frozen in its end state (the drawing and its live layer),
	// which is what the page shows for the whole visit after the first seconds.
	const freeze = (k) => {
		const hero = document.querySelector(".s-hero");
		if (!hero) return 0;
		if (hero.classList.contains("s-hero--scene")) {
			hero.classList.remove("is-playing");
			hero.classList.add("is-done");
			return 1;
		}
		// the home's slides are photographs since #560 (`.s-hero__photo`), after the «nosotros» frame
		// since #580 — no photograph, its subject the lit cube (`.s-hero__us`), and it is `data-slide`
		// 0; a vertical page without a scene still holds one drawn plate
		const plates = hero.querySelectorAll(".s-hero__photo, .s-hero__plate, .s-hero__us").length;
		if (plates > 1) {
			hero.classList.add("is-manual");
			hero.dataset.slide = String(k);
		}
		return plates;
	};

	const heroRoutes = [];
	for (const home of ["/", "/en"]) {
		const page = await browser.newPage();
		await page.setViewport({ width: 1440, height: 900 });
		await page.goto(BASE + home, { waitUntil: "networkidle2", timeout: 60000 });
		const hrefs = await page.evaluate(() =>
			[...document.querySelectorAll(".spec-link")].map((a) => a.getAttribute("href")));
		await page.close();
		heroRoutes.push(home, ...hrefs);
	}
	if (heroRoutes.length < 14) {
		console.error(`✗ THIS GATE IS BLIND — ${heroRoutes.length - 2} specialty route(s) found, not 12.`);
		process.exit(3);
	}

	// The control the pixel pass needs (#385): a blanking style that stopped
	// working, a stale selector or a percentile on the wrong tail all look
	// exactly like a clean band. The pitch is repainted a near-black that
	// scores about 1.3:1 on ink, and every frame of it has to be called a
	// failure before a single real plate is believed.
	{
		const page = await browser.newPage();
		await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
		await page.goto(BASE + "/", { waitUntil: "networkidle2", timeout: 60000 });
		// frame 1, the first photograph: frame 0 is «nosotros» since #580, whose card is the
		// index of the six verticals and carries no pitch line to plant on
		await page.evaluate(freeze, 1);
		await sleep(SETTLE_MS);
		await page.addStyleTag({ content: ".s-hero__pitch-item { color: #3A3A3A !important; }" });
		const boxes = await page.evaluate(readBoxes, TEXT_SELECTOR);
		await page.addStyleTag({ content: BLANK_INK });
		const shot = await page.screenshot({ encoding: "base64", captureBeyondViewport: false });
		const rows = await page.evaluate(worstAgainst, shot, boxes);
		await page.close();
		const planted = rows.filter((r) => r.name === "s-hero__pitch-item");
		const caught = planted.filter((r) => r.ratio + 0.05 < r.need);
		if (!planted.length || caught.length !== planted.length) {
			console.error(`✗ THIS GATE IS BLIND — ${planted.length} planted near-black pitch line(s) ` +
				`over the plate, and the pixel pass called ${caught.length} of them a failure.`);
			process.exit(3);
		}
		ok(`control — the planted near-black pitch measured ${caught[0].ratio}:1 over the plate`);
	}

	// 1440 is where the scrim runs sideways and 390 is where it runs down the
	// picture — two different gradients, so two different verdicts. 1280 x 720
	// is the common laptop where the home's kicker, held to one line per
	// sentence, runs furthest into the photograph: 3.7:1 there while 1440 read
	// exactly 4.5 (2026-10-06), so 1440 alone could not see it.
	const SIZES = [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 390, height: 844 }];
	const perRoute = await inParallel(heroRoutes, async (route, lane, report) => {
		let measured = 0, frames = 0, tightest = { ratio: Infinity };
		let worstHere = { ratio: Infinity };
		for (const vp of SIZES) {
			const page = await lane.newPage();
			await page.setViewport({ ...vp, deviceScaleFactor: 1 });
			await page.goto(BASE + route, { waitUntil: "networkidle2", timeout: 60000 });
			const plates = await page.evaluate(freeze, 0);
			if (!plates) {
				report.fail(route, "no hero band found — the plate selector is stale");
				await page.close();
				continue;
			}
			for (let k = 0; k < plates; k++) {
				await page.evaluate(freeze, k);
				await sleep(SETTLE_MS);
				const boxes = await page.evaluate(readBoxes, TEXT_SELECTOR);
				const blank = await page.addStyleTag({ content: BLANK_INK });
				const shot = await page.screenshot({ encoding: "base64", captureBeyondViewport: false });
				// The ink has to come BACK: the six frames are measured on one
				// page load, and a blanking style left in place would make the
				// next frame's `color` read `transparent` and every ratio a lie.
				await blank.evaluate((el) => el.remove());
				const rows = await page.evaluate(worstAgainst, shot, boxes);
				measured += rows.length;
				frames += 1;
				// A vertical page's band carries two lines — the heading and the
				// body. The home's carries more: the heading, its two lines, the
				// card (the six names on «nosotros», a vertical's name and
				// sentence on a photograph) and the rail.
				const floor = plates > 1 ? 4 : 2;
				if (rows.length < floor) {
					report.fail(route, `hero @${vp.width} plate ${k + 1}: ${rows.length} text box(es), under the ` +
						`${floor} this band has — the copy did not render, or the selector is stale`);
				}
				for (const r of rows) {
					if (r.ratio < worstHere.ratio) worstHere = { ...r, vp: vp.width, plate: k + 1 };
					if (r.ratio < tightest.ratio) tightest = { ...r, route, vp: vp.width, plate: k + 1 };
					if (r.ratio + 0.05 < r.need) {
						report.fail(route, `hero @${vp.width} plate ${k + 1}: .${r.name} ("${r.text}") is ` +
							`${r.ratio}:1 against ${r.hex} behind it — 1.4.3 asks ${r.need}:1`);
					}
				}
			}
			await page.close();
		}
		report.ok(`${route} — hero measured at 1440, 1280 and 390; tightest ${worstHere.ratio}:1 ` +
			`(.${worstHere.name}, plate ${worstHere.plate} @${worstHere.vp})`);
		return { measured, frames, tightest };
	});

	let measured = 0, frames = 0, tightest = { ratio: Infinity };
	for (const r of perRoute) {
		measured += r.measured;
		frames += r.frames;
		if (r.tightest.ratio < tightest.ratio) tightest = r.tightest;
	}

	// A band that rendered nothing measures nothing and reports green. The
	// home carries seven frames and every vertical one, in both locales.
	// 26 frames per size: «nosotros» and the six slides on each home (#580) and
	// one on each of the twelve vertical pages (the floor was 24 with six
	// slides, 48 at two sizes, measured 2026-10-06).
	const FRAMES = 26 * SIZES.length;
	if (frames < FRAMES || measured < frames * 2) {
		console.error(`✗ THIS GATE IS BLIND — ${frames} hero frame(s) photographed and ${measured} ` +
			`text box(es) measured, below the ${FRAMES} frames and 2 boxes each this site has.`);
		process.exit(3);
	}
	ok(`${measured} text boxes over ${frames} plate frames; tightest was .${tightest.name} at ` +
		`${tightest.ratio}:1 on ${tightest.route} plate ${tightest.plate} @${tightest.vp}`);
}

// ── 6. WCAG 2.1.4 — a single-character shortcut must be scoped ──────────────
// `/` may open the search only when focus is already inside the header.
// ── 5b. The opening h1: one line on any desktop (#529) ─────────────────────
// theme.css sizes one register for every page's opening h1 by the longest
// title the CMS holds; a longer title wraps here first, by route and by name,
// before anyone sees it. The home keeps its own register and is left out.
console.log("── the opening h1: one line at 768, 1024 and 1440 (#529)");
{
	// the specialty routes, read from each home's menu the way the band pass does
	const specialties = [];
	for (const home of ["/", "/en"]) {
		const page = await browser.newPage();
		await page.goto(BASE + home, { waitUntil: "networkidle2", timeout: 60000 });
		specialties.push(...(await page.evaluate(() => [...document.querySelectorAll(".spec-link")].map((a) => a.getAttribute("href")))));
		await page.close();
	}
	if (specialties.length < 12) {
		console.error(`✗ THIS GATE IS BLIND — ${specialties.length} specialty route(s) found, not 12.`);
		process.exit(3);
	}
	const OPENINGS = [
		...specialties,
		"/quienes-somos", "/en/about-us", "/referencias", "/en/references",
		"/deconstruyendo", "/en/deconstructing", "/contacto", "/en/contact",
		"/politica-de-privacidad", "/en/privacy-policy",
	];
	const rows = await inParallel(OPENINGS, async (route, lane, report) => {
		let checked = 0;
		for (const width of [768, 1024, 1440]) {
			const page = await lane.newPage();
			await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
			await page.goto(BASE + route, { waitUntil: "networkidle2", timeout: 60000 });
			const h1 = await page.evaluate(() => {
				const h = document.querySelector("main h1");
				if (!h) return null;
				const lh = parseFloat(getComputedStyle(h).lineHeight);
				return { lines: Math.round(h.getBoundingClientRect().height / lh), text: h.textContent.trim(), over: h.scrollWidth > h.clientWidth + 1 };
			});
			await page.close();
			if (!h1) { report.fail(route, `no opening h1 found @${width} — the selector is stale`); continue; }
			checked += 1;
			if (h1.lines > 1) report.fail(route, `the opening h1 wraps to ${h1.lines} lines @${width} — "${h1.text}"; the register in theme.css is sized by the longest title (#529)`);
			if (h1.over) report.fail(route, `the opening h1 overflows its column @${width} — "${h1.text}"; the register's constant in theme.css is below this title's width`);
		}
		return checked;
	});
	const checked = rows.reduce((a, b) => a + b, 0);
	if (checked < OPENINGS.length * 3) {
		console.error(`✗ THIS GATE IS BLIND — ${checked} opening h1(s) read, below the ${OPENINGS.length * 3} this site has.`);
		process.exit(3);
	}
	ok(`${OPENINGS.length} openings read at three widths — every h1 one line, none overflowing`);
}

// ── 5c. The home's two kicker lines: one line each on any desktop ──────────
// The years and what they cover, then the partnership (founder, 2026-10-06:
// "que nada salte de línea"). homepage.css sizes both by the longer one; a
// longer line overflows its column here, by locale and by text.
console.log("── the home's kicker: two lines, one line each, at 768, 1024 and 1440");
{
	let read = 0;
	for (const home of ["/", "/en"]) {
		for (const width of [768, 1024, 1440]) {
			const page = await browser.newPage();
			await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
			await page.goto(BASE + home, { waitUntil: "networkidle2", timeout: 60000 });
			const lines = await page.evaluate(() =>
				[...document.querySelectorAll(".s-hero--home .s-hero__kicker p")].map((p) => ({
					text: p.textContent.trim(),
					rows: Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight)),
					over: p.scrollWidth > p.clientWidth + 1,
				})),
			);
			await page.close();
			if (lines.length !== 2) {
				fail(home, `${lines.length} kicker line(s) @${width}, not 2 — the selector or the CMS blocks are stale`);
				continue;
			}
			for (const l of lines) {
				read += 1;
				if (l.rows > 1 || l.over) {
					fail(home, `the kicker line "${l.text}" ${l.over ? "overflows its column" : `wraps to ${l.rows} lines`} @${width}; its constant in homepage.css is below this line's width`);
				}
			}
		}
	}
	if (read < 12) {
		console.error(`✗ THIS GATE IS BLIND — ${read} kicker line(s) read, below the 12 the two homes have at three widths.`);
		process.exit(3);
	}
	ok(`${read} kicker lines read on both homes — every one on one line, none overflowing`);
}

console.log("── 2.1.4 character key shortcut");
{
	const page = await browser.newPage();
	await page.setViewport({ width: 1280, height: 900 });
	await page.goto(BASE + "/cdn-waf-seguridad-edge-cloudflare", { waitUntil: "networkidle2", timeout: 60000 });
	const searchOpen = () =>
		page.evaluate(() => {
			const f = document.querySelector(".site-header .search-form");
			return !!f && getComputedStyle(f).display !== "none";
		});

	await page.evaluate(() => document.querySelector("main a, main button")?.focus());
	await page.keyboard.press("/");
	await sleep(250);
	if (await searchOpen()) fail("/cdn-waf…", "`/` opens the search with focus outside the header (WCAG 2.1.4)");
	else ok("`/` is inert while focus is in the content");

	await page.evaluate(() => document.getElementById("menu-trigger")?.focus());
	await page.keyboard.press("/");
	await sleep(250);
	if (!(await searchOpen())) fail("/cdn-waf…", "`/` does not open the search with focus in the header");
	else ok("`/` opens the search from within the header");
	await page.close();
}

// ── 7. WCAG 1.4.10 — reflow at 320 CSS px, the width the norm names ─────────
console.log("── 1.4.10 reflow at 320px");
// `/404` earns its place here: the stack trace #418 put on it is the longest
// unbreakable-looking text on the site, and a `pre`-shaped block is the
// classic way a page starts scrolling sideways at this width.
for (const route of ["/", "/cdn-waf-seguridad-edge-cloudflare", "/referencias", "/search?q=cloudflare", "/404"]) {
	const page = await browser.newPage();
	await page.setViewport({ width: 320, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
	await page.goto(BASE + route, { waitUntil: "networkidle2", timeout: 60000 });
	const s = await page.evaluate(REFLOW_PROBE);
	if (s.doc > s.view + 1) fail(route, `horizontal overflow at 320px: ${s.doc} > ${s.view} (${s.over.join(", ")})`);
	else ok(`${route} — ${s.doc}/${s.view}`);
	await page.close();
}

// ── 8. Aspect ratio at 320px — no image may be squashed (#416) ─────────────
// Its own loop, and over EVERY route, because narrow is where the defect
// lives: the global `img { max-width: 100% }` only clamps once the container
// is too narrow for the image, so a desktop pass sees nothing. The two rules
// that produced it were each correct in isolation — this measures the outcome
// instead, comparing every rendered box against its own natural ratio.
console.log(`── image aspect ratio at 320px — ${ROUTES.length} routes`);
{
	// One page per route now, where a single page used to be re-navigated 32
	// times. A lane cannot share a page with another lane, and page creation
	// is milliseconds against a navigation.
	const perRoute = await inParallel(ROUTES, async (route, lane, report) => {
		const page = await lane.newPage();
		await page.setViewport({ width: 320, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
		await page.goto(BASE + route, { waitUntil: "networkidle2", timeout: 60000 });
		const bad = await page.evaluate(RATIO_PROBE);
		for (const f of bad) {
			report.fail(route, `image stretched ${f.pct}% at 320px: ${f.nat} rendered ${f.box} — ${f.src}`);
		}
		const imgs = await page.evaluate(() => document.querySelectorAll("img").length);
		await page.close();
		return imgs;
	});
	const checked = perRoute.reduce((a, b) => a + b, 0);
	ok(`${checked} images across ${ROUTES.length} routes keep their ratio`);
}

// ── 8b. WCAG 1.4.11 — the bands' pause, at rest, on its photograph (#505) ──
// On a device with hover the controls wait at reduced opacity until the band
// is hovered or the control focused (scene-ctl.css). At rest the photograph
// shows through the whole control, so its pause glyph is measured on pixels
// against the control's own ground, on every band: at 35 % it read 1.68:1 on
// e-commerce's warehouse (measured 2026-10-16, WCAG-EM #505), under the 3:1 a
// component's identifying graphic owes. The home's control sits over a
// different photograph in each frame, so every frame is pinned and measured.
console.log("── 1.4.11 the bands' pause at rest, on its photograph");
{
	const CTL_MIN = 3;
	const verticals = readSeed().content.services.filter((e) => e.locale !== "en").map((e) => entryPath("services", e));
	const glyphContrast = async (b64) => {
		const im = new Image();
		im.src = "data:image/png;base64," + b64;
		await im.decode();
		const c = document.createElement("canvas");
		c.width = im.width;
		c.height = im.height;
		const x = c.getContext("2d");
		x.drawImage(im, 0, 0);
		const L = ([r, g, b]) => {
			const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
			return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
		};
		const lum = (i, j) => L(x.getImageData(i, j, 1, 1).data);
		// the glyph: the brightest pixels of the button's middle; its ground: just inside the border
		const mid = [];
		for (let i = 12; i < 28; i++) for (let j = 12; j < 28; j++) mid.push(lum(i, j));
		const ground = [];
		for (let i = 3; i < 7; i++) for (let j = 3; j < 7; j++) ground.push(lum(i, j));
		mid.sort((m, n) => n - m);
		const ink = mid.slice(0, 8).reduce((m, n) => m + n) / 8;
		const g = ground.reduce((m, n) => m + n) / ground.length;
		return (Math.max(ink, g) + 0.05) / (Math.min(ink, g) + 0.05);
	};
	const measure = async (lane, route, { frame, plant } = {}) => {
		const page = await lane.newPage();
		await page.setViewport({ width: 1440, height: 900 });
		await page.goto(BASE + route, { waitUntil: "networkidle2", timeout: 60000 });
		// The rest state is a hover device's, and a CI runner has no pointer: `(hover: hover)` is false there
		// and the control shows at full strength, so the state under test never rendered (#589's first run:
		// the plant read 9.67:1). The site's own `(hover: hover)` rules for the control are copied out of
		// their media block and applied as they are, on any runner — the value stays in scene-ctl.css.
		const hoverRules = await page.evaluate(() => {
			const out = [];
			const walk = (list) => {
				for (const r of list) {
					if (r.type === CSSRule.MEDIA_RULE && /hover:\s*hover/.test(r.conditionText || r.media.mediaText)) {
						for (const x of r.cssRules) if (x.selectorText && /scene__ctl/.test(x.selectorText) && !/:hover|:focus/.test(x.selectorText)) out.push(x.cssText);
					} else if (r.type === CSSRule.MEDIA_RULE || r.type === CSSRule.SUPPORTS_RULE || r.type === CSSRule.LAYER_BLOCK_RULE) walk(r.cssRules);
				}
			};
			for (const sh of document.styleSheets) {
				try { walk(sh.cssRules); } catch { /* cross-origin sheet */ }
			}
			const st = document.createElement("style");
			st.textContent = out.join("\n") + "\n.scene__ctl { transition: none !important; }";
			document.head.append(st);
			return out.length;
		});
		if (!hoverRules) throw new Error("1.4.11: no `(hover: hover)` rule for .scene__ctl found in the stylesheets — the rest state cannot be measured");
		if (plant) await page.addStyleTag({ content: plant });
		await page.mouse.move(2, 2);
		if (frame === undefined) {
			await page.waitForFunction(() => document.querySelector(".s-hero--scene")?.classList.contains("is-done"), { timeout: 20000 });
		} else {
			// the rail's own move (`.design-sync/verify/frame.cjs`): every animation of the band and the header pinned,
			// 3 s into the frame, on the stylesheet's own clock — never a copy of it, which pins the wrong frame the day
			// the clock changes and still reads green (#682)
			await page.evaluate((f) => {
				const ms = (name) => {
					const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
					return raw.endsWith("ms") ? parseFloat(raw) : parseFloat(raw) * 1000;
				};
				const t = ms("--hero-cycle") + f * ms("--hero-step") - 500 + 3000;
				if (!Number.isFinite(t)) throw new Error("1.4.11: no --hero-cycle / --hero-step to pin a frame on");
				for (const a of [...document.querySelector(".s-hero").getAnimations({ subtree: true }), ...(document.querySelector(".site-header")?.getAnimations() ?? [])]) {
					a.pause();
					a.currentTime = t;
				}
				// the frame on screen must be the one asked for: «nosotros» is the index, a photograph its caption
				const item = [...document.querySelectorAll(".s-hero__item")].findIndex((e) => +getComputedStyle(e).opacity > 0.5);
				const shows = +getComputedStyle(document.querySelector(".s-hero__verticals")).opacity > 0.5 ? 0 : item === -1 ? "none" : item + 1;
				if (shows !== f) throw new Error(`1.4.11: frame ${f} pinned at ${t} ms, but the band shows frame ${shows} — the clock was read wrong`);
			}, frame);
		}
		await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
		const box = await (await page.$(".scene__pause-btn")).boundingBox();
		const shot = await page.screenshot({ clip: { x: box.x, y: box.y, width: 40, height: 40 }, encoding: "base64" });
		const c = await page.evaluate(glyphContrast, shot);
		await page.close();
		return c;
	};
	// the plant: a control faded to 0.2 on the brightest photograph must be called
	const planted = await measure(browsers[0], verticals.find((v) => /comercio/.test(v)) ?? verticals[0], { plant: ".scene__ctl { opacity: .2 !important; }" });
	if (planted >= CTL_MIN) {
		console.error(`  ✗ positive control: a control at 0.2 opacity read ${planted.toFixed(2)}:1 — the probe is blind`);
		process.exit(2);
	}
	ok(`positive control: a control at 0.2 opacity read ${planted.toFixed(2)}:1 and is called`);
	const cases = [...[0, 1, 2, 3, 4, 5, 6].map((frame) => ({ route: "/", frame })), ...verticals.map((route) => ({ route }))];
	await inParallel(cases, async ({ route, frame }, lane, report) => {
		const c = await measure(lane, route, { frame });
		const where = frame === undefined ? `${route} at rest` : `${route} frame ${frame}`;
		if (c < CTL_MIN) report.fail(route, `the pause at rest reads ${c.toFixed(2)}:1 on its photograph${frame === undefined ? "" : ` (frame ${frame})`}, under ${CTL_MIN}:1 (1.4.11)`);
		else report.ok(`${where} — ${c.toFixed(2)}:1`);
	});
}

// ── 8c. WCAG 2.2.2 and 2.5.3 — what still moves, and names that say what shows (#505) ──
// 2.2.2: nothing may blink or move past 5 s without a way to stop it. The header's cursor, the mark's and
// the about console's blinked forever, and the home's pause left the header's edge cycling (measured
// 2026-10-16, WCAG-EM #505). At 6 s, anything still running must sit in a band whose pause stops it — so
// the pause is pressed and nothing may run after. 2.5.3: a control's accessible name contains the label on
// screen — "click ES" by voice found nothing on English pages, whose switcher was named "Switch to the
// Spanish version".
console.log("── 2.2.2 nothing moves past 5 s unstoppable · 2.5.3 the name holds the visible label");
{
	const MOVING = () => document.getAnimations().filter((a) => a.playState === "running").map((a) => {
		const t = a.effect?.target;
		const el = t?.nodeType === 1 ? t : null;
		return `${a.animationName || a.constructor.name} on ${el ? String(el.className || el.tagName).slice(0, 40) : "a pseudo-element"}`;
	});
	const LABELS = () => {
		const vis = (e) => (e.innerText || "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
		return [...document.querySelectorAll("a[aria-label], button[aria-label], [role=button][aria-label]")]
			.filter((e) => e.getClientRects().length && vis(e) && !e.getAttribute("aria-label").replace(/[^\p{L}\p{N}]+/gu, " ").toLowerCase().includes(vis(e)))
			.map((e) => `«${e.innerText.trim()}» named «${e.getAttribute("aria-label")}»`);
	};
	const probe = async (lane, route, plant) => {
		const page = await lane.newPage();
		await page.setViewport({ width: 1440, height: 900 });
		await page.goto(BASE + route, { waitUntil: "networkidle2", timeout: 60000 });
		if (plant) await page.evaluate((p) => {
			const st = document.createElement("style");
			st.textContent = "@keyframes a11y-plant { 50% { opacity: 0; } } .a11y-plant { animation: a11y-plant 1s steps(1) infinite; }";
			document.head.append(st);
			document.body.insertAdjacentHTML("beforeend", '<a href="#" class="a11y-plant" aria-label="Foo">Bar</a><h2 class="a11y-plant-h">Plant</h2>');
			st.textContent += ' .a11y-plant-h::before { content: "~ "; }';
		}, plant);
		const labels = await page.evaluate(LABELS);
		// decorative generated content must not be read: a heading named "~ …", a bare pause glyph (#505)
		const tree = await page.accessibility.snapshot({ interestingOnly: false });
		const spoken = [];
		const walk = (n) => {
			if (!n) return;
			const nm = (n.name || "").trim();
			// a heading that opens on a sign, and a text node that is nothing but signs (plain punctuation aside)
			if (n.role === "heading" && /^[^\p{L}\p{N}¿¡«"'(]/u.test(nm)) spoken.push(`heading read as «${nm}»`);
			if (/^(StaticText|text)$/.test(n.role) && nm && !/[\p{L}\p{N}]/u.test(nm) && !/^[.,;:·()«»"'¡!¿?—–-]+$/.test(nm)) spoken.push(`a bare «${nm}» in the tree`);
			for (const c of n.children || []) walk(c);
		};
		walk(tree);
		for (const x of spoken) labels.push(`decoration read aloud: ${x}`);
		await page.waitForFunction(() => document.timeline.currentTime >= 6000, { polling: 200, timeout: 30000 });
		if (await page.$(".s-hero .scene__pause-btn")) {
			await page.click(".s-hero .scene__pause-btn");
			await new Promise((r) => setTimeout(r, 300));
		}
		const moving = await page.evaluate(MOVING);
		await page.close();
		return { moving, labels };
	};
	const plant = await probe(browsers[0], "/en", true);
	const plantHeard = plant.labels.some((l) => l.includes("«~ Plant»"));
	if (!plant.moving.some((m) => m.includes("a11y-plant")) || !plant.labels.some((l) => l.includes("Foo")) || !plantHeard) {
		console.error(`  ✗ positive control: a planted endless blink (${plant.moving.length ? "seen" : "MISSED"}), a planted mismatched name (${plant.labels.some((l) => l.includes("Foo")) ? "seen" : "MISSED"}) and a planted tilde read aloud (${plantHeard ? "seen" : "MISSED"}) — the probe is blind`);
		process.exit(2);
	}
	ok("positive control: a planted endless blink, a name without its label and a tilde read aloud are all called");
	const verticals = readSeed().content.services.filter((e) => e.locale !== "en").map((e) => entryPath("services", e));
	const routes = ["/", "/en", "/quienes-somos", "/en/about-us", "/contacto", verticals[0]];
	await inParallel(routes, async (route, lane, report) => {
		const r = await probe(lane, route, false);
		for (const m of r.moving) report.fail(route, `still running at 6 s with no way to stop it (2.2.2): ${m}`);
		for (const l of r.labels) report.fail(route, l.startsWith("decoration read aloud") ? `${l} (1.3.1: hide it with content: "…" / "")` : `accessible name without its visible label (2.5.3): ${l}`);
		if (!r.moving.length && !r.labels.length) report.ok(`${route} — nothing moves past 6 s unstoppable, every name holds its label`);
	});
}

// ── 9. W3C Nu — the rules html-validate does not carry ─────────────────────
// The local suite validates with html-validate; CI additionally runs Nu after
// the deploy. They disagree, and the gap is not academic: `aria-hidden` on a
// label bound to a control passed html-validate and was rejected by Nu, after
// the merge. Running Nu here closes the loop before the push. An unreachable
// validator warns rather than fails — an external outage must not block a
// pull request — but a REACHED validator reporting errors is a hard failure.
console.log("── W3C Nu (2 pages, one per locale)");
for (const route of ["/", "/en/e-commerce"]) {
	const page = await browser.newPage();
	await page.goto(BASE + route, { waitUntil: "networkidle2", timeout: 60000 });
	const html = await page.content();
	await page.close();
	let json;
	try {
		const r = await fetch("https://validator.w3.org/nu/?out=json", {
			method: "POST",
			headers: { "Content-Type": "text/html; charset=utf-8" },
			body: html,
			signal: AbortSignal.timeout(40000),
		});
		json = await r.json();
	} catch {
		console.log(`  warn ${route} — validator unreachable, skipped (not a failure)`);
		continue;
	}
	const errors = (json.messages || []).filter((m) => m.type === "error");
	if (errors.length) {
		for (const e of errors) fail(route, `W3C Nu: ${e.message}`);
	} else {
		ok(`${route} — 0 Nu errors`);
	}
}

await Promise.all(browsers.map((b) => b.close()));

if (failures.length) {
	console.error(`\n✗ ${failures.length} accessibility failure(s):`);
	for (const f of failures) console.error(`  ${f}`);
	process.exit(1);
}
console.log("\na11y: all checks green");
