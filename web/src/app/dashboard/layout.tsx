import { Suspense, type ReactNode } from "react";
import DashboardShell from "./dashboard-shell";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="h-screen w-full bg-[#eef2f7]" />}>
      <DashboardShell>{children}</DashboardShell>
    </Suspense>
  );
}
