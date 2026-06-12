import Layout from "./app/Layout";
import { useAuth } from "./auth/AuthContext";
import LoginPage from "./auth/LoginPage";

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-100 text-slate-400">
        Loading…
      </div>
    );
  }

  return user ? <Layout /> : <LoginPage />;
}
