import { Outlet } from "react-router-dom";
import { Navbar } from "../Navbar/Navbar";
import { DemoModeBanner } from "../DemoModeBanner/DemoModeBanner";

export function Layout() {
  return (
    <>
      <DemoModeBanner />
      <Navbar />
      <main className="page">
        <Outlet />
      </main>
    </>
  );
}
