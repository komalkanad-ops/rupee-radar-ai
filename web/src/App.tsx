import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import Layout from "./components/Layout";
import { trackPageview } from "./lib/analytics";
import Home from "./pages/Home";
import Cards from "./pages/Cards";
import CardDetail from "./pages/CardDetail";
import BestCreditCards from "./pages/BestCreditCards";
import WhyRupeeRadarAiPage from "./pages/WhyRupeeRadarAiPage";
import StatementAnalyzer from "./pages/StatementAnalyzer";
import EmiCalculator from "./pages/EmiCalculator";
import FeedbackPage from "./pages/FeedbackPage";
import TermsOfService from "./pages/TermsOfService";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import Support from "./pages/Support";
import DeleteAccount from "./pages/DeleteAccount";
import Download from "./pages/Download";
import ChangelogPage from "./pages/ChangelogPage";

function PageviewTracker() {
  const location = useLocation();
  useEffect(() => {
    trackPageview(location.pathname);
  }, [location.pathname]);
  return null;
}

export default function App() {
  return (
    <>
      <PageviewTracker />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/cards" element={<Cards />} />
          <Route path="/cards/:id" element={<CardDetail />} />
          <Route path="/best-credit-cards/:category" element={<BestCreditCards />} />
          <Route path="/why-rupee-radar-ai" element={<WhyRupeeRadarAiPage />} />
          <Route path="/statement-analyzer" element={<StatementAnalyzer />} />
          <Route path="/emi-calculator" element={<EmiCalculator />} />
          <Route path="/feedback" element={<FeedbackPage />} />
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/support" element={<Support />} />
          <Route path="/download" element={<Download />} />
          <Route path="/delete-account" element={<DeleteAccount />} />
          <Route path="/changelog" element={<ChangelogPage />} />
        </Route>
      </Routes>
    </>
  );
}
