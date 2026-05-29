"use server";

/**
 * Waitlist 投稿の server action。
 *
 * 処理順:
 *  1. RESEND_API_KEY + RESEND_AUDIENCE_ID → Resend Audiences に登録
 *  2. RESEND_API_KEY + RESEND_FROM        → 登録確認メールを送信 (RESEND_FROM 必須)
 *  3. WAITLIST_WEBHOOK_URL               → webhook fallback
 *  4. いずれも未設定                       → warn して 200 返す
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
  const resendKey = process.env.RESEND_API_KEY;
  const resendAudience = process.env.RESEND_AUDIENCE_ID;
  const resendFrom = process.env.RESEND_FROM; // 例: "Vigili <hello@vigili.io>"

  if (resendKey) {
    // 1. Audience に追加
    if (resendAudience) {
      const addResult = await addToAudience(email, langStr, resendKey, resendAudience);
      if (!addResult.ok) return addResult;
    }
    // 2. 確認メール送信
    if (resendFrom) {
      await sendConfirmationEmail(email, langStr, resendKey, resendFrom);
    }
    return { ok: true };
  }

  // 3. 汎用 webhook fallback
  const webhookUrl = process.env.WAITLIST_WEBHOOK_URL;
  if (webhookUrl) {
    return await sendToWebhook(webhookUrl, {
      email,
      lang: langStr,
      received_at: new Date().toISOString(),
    });
  }

  // 4. 完全未配線
  console.warn("[waitlist] no backend configured. Email:", email);
  return { ok: true };
}

/** Resend Audiences に連絡先を追加する。*/
async function addToAudience(
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
          first_name: `[${lang}]`,
        }),
      },
    );
    if (res.ok || res.status === 422) return { ok: true };
    const text = await res.text();
    console.error(`[waitlist] audience ${res.status}: ${text.slice(0, 200)}`);
    return { ok: false, error: "upstream" };
  } catch (err) {
    console.error("[waitlist] audience fetch failed:", (err as Error).message);
    return { ok: false, error: "network" };
  }
}

/**
 * 登録確認メールを送信する。
 * 失敗しても waitlist 登録自体は成功扱いにするため、エラーは warn に留める。
 */
async function sendConfirmationEmail(
  to: string,
  lang: string,
  apiKey: string,
  from: string,
): Promise<void> {
  const isJa = lang === "ja";
  const subject = isJa
    ? "Vigili のウェイトリストに登録しました"
    : "You're on the Vigili waitlist";

  const html = isJa ? buildHtmlJa() : buildHtmlEn();
  const text = isJa ? buildTextJa() : buildTextEn();

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html, text }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[waitlist] confirmation email failed ${res.status}: ${body.slice(0, 200)}`);
    }
  } catch (err) {
    console.error("[waitlist] confirmation email fetch failed:", (err as Error).message);
  }
}

// ─── Email templates ────────────────────────────────────────────────────────

function buildHtmlEn(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#262624;font-family:system-ui,sans-serif;color:rgba(250,247,242,0.95)">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:48px auto;padding:0 24px">
    <tr><td>
      <p style="margin:0 0 24px;font-size:22px;font-weight:600;letter-spacing:-0.01em">You're on the list.</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:rgba(250,247,242,0.72)">
        Thanks for signing up for Vigili. We'll send you one email the moment it ships — nothing else.
      </p>
      <p style="margin:0 0 32px;font-size:15px;line-height:1.6;color:rgba(250,247,242,0.72)">
        Vigili collects approval requests from all your Claude Code windows in one place, handles the obvious ones automatically, and sends only the unclear ones to your phone.
      </p>
      <p style="margin:0;font-size:13px;color:rgba(250,247,242,0.40)">
        — Vigili · <a href="https://vigili.io" style="color:rgba(250,247,242,0.40)">vigili.io</a>
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildTextEn(): string {
  return `You're on the list.

Thanks for signing up for Vigili. We'll send you one email the moment it ships — nothing else.

Vigili collects approval requests from all your Claude Code windows in one place, handles the obvious ones automatically, and sends only the unclear ones to your phone.

— Vigili · https://vigili.io`;
}

function buildHtmlJa(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#262624;font-family:system-ui,sans-serif;color:rgba(250,247,242,0.95)">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:48px auto;padding:0 24px">
    <tr><td>
      <p style="margin:0 0 24px;font-size:22px;font-weight:600;letter-spacing:-0.01em">登録しました。</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.8;color:rgba(250,247,242,0.72)">
        Vigili のウェイトリストへのご登録ありがとうございます。リリース時にメールでお知らせします。それ以外のメールは送りません。
      </p>
      <p style="margin:0 0 32px;font-size:15px;line-height:1.8;color:rgba(250,247,242,0.72)">
        Vigili は複数の Claude Code ウィンドウからの承認リクエストを 1 か所に集め、明らかなものは自動処理、判断が必要なものだけスマホに届けます。
      </p>
      <p style="margin:0;font-size:13px;color:rgba(250,247,242,0.40)">
        — Vigili · <a href="https://vigili.io" style="color:rgba(250,247,242,0.40)">vigili.io</a>
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildTextJa(): string {
  return `登録しました。

Vigili のウェイトリストへのご登録ありがとうございます。リリース時にメールでお知らせします。それ以外のメールは送りません。

Vigili は複数の Claude Code ウィンドウからの承認リクエストを 1 か所に集め、明らかなものは自動処理、判断が必要なものだけスマホに届けます。

— Vigili · https://vigili.io`;
}

// ─── Webhook fallback ────────────────────────────────────────────────────────

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
