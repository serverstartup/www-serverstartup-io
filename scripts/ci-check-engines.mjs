#!/usr/bin/env node
/**
 * ci-check-engines.mjs — the openings in Safari's engine and on an Android profile (#583).
 *
 * Every other rendered gate runs Chromium alone. Two things on 2026-10-10 showed what that misses:
 *
 *   - The October home (#581) animates the title's tail colour and the card's height with `var()`
 *     inside `@keyframes`, a pattern the home rule had flagged as risky in some engine. It was
 *     checked by hand in Playwright WebKit, against the preview. Nothing re-checks it.
 *   - An Android phone showed the verticals' end state with no animation. Chromium on the Pixel 7
 *     profile with reduced motion reproduces it exactly: Android's "Remove animations", which some
 *     battery savers turn on, is `prefers-reduced-motion: reduce`, and #315 makes every opening start
 *     at its end. Intended — so it is asserted here as intended, and the next report of it can be
 *     told apart from a real failure in seconds.
 *
 * Three profiles — WebKit · iPhone 13, WebKit · Desktop Safari, Chromium · Pixel 7 — each in its own
 * browser, run side by side. On each:
 *
 *   H  the home (/, /en), on the real clock: the title's tail has three different colours on frames
 *      0, 1 and 2 (sampled mid-frame on the document's timeline), the card changes height between
 *      frames 0 and 1 from 768 px up and holds it on a phone (#572: there the card is in the flow,
 *      above the picture, which would jump with it), and every stop of the rail is a button.
 *   V  every vertical (the seed's Spanish services): it reaches `is-playing`, then `is-done` within
 *      SCENE_BEATS.end of starting, plus a margin.
 *   R  reduced motion: every vertical starts `is-done`, nothing runs in the home's band, and no
 *      pause or replay is shown — there is nothing for it to stop.
 *   A  reduced motion on the home, used (#718): every row of the «nosotros» index is what a pointer reaches at its
 *      centre, and a real click on a stop pins that frame — its seal, its card, its photograph.
 *   P  the home's pause, at load: inside the first screen, below the header, and on no text (#681 —
 *      after #572 it sat at the band's foot, 180–440 px under a phone's fold); on a phone also at 360
 *      and 320 px, the narrowest widths, where the h1's first line comes closest to it.
 *
 * Before any of it, each profile must catch its planted defects: a stylesheet that freezes the
 * tail's colour, a vertical whose scene script never arrives, a label on the h1, a card that
 * does the opposite of what that width expects (animated on a phone, frozen from 768 px up), a
 * pause pushed a screen down, a pause lifted under the header, a word under the pause, and — under reduced motion —
 * the card list back over the index and stops whose script never arrives (#718). A profile that misses any is blind and
 * the run exits 3 — as it does when an engine fails to launch.
 *
 * Exit: 0 green · 1 a defect · 3 blind (an engine missing, a plant not seen, the stack gone).
 *
 * Usage: node scripts/ci-check-engines.mjs [base-url]   default :8787
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices, webkit } from "playwright";
import { entryPath, readSeed } from "./lib/seed-routes.mjs";
import { stackDiagnosis } from "./lib/stack-probe.mjs";

const BASE = (process.argv[2] || "http://localhost:8787").replace(/\/$/, "");
const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

const PROFILES = [
	{ name: "WebKit · iPhone 13", engine: webkit, device: "iPhone 13" },
	{ name: "WebKit · Desktop Safari", engine: webkit, device: "Desktop Safari" },
	{ name: "Chromium · Pixel 7", engine: chromium, device: "Pixel 7" },
];
const HOME = ["/", "/en"];
const VERTICALS = readSeed()
	.content.services.filter((e) => e.locale !== "en")
	.map((e) => entryPath("services", e))
	.sort();
/* the openings' one clock, read where it is declared rather than restated */
const BEATS = readFileSync(join(REPO, "src", "utils", "hero-art.ts"), "utf8").match(/SCENE_BEATS\s*=\s*\{([^}]*)\}/)[1];
const beat = (name) => Number(BEATS.match(new RegExp(`\\b${name}:\\s*(\\d+)`))[1]);
const END = beat("end");
/* the instant the copy-overlap check reads: just into the payoff, when the drawings and their labels are all out
   (the bridge is wired at drawn + 100, the elevation's photograph comes in at 5.6 s) */
