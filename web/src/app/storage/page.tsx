import { StorageView } from "@/components/storage/StorageView";
import { loadStorage } from "@/lib/storage/load";

export const dynamic = "force-dynamic";
export const metadata = { title: "Skill Smith · Storage" };

export default async function StoragePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const data = await loadStorage();
  return <StorageView data={data} initial={typeof sp.store === "string" ? sp.store : undefined} />;
}
