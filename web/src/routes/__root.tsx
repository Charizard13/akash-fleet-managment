import { Header } from "@/components/layout/Header";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";
import { Toaster } from "@/components/ui/toaster";
import { Loader } from "@/components/Loader";
import { ErrorUI } from "@/components/Error";
import { ThemeProvider } from "@/components/theme-provider";
import { useEffect } from "react";
import { useStore } from "@/store";
import { getKeplerAccounts } from "@/lib/kepler/utils";

export const Route = createRootRoute({
  component: Root,
  pendingComponent: Loader,
  errorComponent: ErrorUI,
});

function Root() {
  const setAkashKey = useStore((state) => state.setAkashKey);
  useEffect(() => {
    (async () => {
      const accounts = await getKeplerAccounts();
      setAkashKey(accounts[0].address);
    })();
  }, []);
  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <Header />
      <hr />
      <div className="p-4 flex flex-col gap-4 items-center min-h-[calc(100vh-56px)]">
        <Outlet />
        <Toaster />
        {import.meta.env.DEV && <TanStackRouterDevtools />}
      </div>
    </ThemeProvider>
  );
}
