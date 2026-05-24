"use server";

/**
 * Waitlist 投稿の server action。
 *
 * バックエンド優先順位 (env で切り替え):
 *  1. RESEND_API_KEY + RESEND_AUDIENCE_ID → Resend の Audiences (Contacts) API に登録
 *  2. WAITLIST_WEBHOOK_URL → 任意の webhook に JSON POST (Slack / Notion / 自前)
 *  3. どちらも未設定 → サーバ stderr に warn を出して 200 (LP は動くがデータは消える)
 *
 * Resend を推奨: 無料枠で 3,000 emails/mo + Audiences 機能、launch 時に
 * audience 全員に 1 通送るだけで済む。
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

  const langStr = typeof lang === "string" ? lang : "en";

  // 1. Resend を優先
  const resendKey = process.env.RESEND_API_KEY;
  const resendAudience = process.env.RESEND_AUDIENCE_ID;
  if (resendKey && resendAudience) {
    return await sendToResend(email, langStr, resendKey, resendAudience);
  }

  // 2. 汎用 webhook fallback
  const url = process.env.WAITLIST_WEBHOOK_URL;
  if (url) {
    return await sendToWebhook(url, {
      email,
      lang: langStr,
      user_agent: typeof formData.get("ua") === "string" ? formData.get("ua") : null,
      received_at: new Date().toISOString(),
    });
  }

  // 3. 完全未配線 — warn して捨てる
  console.warn(
    "[waitlist] no backend configured (RESEND_API_KEY / WAITLIST_WEBHOOK_URL). Email logged:",
    email,
  );
  return { ok: true };
}

/**
 * Resend Audiences API: https://resend.com/docs/api-reference/contacts/create-contact
 * 既に登録済みなら 409 が返るが、ユーザ視点は「成功」扱いにする (リトライ防止)。
 */
async function sendToResend(
  email: string,
  lang: string,
  apiKey: string,
  audienceId: string,
): Promise<WaitlistResult> {
  try {
    const res = await fetch(
      `https://api.resend.com/audiences/${encodeURIComponent(audienceId)}/contacts`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email,
          unsubscribed: false,
          // Resend Contact フィールドに任意の first_name を載せられる。
          // 言語は first_name で代用 (Resend には custom field 機能がないため)。
          first_name: `[${lang}]`,
        }),
      },
    );
    if (res.ok) return { ok: true };
    // 422 = already exists in audience (Resend は idempotent ではなく 422 を返す)
    if (res.status === 422) return { ok: true };
    const text = await res.text();
    console.error(`[waitlist] resend ${res.status}: ${text.slice(0, 200)}`);
    return { ok: false, error: "upstream" };
  } catch (err) {
    console.error("[waitlist] resend fetch failed:", (err as Error).message);
    return { ok: false, error: "network" };
  }
}

async function sendToWebhook(
  url: string,
  payload: Record<string, unknown>,
): Promise<WaitlistResult> {
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
