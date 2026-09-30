import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Workspace from "./workspace";

export default async function Home() {
  const cookie = (await cookies()).toString();
  const response = await fetch(
    `${process.env.API_INTERNAL_URL ?? "http://localhost:4000"}/v1/overview`,
    { headers: { cookie }, cache: "no-store" },
  ).catch(() => null);
  if (response?.status === 401) redirect("/login");
  if (!response?.ok)
    return (
      <main className="service-error">
        <h1>Workspace unavailable</h1>
        <p>
          The API or database could not be reached. Check the local services and
          refresh.
        </p>
      </main>
    );
  const overview = await response.json();
  return <Workspace initialOverview={overview} />;
}
