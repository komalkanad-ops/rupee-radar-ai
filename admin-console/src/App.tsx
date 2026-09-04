import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Cards from "./pages/Cards";
import CardDetail from "./pages/CardDetail";
import Banks from "./pages/Banks";
import Portals from "./pages/Portals";
import MerchantRecommendations from "./pages/MerchantRecommendations";
import SubscriptionProviders from "./pages/SubscriptionProviders";
import Challenges from "./pages/Challenges";
import MerchantOffers from "./pages/MerchantOffers";
import Vouchers from "./pages/Vouchers";
import RedemptionQueue from "./pages/RedemptionQueue";
import Feedback from "./pages/Feedback";
import UserDiagnostics from "./pages/UserDiagnostics";
import BugReports from "./pages/BugReports";
import AppVersions from "./pages/AppVersions";
import Corrections from "./pages/Corrections";
import Users from "./pages/Users";
import AdminUsers from "./pages/AdminUsers";
import PushNotifications from "./pages/PushNotifications";
import Links from "./pages/Links";
import FeatureFlags from "./pages/FeatureFlags";
import Announcements from "./pages/Announcements";
import Logs from "./pages/Logs";
import MeshUsage from "./pages/MeshUsage";
import Analytics from "./pages/Analytics";
import AppAdoption from "./pages/AppAdoption";
import FeatureUsage from "./pages/FeatureUsage";
import Changelog from "./pages/Changelog";
import LoginBypass from "./pages/LoginBypass";
import Monitoring from "./pages/Monitoring";
import SiteScreenshots from "./pages/SiteScreenshots";

function RequireAuth({ children }: { children: JSX.Element }) {
  const token = localStorage.getItem("rr_admin_token");
  return token ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/cards" element={<Cards />} />
        <Route path="/cards/:id" element={<CardDetail />} />
        <Route path="/banks" element={<Banks />} />
        <Route path="/portals" element={<Portals />} />
        <Route path="/merchant-recommendations" element={<MerchantRecommendations />} />
        <Route path="/subscription-providers" element={<SubscriptionProviders />} />
        <Route path="/challenges" element={<Challenges />} />
        <Route path="/merchant-offers" element={<MerchantOffers />} />
        <Route path="/vouchers" element={<Vouchers />} />
        <Route path="/redemptions" element={<RedemptionQueue />} />
        <Route path="/feedback" element={<Feedback />} />
        <Route path="/bug-reports" element={<BugReports />} />
        <Route path="/user-diagnostics/:userId" element={<UserDiagnostics />} />
        <Route path="/login-bypass" element={<LoginBypass />} />
        <Route path="/app-versions" element={<AppVersions />} />
        <Route path="/corrections" element={<Corrections />} />
        <Route path="/users" element={<Users />} />
        <Route path="/admin-users" element={<AdminUsers />} />
        <Route path="/push" element={<PushNotifications />} />
        <Route path="/links" element={<Links />} />
        <Route path="/feature-flags" element={<FeatureFlags />} />
        <Route path="/announcements" element={<Announcements />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/mesh-usage" element={<MeshUsage />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/app-adoption" element={<AppAdoption />} />
        <Route path="/feature-usage" element={<FeatureUsage />} />
        <Route path="/monitoring" element={<Monitoring />} />
        <Route path="/changelog" element={<Changelog />} />
        <Route path="/site-screenshots" element={<SiteScreenshots />} />
      </Route>
    </Routes>
  );
}
