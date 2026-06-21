import { Navigate, Route, Routes } from "react-router-dom";

import CompanyHome from "./app/orrery/CompanyHome";
import FunctionStream from "./app/orrery/FunctionStream";
import ProjectView from "./app/orrery/ProjectView";
import { useAuth } from "./auth/AuthContext";
import LoginPage from "./auth/LoginPage";

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="grid min-h-full place-items-center bg-page text-hint">
        Loading…
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return (
    <Routes>
      <Route path="/" element={<CompanyHome />} />
      <Route path="/fn/:key" element={<FunctionStream />} />
      <Route path="/project/:id" element={<ProjectView />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
