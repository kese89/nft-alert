// New collection discovery: SILENTLY feeds the momentum tracking list.
// New collections appear on OpenSea every minute, so per-collection alerts
// would be unusable noise - the real signal belongs to the momentum watcher.
// Optionally sends a short periodic digest about newly discovered ones.

export class NewCollectionWatcher {
  constructor({ opensea, chains, state, notifier, digestHours, log }) {
    this.opensea = opensea;
    this.chains = chains;
    this.state = state; // state.known: {slug: timestamp}
    this.notifier = notifier;
    this.digestHours = digestHours; // 0 = no digest
    this.log = log;
    this.newSinceDigest = [];
    this.lastDigest = Date.now();
  }

  async tick() {
    let found = 0;
    for (const chain of this.chains) {
      let collections;
      try {
        collections = await this.opensea.newestCollections(chain, 50);
      } catch (err) {
        this.log.error(`New collection fetch error (${chain}): ${err.message}`);
        continue;
      }
      for (const c of collections) {
        if (!c.collection || this.state.known[c.collection]) continue;
        this.state.known[c.collection] = Date.now();
        this.newSinceDigest.push({ name: c.name ?? c.collection, chain });
        found++;
      }
    }
    if (found) this.log.info(`${found} new collection(s) discovered (silent, added to momentum tracking)`);

    // Optional digest
    if (
      this.digestHours > 0 &&
      Date.now() - this.lastDigest >= this.digestHours * 3600_000 &&
      this.newSinceDigest.length
    ) {
      const n = this.newSinceDigest.length;
      const sample = this.newSinceDigest.slice(-10)
        .map((c) => `• ${c.name} (${c.chain})`).join("\n");
      await this.notifier.send({
        source: "OpenSea digest",
        text: `📋 Past ${this.digestHours}h: ${n} new collections added to tracking.\nMost recent:\n${sample}\n\nYou'll get an alert when one gains momentum.`,
        matched: ["digest"],
      });
      this.newSinceDigest = [];
      this.lastDigest = Date.now();
    }
  }
}
