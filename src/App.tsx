import { useEffect, useRef } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router";
import { Library } from "./routes/Library";
import { Downloads } from "./routes/Downloads";
import { Settings } from "./routes/Settings";
import { Browse } from "./routes/Browse";
import { Book } from "./routes/Book";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { UpdateChecker } from "./components/UpdateChecker";
import { MobileHeader } from "./components/MobileHeader";
import { MobileTabBar } from "./components/MobileTabBar";
import { MobileSearchProvider } from "./lib/mobileSearch";
import { PullToRefreshHost } from "./lib/pullToRefresh";
import { useIsMobile } from "./lib/platform";

export default function App() {
  const mainRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const isMobile = useIsMobile();
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0 });
  }, [pathname]);
  return (
    <MobileSearchProvider>
      <div className="relative flex h-full w-full flex-col bg-paper text-ink">
        {!isMobile && (
          <div data-tauri-drag-region className="absolute inset-x-0 top-0 z-40 h-10" />
        )}
        <main
          ref={mainRef}
          className={
            isMobile
              ? "flex-1 overflow-y-auto overscroll-y-contain pb-[calc(5.25rem+env(safe-area-inset-bottom))]"
              : "flex-1 overflow-y-auto overscroll-y-contain pt-10"
          }
        >
          {isMobile && <MobileHeader />}
          <PullToRefreshHost scrollRef={mainRef} enabled={isMobile}>
            <ErrorBoundary>
              <Routes>
                <Route path="/" element={<Navigate to="/library" replace />} />
                <Route path="/library" element={<Library />} />
                <Route path="/browse" element={<Browse />} />
                <Route path="/book" element={<Book />} />
                <Route path="/downloads" element={<Downloads />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </ErrorBoundary>
          </PullToRefreshHost>
        </main>
        {isMobile && <MobileTabBar />}
        {!isMobile && <UpdateChecker />}
      </div>
    </MobileSearchProvider>
  );
}
