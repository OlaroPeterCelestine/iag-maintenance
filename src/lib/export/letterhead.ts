import type { jsPDF } from "jspdf";
import { loadBusinessLogo, loadManagerSettings } from "@/lib/manager-settings";
import { getSessionBusiness } from "@/lib/session-profile";
import { getMemorySetting } from "@/lib/db/client-store";

const BUSINESS_PROFILE_KEY = "financeiag-business-profile";

type StoredBusinessForm = {
  businessName?: string;
  legalName?: string;
  registrationNumber?: string;
  logoPreview?: string | null;
  email?: string;
  phone?: string;
  website?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  taxId?: string;
};

export type CompanyLetterhead = {
  businessName: string;
  legalName: string;
  addressLines: string[];
  email: string;
  phone: string;
  website: string;
  taxId: string;
  registrationNumber: string;
  country: string;
  logoDataUrl: string;
  currency: string;
};

function loadBusinessForm(): StoredBusinessForm | null {
  if (typeof window === "undefined") return null;
  try {
    return getMemorySetting<StoredBusinessForm | null>(BUSINESS_PROFILE_KEY, null);
  } catch {
    return null;
  }
}

/** Company identity used on PDFs, printouts, and export headers. */
export function getCompanyLetterhead(): CompanyLetterhead {
  const settings = loadManagerSettings();
  const session = getSessionBusiness();
  const form = loadBusinessForm();
  const logo = loadBusinessLogo();

  const addressLines = form
    ? [
        form.addressLine1 || "",
        form.addressLine2 || "",
        [form.city, form.state, form.postalCode].filter(Boolean).join(", "),
        form.country || "",
      ]
        .map((line) => line.trim())
        .filter(Boolean)
    : session.address
      ? [session.address]
      : settings.address
        ? [settings.address]
        : [];

  return {
    businessName:
      form?.businessName?.trim() ||
      session.businessName ||
      settings.businessName ||
      "Business",
    legalName: form?.legalName?.trim() || "",
    addressLines,
    email: form?.email?.trim() || session.email || "",
    phone: form?.phone?.trim() || session.phone || "",
    website: form?.website?.trim() || "",
    taxId: form?.taxId?.trim() || session.taxId || "",
    registrationNumber: form?.registrationNumber?.trim() || "",
    country: form?.country?.trim() || session.country || settings.country || "",
    logoDataUrl: form?.logoPreview || session.logoPreview || logo.dataUrl || "",
    currency: settings.baseCurrencyCode || "UGX",
  };
}

