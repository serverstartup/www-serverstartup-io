#!/usr/bin/env node
/**
 * ci-check-hero-frames.mjs — what an opening's animation frame costs (#568).
 *
 * Big Data's Lighthouse score swung between 0.70 and 0.98 on one build. The
 * swing was blocking time: Lighthouse charged the scene's animation frames as
 * long tasks, under «Other» — canvas raster, which runs on the main thread of
 * a renderer without a GPU, Lighthouse's included. ~70% of every frame was one
 * line, `ctx.filter = "blur(3px)"` on the dusk's cut-outs, re-run on each
 * repaint although the cut-outs never move within a layout.
 *
 * Nothing could see it. Lighthouse names the script, not the line; whole-page
 * busy time could not tell blur from no blur at all; and the obvious suspect
 * (700 stars painted one by one) measured WORSE when cached. What found it was
 * driving the frames by hand. This gate is that measurement:
 *
 *   every route that asks for animation frames is loaded with the clock in
 *   our hands — performance.now and requestAnimationFrame replaced — on
 *   Lighthouse's phone viewport with the CPU slowed ×4 as Lighthouse does,
 *   and its frames are drawn from the night's beat to the end at 60 fps,
 *   each followed by a raster flush so the pixels are paid inside the frame.
 *
 *   F1  no per-pixel effect is re-run per frame: across the whole loop, the
 *       `filter` and `shadowBlur` a 2D context is given are set at most once
 *       per canvas. Constant work is done once per layout and composited.
 *       This is the defect itself, and it does not depend on the machine.
 *
 *   F2  the scene's steady frame stays under Lighthouse's long-task line,
 *       50 ms, at ×4: its 90th-percentile frame. Not its worst — the frame
 *       that builds a layout's constants is allowed over the line once (the
 *       bargain F1 asks for), and a single frame can spike on a busy machine
 *       (GC; measured 33–122 ms between three runs of one unchanged route).
 *       Main's Big Data drew EVERY frame at 41–48 ms on a fast laptop, which
 *       is what a slower runner turns into blocking time. This one depends on
 *       the machine, which is why it is the second assertion and why the
 *       figures are printed for every route either way.
 *
 * Usage: node scripts/ci-check-hero-frames.mjs [base-url] [route-regex]   default :8787, every route
 */
import puppeteer from "puppeteer";
import { seedRoutes } from "./lib/seed-routes.mjs";
import { cdpDiagnosis, stackDiagnosis } from "./lib/stack-probe.mjs";
import { HOST_NEUTRAL } from "./lib/host-neutral.mjs";

const BASE = (process.argv[2] || "http://localhost:8787").replace(/\/$/, "");
const LONG_TASK_MS = 50;
const CPU = 4;
const PHONE = { width: 412, height: 823, isMobile: true, hasTouch: true, deviceScaleFactor: 1.75 };
/* the openings' clock (SCENE_BEATS in src/utils/hero-art.ts): the night falls from `draw`, all at rest by `end` */
const FROM_MS = 2000, TO_MS = 8000, STEP_MS = 1000 / 60;

const fail = (m) => { console.error(`✗ ${m}`); };
const ok = (m) => console.log(`✓ ${m}`);

process.on("unhandledRejection", async (e) => {
	console.error(await stackDiagnosis(BASE).catch(() => cdpDiagnosis(e)));
	process.exit(3);
});

/* Installed before any of the page's scripts: the page's clock, and a count of the per-pixel effects. */
function instrument() {
	/* the real clock, kept before it is replaced: the gate's own stopwatch */
	window.__wall = performance.now.bind(performance);
	window.__now = 0;
	window.__raf = [];
	performance.now = () => window.__now;
	window.requestAnimationFrame = (cb) => window.__raf.push(cb);
	window.cancelAnimationFrame = () => {};
	window.__effects = 0;
	const proto = CanvasRenderingContext2D.prototype;
	for (const [prop, idle] of [["filter", "none"], ["shadowBlur", 0]]) {
		const d = Object.getOwnPropertyDescriptor(proto, prop);
		Object.defineProperty(proto, prop, {
			get() { return d.get.call(this); },
			set(v) { if (v !== idle && window.__counting) window.__effects++; d.set.call(this, v); },
			configurable: true,
		});
	}
}

