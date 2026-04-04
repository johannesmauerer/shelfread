import { useState, useEffect } from "react";
import { Dashboard } from "./pages/Dashboard.tsx";
import { SeriesList } from "./pages/SeriesList.tsx";
import { SeriesDetail } from "./pages/SeriesDetail.tsx";
import { Settings } from "./pages/Settings.tsx";
import "./App.css";

type Route =
  | { page: "dashboard" }
  | { page: "series" }
  | { page: "series-detail"; id: string }
  | { page: "settings" };

function parseHash(): Route {
  const hash = window.location.hash.slice(1);
  if (hash === "series") return { page: "series" };
  if (hash.startsWith("series/")) return { page: "series-detail", id: hash.slice(7) };
  if (hash === "settings") return { page: "settings" };
  return { page: "dashboard" };
}

function App() {
  const [route, setRoute] = useState<Route>(parseHash);

  useEffect(() => {
    const handler = () => setRoute(parseHash());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1><a href="#" style={{ textDecoration: "none", color: "inherit" }}>Shelf</a></h1>
            <p className="subtitle">Newsletter-to-EPUB Service</p>
          </div>
          <nav className="app-nav">
            <a href="#" className={route.page === "dashboard" ? "active" : ""}>Dashboard</a>
            <a href="#series" className={route.page === "series" || route.page === "series-detail" ? "active" : ""}>Series</a>
            <a href="#settings" className={route.page === "settings" ? "active" : ""}>Settings</a>
          </nav>
        </div>
      </header>
      <main>
        {route.page === "dashboard" && <Dashboard />}
        {route.page === "series" && <SeriesList />}
        {route.page === "series-detail" && <SeriesDetail seriesId={route.id} />}
        {route.page === "settings" && <Settings />}
      </main>
    </div>
  );
}

export default App;
