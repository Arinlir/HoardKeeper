import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./fonts";
import "./index.css";
import { isNativeApp } from "./lib/platform";

// /w/<profile> is the one address that isn't the app: a read-only wishlist
// anyone can open, with no profile, PIN or stored state involved. Deciding it
// here rather than inside App keeps the gate/boot state machine from ever
// running for a visitor who has no account. The server's SPA fallback already
// serves index.html for this path.
const PublicWishlist = lazy(() =>
  import("./features/wishlist/PublicWishlist").then((m) => ({ default: m.PublicWishlist }))
);
// /v/<profile> is its sibling: the whole collection, read-only, for a guest
// who doesn't have (or need) the PIN. Same reasoning — decide it out here so
// the gate and the boot state machine never run for a visitor.
const PublicVault = lazy(() =>
  import("./features/vault/PublicVault").then((m) => ({ default: m.PublicVault }))
);

// /admin is the server operator's page (admin.cjs). It has its own sign-in and
// nothing to do with user accounts, so it too is decided before <App/> runs.
const AdminPage = lazy(() =>
  import("./features/admin/AdminPage").then((m) => ({ default: m.AdminPage }))
);

// Inside the Android/iOS app: hardware back button and the like. Lazy, so the
// web app never downloads any of it.
if (isNativeApp()) {
  import("./lib/nativeShell").then((m) => m.installNativeShell()).catch(() => {});
}

const path = window.location.pathname;
const publicMatch = path.match(/^\/w\/([A-Za-z0-9_-]{1,24})\/?$/);
const vaultMatch = path.match(/^\/v\/([A-Za-z0-9_-]{1,24})\/?$/);
const adminMatch = /^\/admin\/?$/i.test(path);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {adminMatch ? (
      <Suspense fallback={null}>
        <AdminPage />
      </Suspense>
    ) : publicMatch ? (
      <Suspense fallback={null}>
        <PublicWishlist name={publicMatch[1].toLowerCase()} />
      </Suspense>
    ) : vaultMatch ? (
      <Suspense fallback={null}>
        <PublicVault name={vaultMatch[1].toLowerCase()} />
      </Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>
);
