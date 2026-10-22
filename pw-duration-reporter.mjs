// Playwright reporter: prints the wall-clock suite duration on the final line.
// The built-in `list` reporter shows per-test times but no total elapsed, which
// makes a run hard to compare after a change (and after tuning `workers`).
//
//   ... 66 passed (1.3m)          <- built-in (per-test times only)
//   [timing] 132 tests in 58.4s across 5 workers — passed
//
// Wired into the Playwright config; no effect on test behaviour.
// Ported from lemon_schedule/scripts/pw-duration-reporter.mjs.

export default class DurationReporter {
  onBegin(config, suite) {
    this.startedAt = Date.now();
    this.testCount = suite.allTests().length;
    this.workers = config.workers;
  }

  onEnd(result) {
    const seconds = ((Date.now() - this.startedAt) / 1000).toFixed(1);
    const mm = Math.floor(seconds / 60);
    const ss = (seconds % 60).toFixed(1);
    const human = mm > 0 ? `${mm}m ${ss}s` : `${ss}s`;
    console.log(
      `\n[timing] ${this.testCount} tests in ${human} (${seconds}s) across ${this.workers} worker(s) — ${result.status}`,
    );
  }
}
