"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { getMemorySetting, setMemorySetting } from "@/lib/db/client-store";
import { persistSettingToDb } from "@/lib/db/sync";
import {
  ArrowRight,
  Building2,
  Check,
  FileText,
  ImagePlus,
  Loader2,
  MapPin,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

export const BUSINESS_PROFILE_KEY = "financeiag-business-profile";
const LEGACY_PROFILE_KEY = "kravio-business-profile";

const steps = [
  { id: 1, title: "Business", description: "Name & branding" },
  { id: 2, title: "Contact", description: "Email & phone" },
  { id: 3, title: "Location", description: "Address details" },
  { id: 4, title: "Documents", description: "Legal & tax info" },
];

export type BusinessForm = {
  businessName: string;
  legalName: string;
  registrationNumber: string;
  logoPreview: string | null;
  logoName: string;
  email: string;
  phone: string;
  website: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  taxId: string;
  industry: string;
  description: string;
};

const initialForm: BusinessForm = {
  businessName: "",
  legalName: "",
  registrationNumber: "",
  logoPreview: null,
  logoName: "",
  email: "",
  phone: "",
  website: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "Uganda",
  taxId: "",
  industry: "SaaS",
  description: "",
};

export const emptyBusinessForm = initialForm;

function Field({
  label,
  htmlFor,
  required,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-rose-500">*</span>}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

function loadSavedProfile(): BusinessForm {
  if (typeof window === "undefined") return initialForm;
  try {
    const saved =
      getMemorySetting<Partial<BusinessForm> | null>(BUSINESS_PROFILE_KEY, null) ??
      getMemorySetting<Partial<BusinessForm> | null>(LEGACY_PROFILE_KEY, null);
    if (!saved) return initialForm;
    return {
      ...initialForm,
      ...saved,
      logoPreview: saved.logoPreview && saved.logoPreview !== "[uploaded]" ? saved.logoPreview : null,
    };
  } catch {
    return initialForm;
  }
}

export function BusinessProfileForm({
  onComplete,
  finishLabel = "Save business profile",
  initialValues,
  persist = true,
}: {
  onComplete?: (form: BusinessForm) => void;
  finishLabel?: string;
  initialValues?: BusinessForm | null;
  persist?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof BusinessForm, string>>>({});
  const [form, setForm] = useState<BusinessForm>(initialValues ?? initialForm);

  useEffect(() => {
    if (initialValues) {
      setForm(initialValues);
      setStep(1);
      setSaved(false);
      setErrors({});
      return;
    }
    setForm(loadSavedProfile());
  }, [initialValues]);

  function update<K extends keyof BusinessForm>(key: K, value: BusinessForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    setSaved(false);
  }

  function onLogoChange(file?: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrors((prev) => ({ ...prev, logoPreview: "Please upload an image file (PNG, JPG, or SVG)." }));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setErrors((prev) => ({ ...prev, logoPreview: "Image must be under 2MB." }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      update("logoPreview", String(reader.result));
      update("logoName", file.name);
    };
    reader.readAsDataURL(file);
  }

  function clearLogo() {
    update("logoPreview", null);
    update("logoName", "");
    if (fileRef.current) fileRef.current.value = "";
  }

  function validateStep(current: number) {
    const nextErrors: Partial<Record<keyof BusinessForm, string>> = {};

    if (current === 1) {
      if (!form.businessName.trim()) nextErrors.businessName = "Business name is required.";
      if (!form.legalName.trim()) nextErrors.legalName = "Legal / registered name is required.";
    }

    if (current === 2) {
      if (!form.email.trim()) nextErrors.email = "Business email is required.";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) nextErrors.email = "Enter a valid email.";
      if (!form.phone.trim()) nextErrors.phone = "Phone number is required.";
    }

    if (current === 3) {
      if (!form.addressLine1.trim()) nextErrors.addressLine1 = "Street address is required.";
      if (!form.city.trim()) nextErrors.city = "City is required.";
      if (!form.postalCode.trim()) nextErrors.postalCode = "Postal / ZIP code is required.";
      if (!form.country.trim()) nextErrors.country = "Country is required.";
    }

    if (current === 4) {
      if (!form.taxId.trim()) nextErrors.taxId = "Tax / VAT ID is required for documents.";
      if (!form.industry.trim()) nextErrors.industry = "Industry is required.";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function next() {
    if (!validateStep(step)) return;
    if (step < 4) {
      setStep((s) => s + 1);
      return;
    }
    setLoading(true);
    if (persist) {
      try {
        const payload = {
          ...form,
          completedAt: new Date().toISOString(),
        };
        setMemorySetting(BUSINESS_PROFILE_KEY, payload);
        void persistSettingToDb(BUSINESS_PROFILE_KEY, payload);
      } catch {
        // ignore storage failures in private mode
      }
    }
    setTimeout(() => {
      setLoading(false);
      setSaved(true);
      onComplete?.(form);
    }, 500);
  }

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {steps.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setStep(item.id)}
            className="min-w-0 text-left"
          >
            <div
              className={cn(
                "mb-2 h-1.5 rounded-full",
                step >= item.id ? "bg-[#f5a623]" : "bg-slate-100",
              )}
            />
            <p className={cn("truncate text-[11px] font-medium", step >= item.id ? "text-slate-800" : "text-slate-400")}>
              {item.title}
            </p>
            <p className="hidden truncate text-[10px] text-slate-400 sm:block">{item.description}</p>
          </button>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl bg-slate-50 p-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-white text-slate-700 ring-1 ring-slate-200">
              <Building2 size={16} />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-800">Business identity</p>
              <p className="text-xs text-slate-500">
                Shown on generated documents, invoices, and branded exports.
              </p>
            </div>
          </div>

          <Field label="Business logo" hint="PNG, JPG, or SVG up to 2MB. Used on invoices and reports.">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50 text-slate-400 transition hover:border-slate-400 hover:bg-slate-100"
              >
                {form.logoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.logoPreview} alt="Business logo preview" className="size-full object-cover" />
                ) : (
                  <ImagePlus size={22} />
                )}
              </button>
              <div className="min-w-0 flex-1 space-y-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  className="hidden"
                  onChange={(e) => onLogoChange(e.target.files?.[0])}
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" className="h-9" onClick={() => fileRef.current?.click()}>
                    Upload image
                  </Button>
                  {form.logoPreview && (
                    <Button type="button" variant="ghost" className="h-9 text-rose-600" onClick={clearLogo}>
                      <Trash2 size={14} /> Remove
                    </Button>
                  )}
                </div>
                <p className="truncate text-[11px] text-slate-400">
                  {form.logoName || "No image selected yet"}
                </p>
              </div>
            </div>
            {errors.logoPreview && <p className="text-[11px] text-rose-500">{errors.logoPreview}</p>}
          </Field>

          <Field label="Business name" htmlFor="businessName" required>
            <Input
              id="businessName"
              className="h-10"
              placeholder="FinanceIAG"
              value={form.businessName}
              onChange={(e) => update("businessName", e.target.value)}
              aria-invalid={!!errors.businessName}
            />
            {errors.businessName && <p className="text-[11px] text-rose-500">{errors.businessName}</p>}
          </Field>

          <Field label="Legal / registered name" htmlFor="legalName" required hint="Exact name as on registration documents.">
            <Input
              id="legalName"
              className="h-10"
              placeholder="FinanceIAG Ltd."
              value={form.legalName}
              onChange={(e) => update("legalName", e.target.value)}
              aria-invalid={!!errors.legalName}
            />
            {errors.legalName && <p className="text-[11px] text-rose-500">{errors.legalName}</p>}
          </Field>

          <Field label="Company registration number" htmlFor="registrationNumber" hint="Optional — business registry / incorporation ID.">
            <Input
              id="registrationNumber"
              className="h-10"
              placeholder="e.g. 12345678"
              value={form.registrationNumber}
              onChange={(e) => update("registrationNumber", e.target.value)}
            />
          </Field>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl bg-slate-50 p-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-white text-slate-700 ring-1 ring-slate-200">
              <FileText size={16} />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-800">Contact details</p>
              <p className="text-xs text-slate-500">
                Used as the official contact block on invoices, notices, and documents.
              </p>
            </div>
          </div>

          <Field label="Business email" htmlFor="email" required>
            <Input
              id="email"
              type="email"
              className="h-10"
              placeholder="billing@company.com"
              value={form.email}
              onChange={(e) => update("email", e.target.value)}
              aria-invalid={!!errors.email}
            />
            {errors.email && <p className="text-[11px] text-rose-500">{errors.email}</p>}
          </Field>

          <Field label="Phone number" htmlFor="phone" required>
            <Input
              id="phone"
              type="tel"
              className="h-10"
              placeholder="+1 (555) 000-0000"
              value={form.phone}
              onChange={(e) => update("phone", e.target.value)}
              aria-invalid={!!errors.phone}
            />
            {errors.phone && <p className="text-[11px] text-rose-500">{errors.phone}</p>}
          </Field>

          <Field label="Website" htmlFor="website">
            <Input
              id="website"
              type="url"
              className="h-10"
              placeholder="https://company.com"
              value={form.website}
              onChange={(e) => update("website", e.target.value)}
            />
          </Field>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl bg-slate-50 p-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-white text-slate-700 ring-1 ring-slate-200">
              <MapPin size={16} />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-800">Business location</p>
              <p className="text-xs text-slate-500">
                Registered address printed on contracts, tax documents, and compliance exports.
              </p>
            </div>
          </div>

          <Field label="Street address" htmlFor="addressLine1" required>
            <Input
              id="addressLine1"
              className="h-10"
              placeholder="120 Market Street"
              value={form.addressLine1}
              onChange={(e) => update("addressLine1", e.target.value)}
              aria-invalid={!!errors.addressLine1}
            />
            {errors.addressLine1 && <p className="text-[11px] text-rose-500">{errors.addressLine1}</p>}
          </Field>

          <Field label="Address line 2" htmlFor="addressLine2">
            <Input
              id="addressLine2"
              className="h-10"
              placeholder="Suite / Floor / Building"
              value={form.addressLine2}
              onChange={(e) => update("addressLine2", e.target.value)}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="City" htmlFor="city" required>
              <Input
                id="city"
                className="h-10"
                placeholder="San Francisco"
                value={form.city}
                onChange={(e) => update("city", e.target.value)}
                aria-invalid={!!errors.city}
              />
              {errors.city && <p className="text-[11px] text-rose-500">{errors.city}</p>}
            </Field>
            <Field label="State / Province" htmlFor="state">
              <Input
                id="state"
                className="h-10"
                placeholder="CA"
                value={form.state}
                onChange={(e) => update("state", e.target.value)}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Postal / ZIP code" htmlFor="postalCode" required>
              <Input
                id="postalCode"
                className="h-10"
                placeholder="94105"
                value={form.postalCode}
                onChange={(e) => update("postalCode", e.target.value)}
                aria-invalid={!!errors.postalCode}
              />
              {errors.postalCode && <p className="text-[11px] text-rose-500">{errors.postalCode}</p>}
            </Field>
            <Field label="Country" required>
              <Select value={form.country} onValueChange={(v) => update("country", v ?? "United States")}>
                <SelectTrigger className="h-10 w-full" aria-invalid={!!errors.country}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="United States">United States</SelectItem>
                  <SelectItem value="United Kingdom">United Kingdom</SelectItem>
                  <SelectItem value="Canada">Canada</SelectItem>
                  <SelectItem value="Nigeria">Nigeria</SelectItem>
                  <SelectItem value="Kenya">Kenya</SelectItem>
                  <SelectItem value="South Africa">South Africa</SelectItem>
                  <SelectItem value="United Arab Emirates">United Arab Emirates</SelectItem>
                  <SelectItem value="India">India</SelectItem>
                  <SelectItem value="Germany">Germany</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
              {errors.country && <p className="text-[11px] text-rose-500">{errors.country}</p>}
            </Field>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-800">
              <Check size={15} /> Document profile
            </p>
            <p className="mt-1 text-xs text-emerald-700/80">
              Tax and industry details complete the official company record used across the system.
            </p>
          </div>

          <Field label="Tax / VAT ID" htmlFor="taxId" required hint="EIN, VAT, TIN, or local tax registration number.">
            <Input
              id="taxId"
              className="h-10"
              placeholder="e.g. 12-3456789"
              value={form.taxId}
              onChange={(e) => update("taxId", e.target.value)}
              aria-invalid={!!errors.taxId}
            />
            {errors.taxId && <p className="text-[11px] text-rose-500">{errors.taxId}</p>}
          </Field>

          <Field label="Industry" required>
            <Select value={form.industry} onValueChange={(v) => update("industry", v ?? "SaaS")}>
              <SelectTrigger className="h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SaaS">SaaS</SelectItem>
                <SelectItem value="E-commerce">E-commerce</SelectItem>
                <SelectItem value="Fintech">Fintech</SelectItem>
                <SelectItem value="Healthcare">Healthcare</SelectItem>
                <SelectItem value="Logistics">Logistics</SelectItem>
                <SelectItem value="Education">Education</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="Business description"
            htmlFor="description"
            hint="Short summary for contracts and internal document headers."
          >
            <Textarea
              id="description"
              rows={4}
              className="resize-none"
              placeholder="Accounting and operations for growing businesses."
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
            />
          </Field>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[12px] text-slate-600">
            <p className="mb-2 font-medium text-slate-800">Document preview summary</p>
            <p>
              {form.businessName || "Business name"} · {form.email || "email"} · {form.phone || "phone"}
            </p>
            <p className="mt-1">
              {[form.addressLine1, form.city, form.country].filter(Boolean).join(", ") || "Address pending"}
            </p>
            <p className="mt-1">Tax ID: {form.taxId || "—"}</p>
          </div>
        </div>
      )}

      <div className="mt-6 flex items-center justify-end gap-3">
        {saved && (
          <span className="flex items-center gap-1 text-[12px] font-medium text-emerald-600">
            <Check size={14} /> Saved
          </span>
        )}
        <Button type="button" className="h-10 min-w-[160px] bg-black hover:bg-zinc-800" onClick={next} disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="animate-spin" /> Saving…
            </>
          ) : step === 4 ? (
            <>
              {finishLabel} <ArrowRight />
            </>
          ) : (
            <>
              Continue <ArrowRight />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
