import { MachineWorkspace } from "@/components/machine-workspace";
export default async function ReadingsPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <MachineWorkspace code={code} readings />;
}
