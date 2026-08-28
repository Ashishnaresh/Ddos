import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/currentUser";

export default async function Home() {
  const current = await getCurrentUser();
  redirect(current ? "/dashboard" : "/login");
}
