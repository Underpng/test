import { Outlet } from "react-router-dom";
import { BottomNav, NavRail, TopBar } from "@/components/nav";

export default function Layout() {
    return (
        <div className="min-h-screen bg-background text-foreground">
            <NavRail />
            <TopBar />
            <main className="pb-24 md:pb-10 md:pl-20">
                <Outlet />
            </main>
            <BottomNav />
        </div>
    );
}