export function companyMetaLines(extra: string[] = []): string[] {
  const company = getCompanyLetterhead();
  return [
    company.businessName,
    company.legalName && company.legalName !== company.businessName
      ? company.legalName
      : "",
    ...company.addressLines,
    [company.email, company.phone, company.website].filter(Boolean).join(" · "),
    company.taxId ? `Tax ID: ${company.taxId}` : "",
    company.registrationNumber ? `Reg. No: ${company.registrationNumber}` : "",
    ...extra,
  ].filter(Boolean);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Shared HTML letterhead (logo + company details) for any print sheet
 * that is not already using a full document template.
 */
export function companyLetterheadHtml(options?: {
  title?: string;
  subtitle?: string;
}): string {
  const company = getCompanyLetterhead();
  const logo = company.logoDataUrl
    ? `<img class="iag-lh-logo" src="${company.logoDataUrl}" alt=""/>`
    : "";
  const details = [
    company.legalName && company.legalName !== company.businessName
      ? company.legalName
      : "",
    ...company.addressLines,
    company.phone ? `Phone: ${company.phone}` : "",
    company.email ? `Email: ${company.email}` : "",
    company.website ? `Website: ${company.website}` : "",
    company.taxId ? `Tax ID: ${company.taxId}` : "",
    company.registrationNumber ? `Reg. No: ${company.registrationNumber}` : "",
  ]
    .filter(Boolean)
    .map((line) => `<div>${escapeHtml(line)}</div>`)
    .join("");

  const title = options?.title
    ? `<div class="iag-lh-title">${escapeHtml(options.title)}</div>`
    : "";
  const subtitle = options?.subtitle
    ? `<div class="iag-lh-sub">${escapeHtml(options.subtitle)}</div>`
    : "";

  return `<header class="iag-lh">
  <div class="iag-lh-brand">${logo}<div class="iag-lh-text">
    <div class="iag-lh-name">${escapeHtml(company.businessName)}</div>
    <div class="iag-lh-details">${details}</div>
  </div></div>
  ${title || subtitle ? `<div class="iag-lh-doc">${title}${subtitle}</div>` : ""}
</header>`;
}

/** CSS paired with {@link companyLetterheadHtml}. */
export const COMPANY_LETTERHEAD_CSS = `
.iag-lh{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin:0 0 18px;padding-bottom:12px;border-bottom:1px solid #e2e8f0}
.iag-lh-brand{display:flex;align-items:flex-start;gap:12px;min-width:0;flex:1 1 52%;max-width:58%}
.iag-lh-logo{max-height:64px;max-width:160px;object-fit:contain;flex:0 0 auto}
.iag-lh-text{min-width:0}
.iag-lh-name{font-size:16px;font-weight:800;color:#0f172a;line-height:1.25;overflow-wrap:anywhere}
.iag-lh-details{margin-top:4px;color:#475569;font-size:10px;line-height:1.5}
.iag-lh-details div{margin:0}
.iag-lh-doc{text-align:right;flex:1 1 38%;max-width:44%;min-width:0}
.iag-lh-title{font-size:15px;font-weight:800;color:#0f172a;letter-spacing:.02em;line-height:1.3;overflow-wrap:anywhere}
.iag-lh-sub{margin-top:4px;color:#64748b;font-size:11px;line-height:1.35;overflow-wrap:anywhere}
`;

function logoFormat(dataUrl: string): "PNG" | "JPEG" {
  return /image\/jpe?g/i.test(dataUrl) ? "JPEG" : "PNG";
}

/**
 * Draws configured logo + company block at the top of a jsPDF page.
 * Returns the Y position (mm) where content should continue.
 *
 * Brand (logo + name + details) stays in a left column; document title/subtitle
 * stay in a right column with wrapping so long names like
 * "Statement — SHERATON KAMPALA HOTEL" never overwrite "…GROUP".
 */
export function drawPdfLetterhead(
  doc: jsPDF,
  options?: {
    title?: string;
    subtitle?: string;
    marginX?: number;
    startY?: number;
    pageWidth?: number;
  },
): number {
  const company = getCompanyLetterhead();
  const marginX = options?.marginX ?? 14;
  const pageWidth = options?.pageWidth ?? doc.internal.pageSize.getWidth();
  const rightX = pageWidth - marginX;
  const contentWidth = rightX - marginX;
  const y = options?.startY ?? 14;

  // Leave a gap between brand and doc title so long strings cannot collide.
  const brandMaxWidth = contentWidth * 0.55;
  const titleMaxWidth = contentWidth * 0.4;

  const hasLogo = Boolean(company.logoDataUrl);
  if (hasLogo) {
    try {
      doc.addImage(company.logoDataUrl, logoFormat(company.logoDataUrl), marginX, y - 2, 28, 14);
    } catch {
      /* ignore bad logo bytes */
    }
  }

  const textX = hasLogo ? marginX + 32 : marginX;
  const nameMaxWidth = Math.max(24, brandMaxWidth - (textX - marginX));

  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  const nameLines = doc.splitTextToSize(company.businessName || "Business", nameMaxWidth);
  doc.text(nameLines, textX, y + 2);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  let detailY = y + 2 + nameLines.length * 5;
  if (company.legalName && company.legalName !== company.businessName) {
    const legalLines = doc.splitTextToSize(company.legalName, nameMaxWidth);
    doc.text(legalLines, textX, detailY);
    detailY += legalLines.length * 3.5;
  }
  for (const line of company.addressLines) {
    const wrapped = doc.splitTextToSize(line, nameMaxWidth);
    doc.text(wrapped, textX, detailY);
    detailY += wrapped.length * 3.5;
  }
  const contact = [company.email, company.phone, company.website].filter(Boolean).join(" · ");
  if (contact) {
    const contactLines = doc.splitTextToSize(contact, nameMaxWidth);
    doc.text(contactLines, textX, detailY);
    detailY += contactLines.length * 3.5;
  }
  const ids = [
    company.taxId ? `Tax ID: ${company.taxId}` : "",
    company.registrationNumber ? `Reg. No: ${company.registrationNumber}` : "",
  ].filter(Boolean);
  if (ids.length) {
    const idLines = doc.splitTextToSize(ids.join(" · "), nameMaxWidth);
    doc.text(idLines, textX, detailY);
    detailY += idLines.length * 3.5;
  }

  let titleBottom = y;
  if (options?.title) {
    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    const titleLines = doc.splitTextToSize(options.title, titleMaxWidth);
    // Right-align each wrapped line inside the title column.
    let titleY = y + 2;
    for (const line of titleLines) {
      doc.text(line, rightX, titleY, { align: "right" });
      titleY += 5;
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100);
    if (options.subtitle) {
      const subLines = doc.splitTextToSize(options.subtitle, titleMaxWidth);
      for (const line of subLines) {
        doc.text(line, rightX, titleY, { align: "right" });
        titleY += 3.8;
      }
    }
    titleBottom = titleY;
  }

  const afterHeader = Math.max(detailY, titleBottom, y + 10) + 3;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.line(marginX, afterHeader, rightX, afterHeader);
  doc.setTextColor(15, 23, 42);
  return afterHeader + 6;
}

export function drawPdfFooter(doc: jsPDF, pageWidth?: number) {
  const company = getCompanyLetterhead();
  const width = pageWidth ?? doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `${company.businessName}${company.taxId ? ` · Tax ID ${company.taxId}` : ""}`,
    14,
    height - 8,
  );
  doc.text(`Generated ${new Date().toLocaleString()}`, width - 14, height - 8, {
    align: "right",
  });
  doc.setTextColor(15, 23, 42);
}
