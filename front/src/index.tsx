import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";

import "./index.css";
import Layout from "./layout";
import { initTheme } from "./lib/theme";
import { preloadIllustrations } from "./lib/illustrations";
import { initAppIcon } from "./lib/appicon";
import { watchUnauthorized } from "./lib/auth";
import { AuthGate } from "./components/auth-gate";

import HomePage from "./pages/home";
import SearchPage from "./pages/search";
import SeriesPage from "./pages/series";
import RootPage from "./pages/root";
import NotFoundPage from "./pages/not-found";
import AdminPage from "./pages/admin";
import PairPage from "./pages/pair";
import { PDFViewerPage } from "./pages/viewer/pdf";
import { EPUBViewerPage } from "./pages/viewer/epub";
import { CBRViewerPage } from "./pages/viewer/cbr";
import { CBZViewerPage } from "./pages/viewer/cbz";

initTheme();
preloadIllustrations();
initAppIcon();
watchUnauthorized();

const container = document.querySelector("#root");
if (!container) {
	throw new Error("No root element found");
}
const root = createRoot(container);

// Everything except the pairing page needs this device to be allowed in.
function Gated() {
	return (
		<AuthGate>
			<Outlet />
		</AuthGate>
	);
}

root.render(
	<React.StrictMode>
		<BrowserRouter>
			<Routes>
				<Route path="/pair" element={<PairPage />} />
				<Route element={<Gated />}>
					<Route path="/" element={<Layout />}>
						<Route index element={<HomePage />} />
						<Route path="root/*" element={<RootPage />} />
						<Route path="series" element={<SeriesPage />} />
						<Route path="search" element={<SearchPage />} />
						<Route path="admin" element={<AdminPage />} />
						<Route path="*" element={<NotFoundPage />} />
					</Route>
					<Route path="/viewer/pdf" element={<PDFViewerPage />} />
					<Route path="/viewer/epub" element={<EPUBViewerPage />} />
					<Route path="/viewer/cbr" element={<CBRViewerPage />} />
					<Route path="/viewer/cbz" element={<CBZViewerPage />} />
				</Route>
			</Routes>
		</BrowserRouter>
	</React.StrictMode>
);
