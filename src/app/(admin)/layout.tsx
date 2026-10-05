import { MobileNav, Sidebar } from "@/components/sidebar";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1400px] gap-6 p-4">
      <Sidebar />
      <main className="min-w-0 flex-1 py-2 md:py-4">
        <MobileNav />
        {children}
      </main>
    </div>
  );
}
