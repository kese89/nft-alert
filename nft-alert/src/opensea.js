// Minimal OpenSea v2 API client with rate-limit handling.
// Key: opensea.io/settings/developer (permanent, free)
// or instant: curl -X POST https://api.opensea.io/api/v2/auth/keys

const BASE = "https://api.opensea.io/api/v2";

export class OpenSea {
  constructor({ apiKey, log }) {
    this.apiKey = apiKey;
    this.log = log;
  }

  async get(path, params = {}) {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
    const res = await fetch(url, {
      headers: { "x-api-key": this.apiKey, accept: "application/json" },
    });
    if (res.status === 429) {
      this.log.warn("OpenSea rate limit, waiting 60s");
      await new Promise((r) => setTimeout(r, 60_000));
      return this.get(path, params);
    }
    if (!res.ok) {
      throw new Error(`OpenSea ${res.status} ${path}: ${(await res.text()).slice(0, 200)}`);
    }
    return res.json();
  }

  // Most recently created collections on a chain
  async newestCollections(chain, limit = 50) {
    const data = await this.get("/collections", {
      chain,
      order_by: "created_date",
      limit,
    });
    return data.collections ?? [];
  }

  // Collection stats: volume, sales, floor, owners
  async stats(slug) {
    const data = await this.get(`/collections/${slug}/stats`);
    return data;
  }

  // Collection base data (name, image, link)
  async collection(slug) {
    return this.get(`/collections/${slug}`);
  }
}

// Extension: recent sale events in a collection (with buyer addresses)
OpenSea.prototype.saleEvents = async function (slug, limit = 50) {
  const data = await this.get(`/events/collection/${slug}`, {
    event_type: "sale",
    limit,
  });
  return data.asset_events ?? [];
};