const LABELS_OUT = beat("drawn") + 500;
const MARGIN = 4000;
const LANES = 3;

/* A page that cannot be reached is not a defect of the page: say what the stack was doing and exit blind.
   Top-level awaits reject outside `unhandledRejection`, so the run is wrapped below as well. */
async function blindOn(e) {
	console.error(String(e?.stack ?? e).split("\n").slice(0, 3).join("\n"));
	console.error(await stackDiagnosis(BASE).catch(() => "(stack probe failed)"));
	process.exit(3);
}
process.on("unhandledRejection", blindOn);

/* One browser per page. Chromium animates only the page it treats as shown, and a context of its own
   is not enough: two homes measured beside three verticals in one Chromium held the tail at its
   unanimated ink and the card at its static 660 px, while the same page alone animated (a93d377 found
   the same with Puppeteer). WebKit did not need it; one rule for every engine is simpler to trust. */
/* At most PAGES pages at once across the three profiles. Up to fifteen at a time (three profiles × two homes and
   three lanes) took `wrangler dev` down twice in one CI job — its ProxyWorker drops the runtime under concurrent
   load (cloudflare/workers-sdk#15317, #524) — and `ci-gate.mjs` reboots it only once. Four, the a11y gate's
   number, still lost the stack in about a quarter of jobs on wrangler 4.127.1 (#638); the upstream fix in 4.129.1
   makes such a failure one request, not the stack. */
const PAGES = Math.max(1, Number(process.env.ENGINES_CONCURRENCY) || 4);
let open = 0;
const waiting = [];
async function slot(fn) {
	if (open >= PAGES) await new Promise((r) => waiting.push(r));
	open++;
	try {
		return await fn();
	} finally {
		open--;
		waiting.shift()?.();
	}
}
async function withPage(profile, opts, fn) {
	return slot(async () => {
		const browser = await profile.engine.launch();
		try {
			const ctx = await browser.newContext({ ...devices[profile.device], ...opts });
			return await fn(await ctx.newPage());
		} finally {
			await browser.close();
		}
	});
}

async function pool(items, n, fn) {
	const out = [];
	const queue = [...items];
	await Promise.all(Array.from({ length: n }, async () => {
		while (queue.length) out.push(await fn(queue.shift()));
	}));
	return out;
}

const plantStyle = (css) => `document.addEventListener("DOMContentLoaded", () => {
	const s = document.createElement("style");
	s.textContent = ${JSON.stringify(css)};
	document.head.append(s);
});`;

