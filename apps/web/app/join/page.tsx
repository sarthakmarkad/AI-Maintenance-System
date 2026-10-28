import { StaffOnboarding } from "@/components/staff-onboarding";
export const metadata = {
  title: "Join your team | Maintenance",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
} as const;
export default function Page() {
  return <StaffOnboarding />;
}
