import { z } from "zod";

export const RealConversationIntentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("start_analysis") }).strict(),
  z.object({ kind: z.literal("listing_url_candidate"), url: z.url() }).strict(),
  z.object({ kind: z.literal("confirm_listing_url") }).strict(),
  z.object({ kind: z.literal("note") }).strict(),
  z
    .object({ kind: z.literal("clarification_needed"), reason: z.literal("multiple_urls") })
    .strict(),
]);

export type RealConversationIntent = z.infer<typeof RealConversationIntentSchema>;

export function recognizeRealConversationIntent(text: string): RealConversationIntent {
  if (
    /^(?:我)?確認(?:加入|使用|分析)?(?:這個|此)?(?:租屋)?(?:連結|網址)[。！!]?$/u.test(text.trim())
  ) {
    return { kind: "confirm_listing_url" };
  }
  const urls = text.match(/https:\/\/[^\s<>"']+/gu) ?? [];
  if (urls.length > 1) return { kind: "clarification_needed", reason: "multiple_urls" };
  const onlyUrl = urls[0];
  if (onlyUrl) {
    try {
      return { kind: "listing_url_candidate", url: new URL(onlyUrl).toString() };
    } catch {
      return { kind: "note" };
    }
  }
  if (/(?:不要|不需要|先別|暫不).{0,6}(?:分析|比對|整理)/u.test(text)) return { kind: "note" };
  const asksForAnalysis = /(?:請|幫我|可以|開始|進行|想要|要).{0,8}(?:分析|比對|整理)/u.test(text);
  return asksForAnalysis ? { kind: "start_analysis" } : { kind: "note" };
}