/** H — the problems found on one home route, and the tail's colour on frame 0 (what reduced motion must hold). */
async function home(page, route) {
	await page.goto(`${BASE}${route}?engines=${Date.now()}`, { waitUntil: "load", timeout: 60_000 });
	const step = await page.evaluate(() => {
		const cycle = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hero-cycle")) * 1000;
		return cycle / document.querySelectorAll(".s-hero__dots .s-hero__stop").length;
	});
	if (!(step > 0)) return { problems: [`${route}: no rail, or no --hero-cycle — the band is not there to measure`] };
	/* Sampled mid-frame on the tail animation's OWN clock — its iteration and progress, in frames — never on
	   the document's: on a loaded runner the band's animations start seconds after the timeline does, and
	   "9 s" on the document read frame 0 twice in WebKit (CI, #589). The band always opens on frame 0. */
	const frames = [];
	for (const f of [0, 1, 2]) {
		const reached = await page.waitForFunction((at) => {
			const t = document.querySelector(".ss-title__tail")?.getAnimations()[0]?.effect?.getComputedTiming();
			const n = document.querySelectorAll(".s-hero__dots .s-hero__stop").length;
			return !!t && t.progress !== null && ((t.currentIteration ?? 0) + t.progress) * n >= at;
		}, f + 0.5, { polling: 100, timeout: step + 30_000 }).catch(() => null);
		if (!reached) return { problems: [`${route}: the tail's colour never reached frame ${f} — it does not animate`] };
		frames.push(await page.evaluate(() => ({
			tail: getComputedStyle(document.querySelector(".ss-title__tail")).color,
			deck: Math.round(document.querySelector(".s-hero__deck").getBoundingClientRect().height),
			// the taller of the deck's two states: the index, or the tallest caption
			tallest: Math.max(...[...document.querySelectorAll(".s-hero__verticals, .s-hero__item")].map((e) => e.offsetHeight)),
		})));
	}
	const stops = await page.evaluate(() => [...document.querySelectorAll(".s-hero__dots .s-hero__stop")].map((s) => s.getAttribute("role") === "button" && s.tabIndex === 0));
	const problems = [];
	const tails = frames.map((x) => x.tail);
	if (new Set(tails).size !== 3) problems.push(`${route}: the tail's colour on frames 0/1/2 is ${tails.join(" / ")} — it should change on each`);
	// phones hold the card at its taller state (#572); from 768 px it follows the frame
	const phone = (page.viewportSize()?.width ?? 1280) < 768;
	if (phone && frames[0].deck !== frames[1].deck)
		problems.push(`${route}: the card goes from ${frames[0].deck}px to ${frames[1].deck}px between frames 0 and 1 — on a phone it holds its taller state, or the picture under it jumps`);
	else if (phone && Math.abs(frames[0].deck - frames[0].tallest) > 1)
		problems.push(`${route}: the card holds ${frames[0].deck}px where its taller state is ${frames[0].tallest}px — on a phone it holds its taller state, or a caption is clipped`);
	if (!phone && frames[0].deck === frames[1].deck) problems.push(`${route}: the card stays ${frames[0].deck}px between frames 0 and 1 — it should change height`);
	if (!stops.length || stops.includes(false)) problems.push(`${route}: ${stops.filter((x) => !x).length} of ${stops.length} rail stops are not buttons`);
	return { problems, tail0: tails[0] };
}

/** P — the home's pause where this profile's first screen shows it (#681): below the header, above the fold, on no
    text in the band. Read at load, before any scroll; `plant` pushes it a screen down, lifts it under the header, or puts
    a word under it — one plant per bound. */
async function pauseInView(page, route, plant) {
	await page.goto(`${BASE}${route}?engines=${Date.now()}`, { waitUntil: "load", timeout: 60_000 });
	return page.evaluate(([route, plant]) => {
		const ctl = document.querySelector(".s-hero--home .scene__ctl");
		if (!ctl) return [`${route}: no pause in the home's band`];
		if (plant === "fold") ctl.style.translate = "0 100vh";
		if (plant === "header") Object.assign(ctl.style, { top: "0px", bottom: "auto" });
		if (plant === "word") {
			const c = ctl.getBoundingClientRect(), band = document.querySelector(".s-hero--home");
			const s = document.createElement("span");
			s.textContent = "PLANT";
			s.style.cssText = `position:absolute;left:${c.left - band.getBoundingClientRect().left + 4}px;top:${c.top - band.getBoundingClientRect().top + 4}px;color:#fff`;
			band.append(s);
		}
		const c = ctl.getBoundingClientRect();
		/* the header is the first screen's top bound: with no header there is nothing to measure "below" against, and a
		   silent 0 would pass a control hidden under it */
		const header = document.querySelector(".site-header");
		if (!header) return [`${route}: no .site-header — the pause's top bound cannot be measured`];
		const top = header.getBoundingClientRect().bottom;
		const problems = [];
		if (c.top < top || c.bottom > innerHeight)
			problems.push(`${route} at ${innerWidth} px: the pause is at y ${Math.round(c.top)}–${Math.round(c.bottom)}, outside the first screen (${Math.round(top)}–${innerHeight}) — the band can only be stopped after a scroll`);
		/* every painted text line in the band, the control's own glyphs aside; opacity read up the whole chain */
		const seen = (e) => { for (let x = e; x && x.nodeType === 1; x = x.parentElement) { const s = getComputedStyle(x); if (s.display === "none" || s.visibility === "hidden" || +s.opacity < 0.05) return false; } return true; };
		const walk = document.createTreeWalker(document.querySelector(".s-hero--home"), NodeFilter.SHOW_TEXT);
		for (let n; (n = walk.nextNode());) {
			if (!n.textContent.trim() || n.parentElement.closest(".scene__ctl") || !seen(n.parentElement)) continue;
			const r = document.createRange();
			r.selectNodeContents(n);
			const under = [...r.getClientRects()].some((q) => Math.min(q.right, c.right) - Math.max(q.left, c.left) > 1 && Math.min(q.bottom, c.bottom) - Math.max(q.top, c.top) > 1);
			if (under) problems.push(`${route} at ${innerWidth} px: the pause covers «${n.textContent.trim().slice(0, 24)}»`);
		}
		return problems;
	}, [route, plant]);
}

