import type { Metadata } from "next";
import { RentSubsidyPrecheck } from "@/components/rent-subsidy/rent-subsidy-precheck";

export const metadata: Metadata = {
  title: "租屋補助申請條件預檢｜RentProof",
  description: "整理租屋補助申請前需要確認的條件與資料。",
};

export default function RentSubsidyPage() {
  return <RentSubsidyPrecheck />;
}
