import { chromium } from "@playwright/test";
import { mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const output = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("OUTPUT_PATH_REQUIRED");
try {
  await stat(output);
  throw new Error(`Refusing to overwrite sealed fixture input: ${output}`);
} catch (error) {
  if (error instanceof Error && error.message.startsWith("Refusing")) throw error;
}

await mkdir(dirname(output), { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1080, height: 1350 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:#f3f5f2;color:#1f2722;font-family:"Microsoft JhengHei",sans-serif}
.frame{width:1080px;min-height:1350px;padding:64px}.notice{padding:16px 20px;background:#fff1e7;color:#8a3b26;border-radius:12px;font-weight:700}
.card{margin-top:24px;background:white;border:1px solid #d8ded9;border-radius:20px;overflow:hidden;box-shadow:0 14px 40px #18342614}
.hero{height:410px;background:linear-gradient(135deg,#dce7df,#f8faf8);display:grid;place-items:center;color:#2e5646;font-size:34px;font-weight:700}
.body{padding:40px}.tag{display:inline-block;padding:8px 12px;border-radius:999px;background:#e1efe7;color:#24513e;font-weight:700}
h1{font-size:42px;margin:18px 0 8px;line-height:1.25}.sub{font-size:22px;color:#667067}.price{font-size:46px;font-weight:800;color:#164936;margin:28px 0}.price small{font-size:20px;color:#667067}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 28px;margin:30px 0;padding:26px;background:#f7f9f7;border-radius:14px;font-size:21px}
.grid b{display:block;color:#526057;font-size:16px;margin-bottom:5px}.features{display:flex;gap:12px;flex-wrap:wrap}.feature{padding:10px 14px;border:1px solid #bdc9c1;border-radius:10px;font-size:18px}
.foot{margin-top:30px;padding-top:24px;border-top:1px solid #dde3df;font-size:17px;color:#5d685f;line-height:1.7}
</style></head><body><main class="frame"><div class="notice">完全虛構 Demo 廣告・不可用於真實租屋或付款</div><article class="card"><div class="hero">晴光套房 302・示意照片區</div><div class="body"><span class="tag">獨立套房</span><h1>採光套房｜近示範公園｜可申請租金補貼</h1><p class="sub">示範市和平區・不對應真實地址</p><div class="price">NT$12,000 <small>/ 月</small></div><section class="grid"><div><b>管理費</b>NT$1,000 / 月</div><div><b>電費</b>每度 NT$5</div><div><b>網路</b>租金內含</div><div><b>押金</b>兩個月</div></section><div class="features"><span class="feature">附洗衣機</span><span class="feature">附冷氣</span><span class="feature">附冰箱</span><span class="feature">獨立電表</span><span class="feature">可申請租金補貼</span></div><p class="foot">設備與費用以簽約前雙方書面確認為準。此頁所有名稱、地點與聯絡資訊均為虛構；沒有房東姓名、電話、帳號、QR code 或付款連結。</p></div></article></main></body></html>`,
    { waitUntil: "load" },
  );
  await page.screenshot({ path: output, fullPage: true, type: "png" });
} finally {
  await browser.close();
}
console.log(output);