/* O — the scene's own text against the copy's lines, mid-animation: what is painted (opacity read up the whole
   chain, so a label under a fade still counts) and not part of the copy, the epigraph or the controls. The copy's
   selectors are restated here on purpose — a check that imported the scenes' own list would agree with them by
   construction. At 1280 × 720 (Desktop Safari) the elevation's bubbles D and E stood behind the body (#547). */
function overlapsCopy() {
	const seen = (e) => { for (let x = e; x && x.nodeType === 1; x = x.parentElement) { const c = getComputedStyle(x); if (c.display === "none" || c.visibility === "hidden" || +c.opacity < 0.05) return false; } return true; };
	const lines = (els) => els.flatMap((el) => [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).flatMap((n) => { const r = document.createRange(); r.selectNodeContents(n); return [...r.getClientRects()].filter((q) => q.width > 2); }));
	const band = document.querySelector(".s-hero--scene");
	const COPY = "h1, .s-hero__copy, .s-hero__body, .scene__epi, .s-hero__epigraph, figure, blockquote, .scene__ctl, .btn";
	const all = [...band.querySelectorAll("*")].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
	const copy = lines(all.filter((e) => e.closest(".s-hero__copy, h1") && seen(e)));
	const btn = band.querySelector(".s-hero__copy .btn")?.getBoundingClientRect();
	if (btn) copy.push(btn);
	const out = [];
	for (const e of all.filter((x) => !x.closest(COPY) && seen(x))) for (const a of lines([e])) for (const c of copy) {
		const w = Math.min(a.right, c.right) - Math.max(a.left, c.left), h = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
		if (w > 1 && h > 1) { out.push(`«${e.textContent.trim().slice(0, 20)}» on the copy at ${Math.round(a.left)},${Math.round(a.top)}`); break; }
	}
	return [...new Set(out)];
}

/** V — returns the problems found on one vertical, and how long its opening took. */
async function vertical(page, route, plant) {
	await page.goto(`${BASE}${route}?engines=${Date.now()}`, { waitUntil: "load", timeout: 60_000 });
	const started = await page.waitForFunction(() => {
		const h = document.querySelector(".s-hero--scene");
		return !h || h.classList.contains("is-playing") || h.classList.contains("is-done");
	}, null, { polling: 100, timeout: 5000 }).then(() => true, () => false);
	const scene = await page.evaluate(() => !!document.querySelector(".s-hero--scene"));
	if (!scene) return { problems: [`${route}: no opening scene on a vertical`] };
	if (!started) return { problems: [`${route}: the opening never started (no is-playing 5 s after load)`] };
	const t0 = await page.evaluate(() => performance.now());
	if (plant) await page.evaluate(() => {
		const h = document.querySelector(".s-hero--scene h1").getBoundingClientRect();
		const s = document.createElement("span");
		s.textContent = "PLANT";
		s.style.cssText = `position:fixed;left:${h.left + 4}px;top:${h.top + 4}px;color:#fff;z-index:9`;
		document.querySelector(".s-hero__stage").append(s);
	});
	/* just into the payoff, the labels all out (LABELS_OUT, from the openings' clock) */
	await page.waitForTimeout(LABELS_OUT);
	const onCopy = (await page.evaluate(overlapsCopy)).map((m) => `${route}: scene text ${m} (keep it off the copy: withhold it)`);
	const done = await page.waitForFunction(() => document.querySelector(".s-hero--scene").classList.contains("is-done"), null, { polling: 100, timeout: END + MARGIN })
		.then(() => true, () => false);
	const took = Math.round((await page.evaluate(() => performance.now())) - t0);
	return { problems: [...onCopy, ...(done ? [] : [`${route}: started but not is-done ${END + MARGIN} ms later`])], took };
}

