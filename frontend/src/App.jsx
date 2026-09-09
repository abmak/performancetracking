import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DateFilterProvider } from './context/DateFilterContext';
import Layout from './components/Layout';
import Home from './pages/Home';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';
import Services from './pages/Services';
import Targets from './pages/Targets';
import Revenue from './pages/Revenue';
import Import from './pages/Import';
import Reports from './pages/Reports';
import AuditTrail from './pages/AuditTrail';
import PartnerRevenue from './pages/PartnerRevenue';
import ActionNotes from './pages/ActionNotes';
import GoalCascade from './pages/GoalCascade';
import Categories from './pages/Categories';
import Roles from './pages/Roles';
import Users from './pages/Users';
import Alerts from './pages/Alerts';
import Messages from './pages/Messages';
import Chat from './pages/Chat';
import AIAssistant from './pages/AIAssistant';
import AIUsageReport from './pages/AIUsageReport';

// Protected route wrapper
function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

// Public route — redirect to dashboard if already logged in
function PublicRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <DateFilterProvider>
      <AuthProvider>
        <Toaster position="top-right" />
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/forgot-password" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* Protected routes — pathless layout keeps every module URL working */}
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/services" element={<Services />} />
            <Route path="/categories" element={<Categories />} />
            <Route path="/roles" element={<Roles />} />
            <Route path="/users" element={<Users />} />
            <Route path="/targets" element={<Targets />} />
            <Route path="/revenue" element={<Revenue />} />
            <Route path="/import" element={<Import />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/audit" element={<AuditTrail />} />
            <Route path="/partners" element={<PartnerRevenue />} />
            <Route path="/actions" element={<ActionNotes />} />
            <Route path="/goals" element={<GoalCascade />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/messages" element={<Messages />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/ai" element={<AIAssistant />} />
            <Route path="/ai-usage" element={<AIUsageReport />} />
          </Route>

          {/* Catch all — redirect to home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
      </DateFilterProvider>
    </BrowserRouter>
  );
}
