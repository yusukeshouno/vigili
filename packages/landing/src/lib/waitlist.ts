"use server";

/**
 * Waitlist 投稿の server action。
 *
 * MVP の方針:
 *  - 環境変数 WAITLIST_WEBHOOK_URL が設定されていれば、そこに POST する。
 *    Notion DB、ntfy.sh、Formspree、Slack webhook など何でも良い。
 *  - 設定されていなければサーバ標準出力に log して 200 を返す。
 *    (誰でも Vercel に置いた瞬間 LP は動くが、データは消える状態)
 *
 * 本番では Vercel の env に
 *   WAITLIST_WEBHOOK_URL=https://api.notion.com/.../databases/.../query
 *   などを設定して使う想定。
 */

export interface WaitlistResult {
  ok: boolean;
  error?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u;

export async function submitWaitlist(formData: FormData): Promise<WaitlistResult> {
  const emailRaw = formData.get("email");
  const lang = formData.get("lang");
  if (typeof emailRaw !== "string") {
    return { ok: false, error: "missing email" };
  }
  const email = emailRaw.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "invalid email" };
  }
  if (email.length > 200) {
    return { ok: false, error: "too long" };
  }

  const payload = {
    email,
    lang: typeof lang === "string" ? lang : "en",
    user_agent: typeof formData.get("ua") === "string" ? formData.get("ua") : null,
    received_at: new Date().toISOString(),
  };

  const url = process.env.WAITLIST_WEBHOOK_URL;
  if (!url) {
    // ローカル開発 / 未配線時。捨てないよう stderr に残す。
    console.warn("[waitlist] WAITLIST_WEBHOOK_URL not set, logging only:", payload);
    return { ok: true };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`[waitlist] webhook returned ${res.status}`);
      return { ok: false, error: "upstream" };
    }
    return { ok: true };
  } catch (err) {
    console.error("[waitlist] fetch failed:", (err as Error).message);
    return { ok: false, error: "network" };
  }
}
