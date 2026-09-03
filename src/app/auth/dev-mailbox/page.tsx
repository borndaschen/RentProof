import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { authCookieNames, isSelfHostedAuthRouteEnabled } from "@/server/auth/request-guard";
import { getServerEnvironment } from "@/server/env";

export const dynamic = "force-dynamic";

export default async function LocalSyntheticMailboxPage() {
  const environment = getServerEnvironment();
  if (
    !isSelfHostedAuthRouteEnabled(environment) ||
    environment.RENTPROOF_DEPLOYMENT_PROFILE !== "local_development"
  ) {
    notFound();
  }
  const csrfToken = (await cookies()).get(authCookieNames(environment).csrf)?.value;
  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="mailbox-title">
        <p className="eyebrow">一次性帳戶驗證</p>
        <h1 id="mailbox-title">帳戶驗證中心</h1>
        <p>輸入剛才使用的Email，取得本次操作的一次性驗證碼。每個驗證碼只顯示一次。</p>
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
            <button type="submit">顯示一次性驗證碼</button>
          </form>
        ) : (
          <p role="alert">請先返回帳戶頁，讓伺服器建立短效CSRF保護後再開啟信箱。</p>
        )}
        <Link href="/auth">返回登入／註冊</Link>
        <p className="auth-safety-note">
          驗證碼不會寫入網址、瀏覽器儲存區或Server log。正式上線前會改由Email服務寄送。
        </p>
      </section>
    </main>
  );
}