/** R — reduced motion, on one route: the end state at once, nothing running, no controls; on the home, the tail in
    its frame-0 colour as the same profile drew it with motion. */
async function reduced(page, route, tail0) {
	await page.goto(`${BASE}${route}?engines=${Date.now()}`, { waitUntil: "load", timeout: 60_000 });
	await page.waitForTimeout(500);
	return page.evaluate(([route, tail0]) => {
		const problems = [];
		const band = document.querySelector(".s-hero--home") ?? document.querySelector(".s-hero--scene");
		if (!band) return [`${route}: no band`];
		if (band.classList.contains("s-hero--scene") && !band.classList.contains("is-done")) problems.push(`${route}: the opening does not start at its end`);
		const running = band.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length;
		if (running) problems.push(`${route}: ${running} animation(s) still running in the band`);
		const shown = [...document.querySelectorAll(".scene__ctl")].filter((c) => getComputedStyle(c).display !== "none").length;
		if (shown) problems.push(`${route}: a pause/replay control is shown with nothing to stop`);
		const tail = document.querySelector(".ss-title__tail");
		if (tail0 && tail && getComputedStyle(tail).color !== tail0) problems.push(`${route}: the tail is ${getComputedStyle(tail).color}, not frame 0's ${tail0} — the band does not hold its first frame`);
		return problems;
	}, [route, tail0]);
}

/** A — reduced motion on the home, used rather than looked at (#718): with no clock running, every row of the
    «nosotros» index must be the topmost thing under its own centre (what a hover and a click reach), and a
    real click on a stop must pin that stop's frame — its seal lit, its card shown, the photograph in. Before
    #718 four rows of six (six on a phone) sat under the hidden card list and every stop did nothing, while R
    stayed green: nothing running and no pause shown is also what a dead band looks like. */
async function answers(page, route) {
	await page.goto(`${BASE}${route}?engines=${Date.now()}`, { waitUntil: "load", timeout: 60_000 });
	await page.waitForTimeout(500);
	const problems = [];
	const covered = await page.evaluate(() => [...document.querySelectorAll(".s-hero__vlink")].flatMap((a) => {
		a.scrollIntoView({ block: "center", behavior: "instant" });
		const r = a.getClientRects()[0];
		if (!r) return [`«${a.textContent.trim()}» is not rendered`];
		const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
		return top && (top === a || a.contains(top)) ? [] : [`«${a.textContent.replace(/\s+/g, " ").trim()}» is under ${top ? top.tagName.toLowerCase() + "." + String(top.className).split(" ")[0] : "nothing"}`];
	}));
	if (!covered.length && (await page.locator(".s-hero__vlink").count()) !== 6) covered.push(`${await page.locator(".s-hero__vlink").count()} index rows, not 6`);
	for (const c of covered) problems.push(`${route}: reduced motion, an index row a pointer cannot reach — ${c}`);
	for (const k of [3, 6, 0]) {
		const at = await page.evaluate((i) => {
			const s = document.querySelectorAll(".s-hero__stop")[i];
			s.scrollIntoView({ block: "center", behavior: "instant" });
			const r = s.getBoundingClientRect();
			return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		}, k);
		await page.mouse.click(at.x, at.y);
		await page.waitForTimeout(300);
		const shown = await page.evaluate(() => {
			const lit = (els) => { const o = [...els].map((e) => Number(getComputedStyle(e).opacity)); return o.indexOf(Math.max(...o)); };
			const seen = (e) => getComputedStyle(e).visibility === "visible" && Number(getComputedStyle(e).opacity) > 0.5;
			const items = [...document.querySelectorAll(".s-hero__item")];
			const card = items.findIndex(seen) + 1 || (seen(document.querySelector(".s-hero__verticals")) ? 0 : -1);
			const photos = [...document.querySelectorAll(".s-hero__photo")];
			const photo = photos.some(seen) ? lit(photos) + 1 : 0;
			return { seal: lit(document.querySelectorAll(".s-hero__seal")), card, photo };
		});
		if (shown.seal !== k || shown.card !== k || shown.photo !== k) problems.push(`${route}: reduced motion, stop ${k} clicked — seal ${shown.seal}, card ${shown.card}, photograph ${shown.photo}; expected ${k} for all three`);
	}
	return problems;
}

