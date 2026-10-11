import { Intro } from "@/components/intro/Intro";

export const metadata = { title: "Skill Smith · Intro" };

export default async function IntroPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  return <Intro auto={sp.auto === "1"} />;
}
