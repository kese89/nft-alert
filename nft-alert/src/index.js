// NFT Alert - watches new EVM collections and fresh collections gaining
// momentum via the OpenSea API, alerts through your own Telegram bot.

import "dotenv/config";
import fs from "fs";
import { OpenSea } from "./opensea.js";
import { NewCollectionWatcher } from "./newCollections.js";
import { MomentumWatcher } from "./momentum.js";
import { Notifier } from "./notifier.js";

const log = {
  info: (m) => console.log(`[${new Date().toISOString()}] ${m}`),
  warn: (m) => console.warn(`[${new Date().toISOString()}] ⚠ ${m}`),
  error: (m) => console.error(`[${new Date().toISOString()}] ✖ ${m}`),
};

for (const key of ["OPENSEA_API_KEY", "BOT_TOKEN", "CHAT_ID"]) {
  if (!process.env[key]) {
    log.error(`Missing ${key} in .env file`);
    process.exit(1);
  }
}

const config = {
  chains: (process.env.CHAINS ?? "ethereum,base").split(",").map((s) => s.trim()).filter(Boolean),
  newPollMin: Number(process.env.NEW_POLL_MIN ?? 5),
  digestHours: Number(process.env.NEW_DIGEST_HOURS ?? 0),
  momentumPollMin: Number(process.env.MOMENTUM_POLL_MIN ?? 15),
  trackDays: Number(process.env.TRACK_DAYS ?? 7),
  trackMax: Number(process.env.TRACK_MAX ?? 300),
  hotCount: Number(process.env.HOT_COUNT ?? 30),
  hotPollMin: Number(process.env.HOT_POLL_MIN ?? 5),
  requestGapMs: Number(process.env.REQUEST_GAP_MS ?? 400),
  minOwnersEarly: Number(process.env.MIN_OWNERS_EARLY ?? 40),
  minOwnerVelocity: Number(process.env.MIN_OWNER_VELOCITY ?? 20),
  minUniqueBuyerRatio: Number(process.env.MIN_UNIQUE_BUYER_RATIO ?? 0.6),
  minSampleSales: Number(process.env.MIN_SAMPLE_SALES ?? 10),
  minVolume1dEth: Number(process.env.MIN_VOLUME_1D_ETH ?? 3),
  minSales1d: Number(process.env.MIN_SALES_1D ?? 20),
  minOwners: Number(process.env.MIN_OWNERS ?? 100),
  minOwnerGrowth: Number(process.env.MIN_OWNER_GROWTH ?? 15),
};

// State persisted to file so restarts don't re-alert on everything
const STATE_FILE = "state.json";
let state = { known: {}, snapshots: {}, primed: false };
try { state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { /* first run */ }
function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch (e) { log.warn("State save error: " + e.message); }
}

const opensea = new OpenSea({ apiKey: process.env.OPENSEA_API_KEY, log });
const notifier = new Notifier({ botToken: process.env.BOT_TOKEN, chatId: process.env.CHAT_ID, log });
const newWatcher = new NewCollectionWatcher({ opensea, chains: config.chains, state, notifier, digestHours: config.digestHours, log });
const momentum = new MomentumWatcher({ opensea, state, notifier, config, log });

log.info("=".repeat(50));
log.info(`NFT Alert starting | chains: ${config.chains.join(", ")}`);
log.info(`Level signal: ${config.minVolume1dEth} ETH/24h, ${config.minSales1d} sales, ${config.minOwners}+ holders (+${config.minOwnerGrowth})`);
log.info(`Early signal: +${config.minOwnerVelocity} holders/hour across two measurements, min ${config.minOwnersEarly} holders | buyer verification: ${config.minUniqueBuyerRatio * 100}% unique`);
log.info("=".repeat(50));

await notifier.send({
  source: "system",
  text: `NFT Alert is up. Chains: ${config.chains.join(", ")}. New collections are tracked silently - you'll get an alert when one gains momentum.`,
  matched: ["startup"],
});

async function loop(fn, minutes, name) {
  for (;;) {
    try { await fn(); saveState(); }
    catch (err) { log.error(`${name} error: ${err.message}`); }
    await new Promise((r) => setTimeout(r, minutes * 60_000));
  }
}

process.on("SIGINT", () => { saveState(); log.info("Shutting down..."); process.exit(0); });

const fullEvery = Math.max(1, Math.round(config.momentumPollMin / config.hotPollMin));
let tickNo = 0;
await Promise.all([
  loop(() => newWatcher.tick(), config.newPollMin, "New collection watcher"),
  loop(() => momentum.tick(tickNo++ % fullEvery === 0), config.hotPollMin, "Momentum watcher"),
]);
