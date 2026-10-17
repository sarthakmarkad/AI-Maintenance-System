import { MachineWorkspace } from "@/components/machine-workspace";
export default async function OrderPage({
  params,
}: {
  params: Promise<{ code: string; id: string }>;
}) {
  const { code, id } = await params;
  return <MachineWorkspace code={code} workOrders orderId={id} />;
}
