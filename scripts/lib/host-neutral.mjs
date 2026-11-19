/**
 * Chrome flags that keep a gate from reading the machine it runs on (#718).
 *
 * A headless Chrome on macOS takes `prefers-reduced-motion` from the system's own *Reduce motion*, and
 * Puppeteer leaves it there (Playwright emulates `no-preference` by default, so the engines gate was never
 * affected). On a Mac with the setting on, every animation on the site stops and the pause controls are
 * hidden, so a gate measuring the moving band measured another page: the a11y gate died looking for a pause
 * that reduced motion hides by design, and the others measured the still state while CI, on Linux, measured
 * the moving one. Reduced motion is checked where it is meant to be — the engines gate's R and A, which ask
 * for it explicitly.
 */
export const HOST_NEUTRAL = ["--force-prefers-no-reduced-motion"];
