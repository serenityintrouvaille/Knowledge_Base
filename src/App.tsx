import { useEffect, useState } from "react";
import { BrowserRouter, NavLink, Route, Routes, useLocation } from "react-router";
import { api, setUnauthorizedHandler } from "./api";
import { listCache } from "./cache";
import { IconLibrary, IconSearch, IconSettings, IconToday } from "./components/Icons";
import { Article } from "./pages/Article";
import { Library } from "./pages/Library";
import { Login } from "./pages/Login";
import { Search } from "./pages/Search";
import { Settings } from "./pages/Settings";
import { Today } from "./pages/Today";

const NAV = [
  { to: "/", label: "Today", Icon: IconToday },
  { to: "/library", label: "Library", Icon: IconLibrary },
  { to: "/search", label: "Search", Icon: IconSearch },
  { to: "/settings", label: "Settings", Icon: IconSettings },
];

function Shell({ onSignedOut }: { onSignedOut: () => void }) {
  const { pathname } = useLocation();
  const inArticle = pathname.startsWith("/item/");
  return (
    <>
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <div id="content" className={inArticle ? "layout layout-article" : "layout"}>
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/library" element={<Library />} />
          <Route path="/search" element={<Search />} />
          <Route path="/settings" element={<Settings onSignedOut={onSignedOut} />} />
          <Route path="/item/:id" element={<Article />} />
          <Route path="*" element={<Today />} />
        </Routes>
      </div>
      {!inArticle && (
        <nav className="tabbar" aria-label="Main">
          {NAV.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to} end={to === "/"} className="tab">
              <Icon />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </>
  );
}

export function App() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      listCache.clear();
      setSignedIn(false);
    });
    api
      .session()
      .then((s) => setSignedIn(s.signedIn))
      .catch(() => setSignedIn(false));
  }, []);

  if (signedIn === null) return <p className="loading loading-boot">Loading…</p>;
  if (!signedIn) return <Login onSignedIn={() => setSignedIn(true)} />;
  return (
    <BrowserRouter>
      <Shell onSignedOut={() => setSignedIn(false)} />
    </BrowserRouter>
  );
}
