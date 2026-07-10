// Sends alerts through your own Telegram bot (Bot API, free).

export class Notifier {
  constructor({ botToken, chatId, log, title = null }) {
    this.botToken = botToken;
    this.chatId = chatId;
    this.log = log;
    this.title = title; // optional header line; null = none
    this.sentHashes = new Set();
  }

  #hash(text) {
    return text.toLowerCase().replace(/\s+/g, " ").slice(0, 200);
  }

  async send({ source, text, matched }) {
    const h = this.#hash(text);
    if (this.sentHashes.has(h)) {
      this.log.info("Duplicate alert, skipped");
      return;
    }
    this.sentHashes.add(h);
    if (this.sentHashes.size > 500) {
      this.sentHashes = new Set([...this.sentHashes].slice(-250));
    }

    const message =
      (this.title ? this.title + "\n" : "") +
      `📡 ${source} | ${matched.join(", ")}\n` +
      `━━━━━━━━━━━━━━\n` +
      text.slice(0, 3500);

    const res = await fetch(
      `https://api.telegram.org/bot${this.botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: message,
          disable_web_page_preview: true,
        }),
      }
    );
    if (!res.ok) {
      this.log.error(`Alert send error: ${await res.text()}`);
    } else {
      this.log.info(`✔ Alert sent [${source}]`);
    }
  }
}
