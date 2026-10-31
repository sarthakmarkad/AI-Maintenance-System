import { PasswordRecovery } from "@/components/password-recovery";
export const metadata = {
  title: "Set password | Maintenate",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
} as const;
export default function Page() {
  return <PasswordRecovery reset />;
}
