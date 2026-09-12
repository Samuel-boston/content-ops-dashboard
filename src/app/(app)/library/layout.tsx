import { LibraryTabs } from "@/components/LibraryTabs";

export default function LibraryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Library</h1>
        <LibraryTabs />
      </div>
      {children}
    </div>
  );
}
