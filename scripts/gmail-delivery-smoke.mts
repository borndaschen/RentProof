import {
  PersonalGmailPasswordResetDelivery,
  parsePersonalGmailConfiguration,
} from "../src/adapters/auth/gmail/gmail-api-delivery.ts";
import { normalizeEmailIdentifier } from "../src/application/auth/self-hosted-contracts.ts";

if (!process.argv.slice(2).includes("--live") || process.env["RENTPROOF_GMAIL_SMOKE"] !== "1") {
  console.error("GMAIL_SMOKE_EXPLICIT_OPT_IN_REQUIRED");
  process.exitCode = 2;
} else {
  try {
    const recipient = normalizeEmailIdentifier(
      process.env["RENTPROOF_GMAIL_SMOKE_RECIPIENT"] ?? "",
    );
    const delivery = new PersonalGmailPasswordResetDelivery(
      parsePersonalGmailConfiguration(process.env),
    );
    await delivery.sendConnectivityTest(recipient);
    console.log("GMAIL_SMOKE_SENT");
  } catch {
    console.error("GMAIL_SMOKE_FAILED");
    process.exitCode = 1;
  }
}
