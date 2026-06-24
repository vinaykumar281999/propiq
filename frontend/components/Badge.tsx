"use client";
import type { Badge as BadgeType } from "@/lib/api";

const styles: Record<BadgeType, string> = {
  HOT: "bg-red-900/60 text-red-300 border border-red-700/50",
  WARM: "bg-amber-900/60 text-amber-300 border border-amber-700/50",
  COOL: "bg-sky-900/60 text-sky-300 border border-sky-700/50",
};

export default function Badge({ value }: { value: BadgeType }) {
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded tracking-widest ${styles[value]}`}>
      {value}
    </span>
  );
}