async function profileRun(p) {
	try {
		await (await p.engine.launch()).close();
	} catch (e) {
		return { p, blind: `${p.name}: the engine did not launch — ${String(e.message).split("\n")[0]} (locally: npx playwright install --with-deps webkit chromium-headless-shell; in CI the Playwright image carries them, so check its tag against package.json)` };
	}
	const t0 = Date.now();
	{
		/* the plants: every one must be called, or this profile is not measuring anything */
		const phone = devices[p.device].viewport.width < 768;
		const [frozen, stalled, covered, flipped, sunk, lifted, worded, buried, dead] = await Promise.all([
			withPage(p, {}, async (page) => {
				await page.addInitScript(plantStyle(".ss-title__tail { animation: none !important; }"));
				return (await home(page, "/")).problems;
			}),
			withPage(p, {}, async (page) => {
				await page.route(/\/_astro\/Hero[A-Za-z]+\.astro_astro_type_script/, (r) => r.abort());
				return (await vertical(page, VERTICALS[0])).problems;
			}),
			withPage(p, {}, async (page) => (await vertical(page, VERTICALS[0], true)).problems),
			/* the card's height, the wrong way round for this width: a phone's deck animated again as on a
			   tablet, a desktop's frozen at one height */
			withPage(p, {}, async (page) => {
				await page.addInitScript(plantStyle(phone
					? ".s-hero--home .s-hero__deck { animation: s-hero-deck var(--hero-cycle) linear 0.2s infinite !important; }"
					: ".s-hero__deck { animation: none !important; height: 120px !important; }"));
				return (await home(page, "/")).problems;
			}),
			withPage(p, {}, (page) => pauseInView(page, "/", "fold")),
			withPage(p, {}, (page) => pauseInView(page, "/", "header")),
			withPage(p, {}, (page) => pauseInView(page, "/", "word")),
			/* #718, both halves: the card list back over the index, and stops whose script never arrives */
			withPage(p, { reducedMotion: "reduce" }, async (page) => {
				await page.addInitScript(plantStyle(".s-hero__index { pointer-events: auto !important; }"));
				return answers(page, "/");
			}),
			withPage(p, { reducedMotion: "reduce" }, async (page) => {
				await page.route(/\/_astro\/HomepageContent\.astro_astro_type_script/, (r) => r.abort());
				return answers(page, "/");
			}),
		]);
		const onCopy = covered.some((m) => m.includes("PLANT"));
		const deck = flipped.some((m) => m.includes(phone ? "holds its taller state" : "should change height"));
		const fold = sunk.some((m) => m.includes("outside the first screen"));
		const under = lifted.some((m) => m.includes("outside the first screen"));
		const word = worded.some((m) => m.includes("«PLANT»"));
		const reach = buried.some((m) => m.includes("cannot reach"));
		const pin = dead.some((m) => m.includes("clicked"));
		const seen = frozen.some((m) => m.includes("tail")) && stalled.some((m) => m.includes("never started")) && onCopy && deck && fold && under && word && reach && pin;
		if (!seen) return { p, blind: `${p.name}: a planted defect went unseen (frozen tail: ${frozen.length ? "seen" : "MISSED"}, scene script withheld: ${stalled.length ? "seen" : "MISSED"}, a label on the h1: ${onCopy ? "seen" : "MISSED"}, the card ${phone ? "animated on a phone" : "frozen"}: ${deck ? "seen" : "MISSED"}, the pause a screen down: ${fold ? "seen" : "MISSED"}, the pause under the header: ${under ? "seen" : "MISSED"}, a word under the pause: ${word ? "seen" : "MISSED"}, the index covered under reduced motion: ${reach ? "seen" : "MISSED"}, stops that pin nothing: ${pin ? "seen" : "MISSED"})` };

		const [homes, verticals, pauses] = await Promise.all([
			Promise.all(HOME.map((r) => withPage(p, {}, (page) => home(page, r)))),
			pool(VERTICALS, LANES, (r) => withPage(p, {}, (page) => vertical(page, r)).then((v) => ({ r, ...v }))),
			/* the pause at the profile's own size and, on a phone, at the narrowest width the site holds (360) and under it
			   (320, where the h1 makes room for it): from 360 up nothing makes room, so a longer first line would run under it */
			pool(HOME.flatMap((r) => (phone ? [{}, { viewport: { width: 360, height: 780 } }, { viewport: { width: 320, height: 568 } }] : [{}]).map((o) => [r, o])),
				LANES, ([r, o]) => withPage(p, o, (page) => pauseInView(page, r))),
		]);
		const tail0 = Object.fromEntries(HOME.map((r, i) => [r, homes[i].tail0]));
		const still = await pool([...HOME, ...VERTICALS], LANES, (r) => withPage(p, { reducedMotion: "reduce" }, (page) => reduced(page, r, tail0[r])));
		const used = await pool(HOME, LANES, (r) => withPage(p, { reducedMotion: "reduce" }, (page) => answers(page, r)));
		return {
			p,
			problems: [...homes.flatMap((h) => h.problems), ...pauses.flat(), ...verticals.flatMap((v) => v.problems), ...still.flat(), ...used.flat()],
			took: verticals.map((v) => v.took).filter(Boolean),
			seconds: Math.round((Date.now() - t0) / 1000),
		};
	}
}

