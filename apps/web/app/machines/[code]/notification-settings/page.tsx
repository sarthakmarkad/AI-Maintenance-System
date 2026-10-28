import { ExternalNotificationsPage } from "@/components/external-notifications";
export default async function NotificationSettingsPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <ExternalNotificationsPage code={code} />;
}
