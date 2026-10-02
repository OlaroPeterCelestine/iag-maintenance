import Image from "next/image";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex size-8 shrink-0 overflow-hidden", className)}>
      <Image
        src="/iag-logo.png"
        alt="Inspire Africa Group"
        fill
        className="object-contain"
        sizes="40px"
        priority
      />
    </span>
  );
}

export function Brand({
  className,
  light = false,
  showWordmark = true,
}: {
  className?: string;
  light?: boolean;
  showWordmark?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <BrandMark className="size-9" />
      {showWordmark && (
        <span className="min-w-0 leading-tight">
          <span
            className={cn(
              "block text-[15px] font-bold tracking-tight",
              light ? "text-white" : "text-slate-900",
            )}
          >
            IAG
          </span>
          <span
            className={cn(
              "block truncate text-[8px] font-medium tracking-[0.04em] uppercase",
              light ? "text-zinc-400" : "text-slate-500",
            )}
          >
            Production
          </span>
        </span>
      )}
    </div>
  );
}
