import { MobileNav, Sidebar } from "@/components/sidebar";
import { requireUserPage } from "@/lib/auth";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUserPage();
  return (
    <div className="mx-auto flex max-w-[1400px] gap-6 p-4">
      <Sidebar variant="console" account={user.email ?? user.name} />
      <main className="min-w-0 flex-1 py-2 md:py-4">
        <MobileNav variant="console" />
        {children}
      </main>
    </div>
  );
}
