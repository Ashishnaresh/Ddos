import type { Metadata } from "next";

export function generateMetadata({
  params,
}: {
  params: { id: string };
}): Metadata {
  return { title: `Test ${params.id.slice(0, 8)}` };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
