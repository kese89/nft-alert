// Momentum watcher v2 - tuned for early and credible signals.
//
// Two alert paths:
//  1. VELOCITY (early): holder count grows by at least the threshold per hour
//     across two consecutive measurements - fires even for small collections.
//  2. LEVEL (classic): 24h volume + sales + holder count + holder growth.
//
// Either path is verified before alerting: unique buyer ratio of recent sales.
// If few wallets ping-pong the volume (wash trading), the alert is held back
// and the collection gets a 2-hour cooldown before re-checking.

export class MomentumWatcher {
  constructor({ opensea, state, notifier, config, log }) {
    this.opensea = opensea;
    this.state = state; // state.snapshots: {slug: {hist:[{t,owners,volume1d,sales1d,floor}], alerted, holdUntil}}
    this.notifier = notifier;
    this.config = config;
    this.log = log;
  }

  // Age-based tracking: every collection discovered within TRACK_DAYS,
  // newest first, capped to protect the rate limit.
  trackedSlugs() {
    const cutoff = Date.now() - this.config.trackDays * 86400_000;
    return Object.entries(this.state.known)
      .filter(([, t]) => t >= cutoff)
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.config.trackMax)
      .map(([slug]) => slug);
  }

  // full=true: entire list; full=false: only the newest "hot" tier
  async tick(full) {
    const slugs = this.trackedSlugs();
    const targets = full ? slugs : slugs.slice(0, this.config.hotCount);
    for (const slug of targets) {
      await this.checkOne(slug);
      await new Promise((r) => setTimeout(r, this.config.requestGapMs));
    }
  }

  async checkOne(slug) {
    let entry = this.state.snapshots[slug];
    // Migrate old (v1) state format
    if (entry && !entry.hist) {
      entry = this.state.snapshots[slug] = { hist: [], alerted: !!entry.alerted, holdUntil: 0 };
    }
    if (!entry) {
      entry = this.state.snapshots[slug] = { hist: [], alerted: false, holdUntil: 0 };
    }
    if (entry.alerted) return;
    if (entry.holdUntil && Date.now() < entry.holdUntil) return;

    let stats;
    try { stats = await this.opensea.stats(slug); } catch { return; }

    const oneDay = (stats.intervals ?? []).find((i) => i.interval === "one_day") ?? {};
    entry.hist.push({
      t: Date.now(),
      owners: stats.total?.num_owners ?? 0,
      volume1d: oneDay.volume ?? 0,
      sales1d: oneDay.sales ?? 0,
      floor: stats.total?.floor_price ?? 0,
    });
    if (entry.hist.length > 8) entry.hist.shift();
    if (entry.hist.length < 3) return; // two deltas needed for confirmation

    const [a, b, c] = entry.hist.slice(-3);
    const hours1 = Math.max((b.t - a.t) / 3600_000, 0.02);
    const hours2 = Math.max((c.t - b.t) / 3600_000, 0.02);
    const d1 = b.owners - a.owners;
    const d2 = c.owners - b.owners;
    const vel1 = d1 / hours1;
    const vel2 = d2 / hours2;
    // Velocity over a tiny window is noise (e.g. +2 owners in 5 min looks
    // like 24/h). Require a minimum total window AND minimum absolute growth
    // per step, so small-number noise can't fire the early path.
    const windowOk = (c.t - a.t) >= this.config.minVelocityWindowMin * 60_000;

    // Path 1: velocity, confirmed across two measurements (can be disabled)
    const earlySignal =
      this.config.enableEarlySignal &&
      windowOk &&
      c.volume1d >= this.config.minVolume1dEthEarly &&
      c.owners >= this.config.minOwnersEarly &&
      d1 >= this.config.minOwnerDeltaEarly &&
      d2 >= this.config.minOwnerDeltaEarly &&
      vel1 >= this.config.minOwnerVelocity &&
      vel2 >= this.config.minOwnerVelocity;

    // Path 2: classic level thresholds
    const levelSignal =
      c.volume1d >= this.config.minVolume1dEth &&
      c.sales1d >= this.config.minSales1d &&
      c.owners >= this.config.minOwners &&
      c.owners - b.owners >= this.config.minOwnerGrowth;

    if (!earlySignal && !levelSignal) return;

    // Verification: unique buyer ratio in recent sales
    let buyerRatio = null;
    let sampleNote = "";
    try {
      const events = await this.opensea.saleEvents(slug, 50);
      if (events.length >= this.config.minSampleSales) {
        const buyers = new Set(events.map((e) => e.buyer).filter(Boolean));
        if (buyers.size > 0) {
          buyerRatio = buyers.size / events.length;
        } else {
          sampleNote = ` (${events.length} sales, no buyer field in API response)`;
          this.log.warn(`${slug}: sale events have no buyer field - check OpenSea API response shape`);
        }
      } else {
        sampleNote = ` (only ${events.length} sales sampled)`;
      }
    } catch (err) {
      sampleNote = " (events API error)";
      this.log.warn(`${slug}: sale events fetch failed: ${err.message}`);
    }

    if (buyerRatio !== null && buyerRatio < this.config.minUniqueBuyerRatio) {
      entry.holdUntil = Date.now() + 2 * 3600_000;
      this.log.warn(
        `${slug}: alert held back - suspicious buyer concentration (${Math.round(buyerRatio * 100)}% unique), 2h cooldown`
      );
      return;
    }

    entry.alerted = true;

    // Floor trend
    const floorArrow =
      c.floor > b.floor ? "⬆" : c.floor < b.floor ? "⬇ (someone is dumping!)" : "→";

    let name = slug, url = `https://opensea.io/collection/${slug}`;
    try {
      const info = await this.opensea.collection(slug);
      name = info.name ?? slug;
      url = info.opensea_url ?? url;
    } catch { /* not critical */ }

    const path = earlySignal ? "early velocity signal" : "level signal";
    this.log.info(`🔥 Momentum [${path}]: ${slug}`);
    await this.notifier.send({
      source: "OpenSea momentum",
      text:
        `🔥 GAINING MOMENTUM (${path})\n${name}\n` +
        `Holders: ${c.owners} | velocity: +${Math.round(vel2)}/hour\n` +
        `24h: ${c.volume1d.toFixed(2)} ETH volume, ${c.sales1d} sales\n` +
        `Unique buyers: ${buyerRatio === null ? "n/a" + sampleNote : Math.round(buyerRatio * 100) + "%"}\n` +
        `Floor: ${b.floor || "n/a"} → ${c.floor || "n/a"} ETH ${floorArrow}\n${url}`,
      matched: [path],
    });
  }
}
