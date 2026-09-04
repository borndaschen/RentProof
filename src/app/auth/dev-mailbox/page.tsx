import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { authCookieNames, isSelfHostedAuthRouteEnabled } from "@/server/auth/request-guard";
import { getServerEnvironment } from "@/server/env";

export const dynamic = "force-dynamic";

export default async function AccountVerificationCenterPage() {
  const environment = getServerEnvironment();
  if (
    !isSelfHostedAuthRouteEnabled(environment) ||
    !["local_development", "lan_secure_demo"].includes(environment.RENTPROOF_DEPLOYMENT_PROFILE) ||
    environment.RENTPROOF_EMAIL_DELIVERY_MODE !== "local_synthetic"
  ) {
    notFound();
  }
  const csrfToken = (await cookies()).get(authCookieNames(environment).csrf)?.value;
  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="mailbox-title">
        <p className="eyebrow">一次性帳戶驗證</p>
        <h1 id="mailbox-title">帳戶驗證中心</h1>
        <p>輸入剛才使用的電子郵件，取得本次操作的一次性驗證碼。每個驗證碼只顯示一次。</p>
        {csrfToken ? (
          <form action="/api/auth/dev-mailbox" method="post">
            <input type="hidden" name="csrf" value={csrfToken} />
            <label>
              Email
              <input name="email" type="email" autoComplete="email" maxLength={254} required />
            </label>
            <label>
              信件類型
              <select name="kind" defaultValue="verification">
                <option value="verification">註冊驗證</option>
                <option value="password_reset">密碼重設</option>
              </select>
            </label>
            <button className="auth-primary-action" type="submit">
              顯示一次性驗證碼
            </button>
          </form>
        ) : (
          <p role="alert">請先回到帳戶頁，再重新開啟驗證中心，以建立這次操作所需的短效安全保護。</p>
        )}
        <Link className="auth-option-link auth-back-link" href="/auth">
          返回
        </Link>
        <p className="auth-safety-note">驗證碼只顯示一次，不會出現在網址或瀏覽器儲存區。</p>
      </section>
    </main>
  );
}
