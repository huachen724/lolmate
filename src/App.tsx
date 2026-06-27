import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout/Layout";
import { LandingPage } from "./pages/LandingPage/LandingPage";
import { DashboardPage } from "./pages/DashboardPage/DashboardPage";
import { PlayerProfilePage } from "./pages/PlayerProfilePage/PlayerProfilePage";
import { LiveMatchPage } from "./pages/LiveMatchPage/LiveMatchPage";

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/profile/:gameName/:tagLine" element={<PlayerProfilePage />} />
        <Route path="/live/:gameName/:tagLine" element={<LiveMatchPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
