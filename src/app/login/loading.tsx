import { LoginPageSkeleton } from "@/components/page-loading";

/** Sign-in first paint while the login client bundle / search params resolve. */
export default function Loading() {
  return <LoginPageSkeleton />;
}
