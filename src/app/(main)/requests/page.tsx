"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function RequestsRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const view = (searchParams.get("view") || "").trim();
    const rest = new URLSearchParams(searchParams.toString());
    const target =
      view === "oral-payment-requests" ? "oral-payment-requests" : "general-requests";
    if (!rest.get("view")) rest.set("view", target);
    const qs = rest.toString();
    router.replace(`/${target}${qs ? `?${qs}` : ""}`);
  }, [router, searchParams]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center text-[13px] text-slate-500">
      Opening request page…
    </div>
  );
}

/** Legacy `/requests` combined page — redirect to oral or general. */
export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center text-[13px] text-slate-500">
          Opening request page…
        </div>
      }
    >
      <RequestsRedirect />
    </Suspense>
  );
}
