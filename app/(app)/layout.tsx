import { TabBar } from "@/components/ui/TabBar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <main
        id="main"
        className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[calc(var(--tabbar-height)+env(safe-area-inset-bottom)+1.5rem)]"
      >
        {children}
      </main>
      <TabBar />
    </>
  );
}
