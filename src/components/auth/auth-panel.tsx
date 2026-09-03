"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

type Mode = "login" | "register" | "verify_registration" | "forgot" | "reset_code";
type SessionState = "loading" | "signed_out" | "authenticated" | "unavailable";

type AuthSessionResponse = Readonly<{
  schemaVersion: "rentproof.self-hosted-auth-session.v1";
  status: "signed_out" | "authenticated";
  csrfToken: string;
}>;

const genericFailure = "無法完成要求。請稍後重試；系統不會透露帳戶是否存在。";

export function AuthPanel() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [session, setSession] = useState<SessionState>("loading");
  const [csrfToken, setCsrfToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void loadSession().then((result) => {
      if (!active) return;
      if (!result) {
        setSession("unavailable");
        return;
      }
      setCsrfToken(result.csrfToken);
      setSession(result.status);
    });
    return () => {
      active = false;
    };
  }, []);

  function changeMode(next: Mode) {
    setMessage("");
    setMode(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!csrfToken || busy) return;
    const form = event.currentTarget;
    const input = new FormData(form);
    setBusy(true);
    setMessage("");
    try {
      if (mode === "login") {
        const response = await authMutation("/api/auth/login", csrfToken, {
          email: requiredFormValue(input, "email"),
          password: requiredFormValue(input, "password"),
        });
        if (!response.ok) throw new Error("AUTH_FAILED");
        form.reset();
        setSession("authenticated");
        router.replace("/history");
        router.refresh();
        return;
      }

      if (mode === "register") {
        const response = await authMutation("/api/auth/register", csrfToken, {
          email: requiredFormValue(input, "email"),
          password: requiredFormValue(input, "password"),
          demoPolicyAcknowledged: input.get("demoPolicyAcknowledged") === "on",
        });
        if (!response.ok) throw new Error("AUTH_FAILED");
        form.reset();
        setMode("verify_registration");
        setMessage("若可建立帳戶，驗證信已送出。請從本機 Demo 信箱取得驗證碼。");
        return;
      }

      if (mode === "verify_registration") {
        const response = await authMutation("/api/auth/registration/verify", csrfToken, {
          code: requiredFormValue(input, "code"),
        });
        if (!response.ok) throw new Error("AUTH_FAILED");
        form.reset();
        setMode("login");
        setMessage("若驗證要求有效，帳戶已可登入。");
        return;
      }

      if (mode === "forgot") {
        await authMutation("/api/auth/password-reset/request", csrfToken, {
          email: requiredFormValue(input, "email"),
        });
        form.reset();
        setMode("reset_code");
        setMessage("若帳戶存在，重設信已送出。請從本機 Demo 信箱取得驗證碼。");
        return;
      }

      await authMutation("/api/auth/password-reset/complete", csrfToken, {
        code: requiredFormValue(input, "code"),
        newPassword: requiredFormValue(input, "password"),
      });
      form.reset();
      setMode("login");
      setSession("signed_out");
      setMessage("若重設要求有效，密碼已更新且既有工作階段已撤銷。請重新登入。");
    } catch {
      form.reset();
      setMessage(genericFailure);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (!csrfToken || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await authMutation("/api/auth/logout", csrfToken, {});
      if (!response.ok) throw new Error("AUTH_FAILED");
      setSession("signed_out");
      setMode("login");
      setMessage("已安全登出。另一個有效要求才會再次建立工作階段。");
      router.refresh();
    } catch {
      setMessage(genericFailure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="auth-title">
        <p className="eyebrow">LOCALHOST · SYNTHETIC DEMO</p>
        <h1 id="auth-title">{session === "authenticated" ? "帳戶工作階段" : titleFor(mode)}</h1>
        <p>登入不是使用門檻；登入後才可查詢保存在這個 Demo 資料庫中的虛構案件。</p>

        {session === "loading" && <p role="status">正在檢查工作階段…</p>}
        {session === "unavailable" && (
          <p role="alert">帳戶服務目前無法使用。系統不會改用不安全的備援登入。</p>
        )}
        {session === "authenticated" && (
          <div className="auth-session-actions">
            <p role="status">目前已登入。每次有效使用會由伺服器重新計算七天閒置期限。</p>
            <Link className="primary-button" href="/history">
              查看歷史案件
            </Link>
            <button type="button" onClick={() => void logout()} disabled={busy || !csrfToken}>
              {busy ? "處理中…" : "登出"}
            </button>
          </div>
        )}

        {session === "signed_out" && (
          <>
            <form onSubmit={submit} autoComplete="on">
              {(mode === "login" || mode === "register" || mode === "forgot") && (
                <label>
                  Email
                  <input name="email" type="email" autoComplete="email" required maxLength={254} />
                </label>
              )}
              {(mode === "login" || mode === "register" || mode === "reset_code") && (
                <label>
                  {mode === "reset_code" ? "新密碼" : "密碼"}
                  <input
                    name="password"
                    type="password"
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    minLength={12}
                    maxLength={128}
                    required
                  />
                </label>
              )}
              {(mode === "verify_registration" || mode === "reset_code") && (
                <label>
                  Email 驗證碼
                  <input
                    name="code"
                    autoComplete="one-time-code"
                    pattern="[A-Za-z0-9_-]{43}"
                    minLength={43}
                    maxLength={43}
                    required
                  />
                </label>
              )}
              {mode === "register" && (
                <label className="auth-consent">
                  <input name="demoPolicyAcknowledged" type="checkbox" required />
                  <span>
                    我已閱讀<Link href="/terms">使用條款草案</Link>與
                    <Link href="/privacy">隱私政策草案</Link>，並了解此功能只可使用虛構資料。
                  </span>
                </label>
              )}
              <button type="submit" disabled={busy || !csrfToken}>
                {busy ? "處理中…" : actionFor(mode)}
              </button>
            </form>
            <nav aria-label="帳戶選項" className="auth-options">
              <button
                type="button"
                onClick={() => changeMode("login")}
                aria-pressed={mode === "login"}
              >
                登入
              </button>
              <button
                type="button"
                onClick={() => changeMode("register")}
                aria-pressed={mode === "register"}
              >
                註冊
              </button>
              <button
                type="button"
                onClick={() => changeMode("forgot")}
                aria-pressed={mode === "forgot" || mode === "reset_code"}
              >
                忘記密碼
              </button>
              <Link href="/">不登入，返回 Demo</Link>
            </nav>
            {(mode === "verify_registration" || mode === "reset_code") && (
              <p className="auth-demo-mailbox-note">
                Synthetic Demo 不寄真實 Email。
                <Link href="/auth/dev-mailbox">開啟本機 Demo 信箱</Link>
                取得一次性驗證碼；正式環境不提供此頁。
              </p>
            )}
          </>
        )}

        <p role="status" aria-live="polite">
          {message}
        </p>
        <p className="auth-safety-note">
          僅限本機 synthetic
          Demo，不蒐集手機號碼。密碼與重設憑證不會出現在網址、瀏覽器儲存區或回應內容。
        </p>
      </section>
    </main>
  );
}

async function loadSession(): Promise<AuthSessionResponse | null> {
  try {
    const response = await fetch("/api/auth/session", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) return null;
    const value: unknown = await response.json();
    if (!isAuthSessionResponse(value)) return null;
    return value;
  } catch {
    return null;
  }
}

async function authMutation(
  path: string,
  csrfToken: string,
  body: Readonly<Record<string, unknown>>,
): Promise<Response> {
  return fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "x-rentproof-csrf": csrfToken,
    },
    body: JSON.stringify(body),
  });
}

function isAuthSessionResponse(value: unknown): value is AuthSessionResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record["schemaVersion"] === "rentproof.self-hosted-auth-session.v1" &&
    (record["status"] === "signed_out" || record["status"] === "authenticated") &&
    typeof record["csrfToken"] === "string" &&
    /^[A-Za-z0-9_-]{43}$/u.test(record["csrfToken"])
  );
}

function requiredFormValue(input: FormData, name: string): string {
  const value = input.get(name);
  if (typeof value !== "string" || !value) throw new Error("FORM_VALUE_REQUIRED");
  return value;
}

function titleFor(mode: Mode): string {
  if (mode === "register" || mode === "verify_registration") return "建立帳戶";
  if (mode === "forgot" || mode === "reset_code") return "重設密碼";
  return "登入 RentProof";
}

function actionFor(mode: Mode): string {
  if (mode === "login") return "登入";
  if (mode === "register") return "建立 Demo 帳戶";
  if (mode === "verify_registration") return "驗證 Email";
  if (mode === "forgot") return "建立重設要求";
  return "設定新密碼並撤銷工作階段";
}
