import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { useWedding } from '@/wedding/useWedding';
import Landing from '@/screens/Landing';
import CallScreen from '@/screens/CallScreen';
import Studio from '@/screens/Studio';
import Summary from '@/screens/Summary';
import Desk from '@/screens/Desk';
import DeskCall from '@/screens/DeskCall';
import Integrations from '@/screens/Integrations';
import { DesktopOnly } from '@/screens/DesktopOnly';
import { lazy, Suspense } from 'react';
import WeddingShell from '@/wedding/WeddingShell';
import Dashboard from '@/wedding/Dashboard';
import Planner from '@/wedding/Planner';
import Budget from '@/wedding/Budget';
import FlagsPage, { FeatureGate } from '@/wedding/Flags';
import Onboarding from '@/wedding/Onboarding';
import Marketplace from '@/wedding/vendors/Marketplace';
import MyVendors from '@/wedding/vendors/MyVendors';
import VendorProfile from '@/wedding/vendors/VendorProfile';
import VendorAdminPage from '@/wedding/vendors/admin/AdminPage';

// The studio pulls in three.js; load it only when opened.
const StudioPage = lazy(() => import('@/wedding/studio/StudioPage'));
const DesignPage = lazy(() => import('@/wedding/studio/design/DesignPage'));
const TryOnPage = lazy(() => import('@/wedding/TryOnPage'));

/** `/studio`: the AI design experience, unless the studio.ai_design flag is off (then the classic editor). */
function StudioHome() {
  const flags = useWedding((s) => s.flags);
  return flags?.flags['studio.ai_design'] === false ? <StudioPage /> : <DesignPage />;
}

/** `/studio/edit`: the manual editor, kept as a secondary "Advanced Edit". */
function AdvancedEdit() {
  const ai = useWedding((s) => s.flags?.flags['studio.ai_design'] !== false);
  return (
    <div className="flex flex-col gap-3">
      {ai ? <Link to="/studio" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink"><ArrowLeft size={16} aria-hidden />Back to design</Link> : null}
      <StudioPage />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Wedding OS */}
        <Route element={<WeddingShell />}>
          <Route index element={<Dashboard />} />
          <Route path="planner" element={<Planner />} />
          <Route path="budget" element={<Budget />} />
          <Route path="studio" element={<FeatureGate flag="studio.enabled" title="The 3D Wedding Studio"><Suspense fallback={<p className="text-ink-soft">Loading the studio…</p>}><StudioHome /></Suspense></FeatureGate>} />
          <Route path="studio/edit" element={<FeatureGate flag="studio.enabled" title="The 3D Wedding Studio"><Suspense fallback={<p className="text-ink-soft">Loading the editor…</p>}><AdvancedEdit /></Suspense></FeatureGate>} />
          <Route path="flags" element={<FlagsPage />} />
          <Route path="vendors" element={<FeatureGate flag="vendor.marketplace.enabled" title="The vendor marketplace"><Marketplace /></FeatureGate>} />
          <Route path="vendors/mine" element={<FeatureGate flag="vendor.marketplace.enabled" title="The vendor marketplace"><MyVendors /></FeatureGate>} />
          <Route path="vendors/admin" element={<VendorAdminPage />} />
          <Route path="vendors/:vid" element={<FeatureGate flag="vendor.marketplace.enabled" title="The vendor marketplace"><VendorProfile /></FeatureGate>} />
          <Route path="tryon" element={<FeatureGate flag="tryon.enabled" title="Virtual Outfit Try-On"><Suspense fallback={<p className="text-ink-soft">Loading try-on…</p>}><TryOnPage /></Suspense></FeatureGate>} />
          <Route path="welcome" element={<Onboarding />} />
        </Route>
        {/* Legacy real-estate screens, kept until their code is retired or reused. */}
        <Route path="/legacy" element={<DesktopOnly><Landing /></DesktopOnly>} />
        <Route path="/call/:sessionId" element={<DesktopOnly><CallScreen /></DesktopOnly>} />
        <Route path="/call/:sessionId/summary" element={<DesktopOnly><Summary /></DesktopOnly>} />
        <Route path="/desk" element={<DesktopOnly><Desk /></DesktopOnly>} />
        <Route path="/desk/call/:sessionId" element={<DesktopOnly><DeskCall /></DesktopOnly>} />
        <Route path="/desk/integrations" element={<DesktopOnly><Integrations /></DesktopOnly>} />
        <Route path="/legacy/studio" element={<DesktopOnly><Studio /></DesktopOnly>} />
      </Routes>
    </BrowserRouter>
  );
}
