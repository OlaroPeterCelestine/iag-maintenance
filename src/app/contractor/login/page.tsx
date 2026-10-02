import { redirect } from "next/navigation";

/** Contractors and staff authenticate through the same company login page. */
export default function ContractorLoginPage() {
  redirect("/login");
}
