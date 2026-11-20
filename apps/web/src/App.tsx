import { BrowserRouter, Route, Routes } from 'react-router';
import Landing from '@/screens/Landing';
import CallScreen from '@/screens/CallScreen';
import Studio from '@/screens/Studio';
import Summary from '@/screens/Summary';
import Desk from '@/screens/Desk';
import DeskCall from '@/screens/DeskCall';
import Integrations from '@/screens/Integrations';
import { DesktopOnly } from '@/screens/DesktopOnly';

export default function App() {
  return (
    <DesktopOnly>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/call/:sessionId" element={<CallScreen />} />
          <Route path="/call/:sessionId/summary" element={<Summary />} />
          <Route path="/desk" element={<Desk />} />
          <Route path="/desk/call/:sessionId" element={<DeskCall />} />
          <Route path="/desk/integrations" element={<Integrations />} />
          <Route path="/studio" element={<Studio />} />
        </Routes>
      </BrowserRouter>
    </DesktopOnly>
  );
}
