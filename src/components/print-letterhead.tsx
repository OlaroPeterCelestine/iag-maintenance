"use client";

import { getCompanyLetterhead } from "@/lib/export/letterhead";
import { useEffect, useState } from "react";

/** Company logo + details shown when printing (`print:` only by default). */
export function PrintLetterhead({
  alwaysVisible = false,
  className = "",
}: {
  alwaysVisible?: boolean;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [company, setCompany] = useState(() => ({
    businessName: "",
    legalName: "",
    addressLines: [] as string[],
    email: "",
    phone: "",
    website: "",
    taxId: "",
    registrationNumber: "",
    logoDataUrl: "",
  }));

  useEffect(() => {
    setMounted(true);
    setCompany(getCompanyLetterhead());
  }, []);

  if (!mounted || !company.businessName) return null;

  const contact = [company.email, company.phone, company.website].filter(Boolean).join(" · ");
  const ids = [
    company.taxId ? `Tax ID ${company.taxId}` : "",
    company.registrationNumber ? `Reg. No ${company.registrationNumber}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={`${
        alwaysVisible ? "flex" : "hidden print:flex"
      } items-start gap-3 border-b border-slate-200 pb-3 ${className}`}
    >
      {company.logoDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={company.logoDataUrl}
          alt=""
          className="h-12 w-auto max-w-[140px] object-contain"
        />
      ) : null}
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-slate-900">{company.businessName}</p>
        {company.legalName && company.legalName !== company.businessName ? (
          <p className="text-[11px] text-slate-500">{company.legalName}</p>
        ) : null}
        {company.addressLines.map((line) => (
          <p key={line} className="text-[11px] text-slate-500">
            {line}
          </p>
        ))}
        {contact ? <p className="text-[11px] text-slate-500">{contact}</p> : null}
        {ids ? <p className="text-[11px] text-slate-500">{ids}</p> : null}
      </div>
    </div>
  );
}