/* Inside the page: draw every frame of the loop, flush each, and report. */
function frames([from, to, step]) {
	const contexts = () => [...document.querySelectorAll("canvas")].map((c) => c.getContext("2d")).filter(Boolean);
	const real = () => window.__wall();
	window.__counting = true;
	const all = [];
	for (let t = from; t <= to; t += step) {
		const q = window.__raf;
		window.__raf = [];
		const t0 = real();
		for (const cb of q) cb(t);
		for (const c of contexts()) c.getImageData(0, 0, 1, 1);
		const ms = real() - t0;
		all.push(ms);
	}
	window.__counting = false;
	const sorted = [...all].sort((a, b) => a - b);
	return {
		canvases: contexts().length,
		effects: window.__effects,
		n: all.length,
		mean: all.reduce((a, b) => a + b, 0) / all.length,
		p90: sorted[Math.floor(0.9 * (sorted.length - 1))],
		worst: sorted[sorted.length - 1],
		over: all.filter((ms) => ms > window.__line).length,
	};
}

/* A fresh browser for every page, as Lighthouse runs each URL. One browser shared across the routes failed
   to open the tenth page ("Target.createTarget: Session with given id not found") after one particular sequence
   of routes and never after any of its parts — a fresh profile is also the state the score is measured in. */
async function measure(load) {
	const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage", ...HOST_NEUTRAL], protocolTimeout: 300_000 });
	const page = await browser.newPage();
	try {
		await page.setViewport(PHONE);
		await page.evaluateOnNewDocument(instrument);
		await load(page);
		await page.evaluate(() => document.fonts.ready);
		/* a scene starts once its photograph is in, which `load` already waited for */
		/* polled on an interval: puppeteer's default polls on requestAnimationFrame, which is ours now and never fires */
		const animated = await page.waitForFunction(() => window.__raf.length > 0, { timeout: 1500, polling: 100 }).then(() => true, () => false);
		if (!animated) return null;
		const cdp = await page.target().createCDPSession();
		await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
		await page.evaluate((line) => (window.__line = line), LONG_TASK_MS);
		const r = await page.evaluate(frames, [FROM_MS, TO_MS, STEP_MS]);
		await cdp.detach();
		return r;
	} finally {
		await browser.close();
	}
}

/* The plant: a scene that blurs on every frame, as the dusk did. If the instrument cannot see this, it is blind. */
async function positiveControl() {
	/* a navigation, not setContent: the clock is installed on a NEW document, and setContent does not make one */
	const r = await measure((page) => page.goto("data:text/html," + encodeURIComponent(`<canvas width="600" height="400"></canvas><script>
		const c = document.querySelector("canvas").getContext("2d");
		function tick(t) {
			c.clearRect(0, 0, 600, 400);
			c.filter = "blur(3px)";
			c.fillRect(100 + (t % 300), 100, 200, 200);
			c.filter = "none";
			requestAnimationFrame(tick);
		}
		requestAnimationFrame(tick);
	</script>`)));
	if (!r || r.effects < r.n) {
		fail(`positive control: a scene blurring on each of its frames was ${r ? `counted ${r.effects} times in ${r.n} frames` : "not seen to animate"} — the instrument is blind`);
		process.exit(2);
	}
	console.log(`hero-frames: positive control ok (a planted per-frame blur counted ${r.effects} times in ${r.n} frames)`);
}

await positiveControl();

const only = process.argv[3] ? new RegExp(process.argv[3]) : null;
const routes = seedRoutes().filter((r) => !only || only.test(r));
let measured = 0, bad = 0;
for (const route of routes) {
	const r = await measure((page) => page.goto(`${BASE}${route}`, { waitUntil: "load", timeout: 60_000 }));
	if (!r) continue;
	measured++;
	const line = `${route.padEnd(36)} ${r.n} frames · mean ${r.mean.toFixed(1)} · p90 ${r.p90.toFixed(1)} · worst ${r.worst.toFixed(1)} ms (${r.over} over ${LONG_TASK_MS}) · effects ${r.effects} on ${r.canvases} canvas(es)`;
	const f1 = r.effects > r.canvases, f2 = r.p90 > LONG_TASK_MS;
	if (f1 || f2) {
		bad++;
		fail(line);
		if (f1) console.error(`    F1: a per-pixel effect (filter / shadowBlur) was set ${r.effects} times — once per frame, not once per layout. Render what is constant once and composite it (scene-dusk.ts softCutouts).`);
		if (f2) console.error(`    F2: the 90th-percentile frame took ${r.p90.toFixed(1)} ms at CPU ×${CPU}, over Lighthouse's ${LONG_TASK_MS} ms long-task line — the scene's steady frame is blocking time.`);
	} else console.log(`  ok ${line}`);
}
if (!measured) {
	fail(`no route asked for animation frames across ${routes.length} routes — the openings did not start, or the instrument broke`);
	process.exit(1);
}
if (bad) process.exit(1);
ok(`${measured} animated route(s) of ${routes.length}: no per-pixel effect re-run per frame, the steady frame under ${LONG_TASK_MS} ms at CPU ×${CPU}`);