const started = Date.now();
const runs = await Promise.all(PROFILES.map(profileRun)).catch(blindOn);
let blind = 0, bad = 0;
for (const r of runs) {
	if (r.blind) {
		blind++;
		console.error(`✗ BLIND ${r.blind}`);
		continue;
	}
	console.log(`${r.p.name} (${r.seconds} s): plants seen (frozen tail, withheld scene script, a label on the h1, the card's height the wrong way round, the pause a screen down, the pause under the header, a word under the pause, the index covered under reduced motion, stops that pin nothing)`);
	const span = r.took.length ? `${Math.min(...r.took)}–${Math.max(...r.took)} ms` : "—";
	if (!r.problems.length) {
		console.log(`  ✓ home ${HOME.join(" ")}: the tail changes colour on frames 0/1/2, the card changes height (holds it on a phone), the rail's stops are buttons, the pause is in the first screen on no text`);
		console.log(`  ✓ ${VERTICALS.length} verticals start and come to rest (${span} from is-playing to is-done; budget ${END + MARGIN} ms), no scene text on the copy mid-animation`);
		console.log(`  ✓ reduced motion — intended (#315): every opening starts at its end, the home holds its first frame, no pause shown`);
		console.log(`  ✓ reduced motion, used (#718): every index row is under the pointer, and a stop pins its frame — seal, card and photograph`);
	}
	for (const m of r.problems) {
		bad++;
		console.error(`  ✗ ${m}`);
	}
}
console.log(`engines: ${PROFILES.length} profiles in ${Math.round((Date.now() - started) / 1000)} s`);
if (blind) process.exit(3);
if (bad) process.exit(1);
console.log(`✓ the home and ${VERTICALS.length} verticals behave the same in WebKit and on Android's Chromium, reduced motion included`);
