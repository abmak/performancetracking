import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  Bell,
  Bot,
  FileBarChart,
  Gauge,
  Layers,
  Lightbulb,
  Lock,
  MessageSquare,
  Radio,
  Shield,
  Target,
  Zap,
  ChevronRight,
  CheckCircle2,
  BarChart3,
} from 'lucide-react';
import {
  BarChart, Bar, Line, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts';

/* ── Service catalog (matches the live system data) ───────────────────────── */
const services = [
  { name: 'ETZ Cloud', desc: 'Cloud computing & virtual infrastructure services for enterprise customers.' },
  { name: 'IP PBX', desc: 'Enterprise-grade IP telephony and unified communication platform.' },
  { name: 'Interactive Voice Response', desc: 'Automated IVR flows for self-service, info lines and call routing.' },
  { name: 'Voice Premium', desc: 'Premium voice content and value-added voice services.' },
  { name: 'Mobile Originating', desc: 'Revenue from mobile-originated calls, SMS and USSD sessions.' },
  { name: 'Mobile Terminating', desc: 'Interconnect & on-net terminating traffic revenue streams.' },
  { name: 'Application Protocol Interface', desc: 'Open API monetization for third-party application developers.' },
  { name: 'Call Ring Tone', desc: 'Personalized ring-back tone subscriptions and downloads.' },
  { name: 'National Lottery', desc: 'Digital lottery and gaming services with real-time draw monitoring.' },
  { name: 'Airtime Credit Service', desc: 'Flexible airtime advance and credit products for subscribers.' },
];

/* ── Module / feature highlights ──────────────────────────────────────────── */
const modules = [
  { icon: Gauge, title: 'Real-Time Revenue Alerts', desc: 'Per-service traffic-light monitoring against daily, monthly and overall targets — with variance analysis and month-by-month breakdowns.' },
  { icon: Target, title: 'Revenue Target Management', desc: 'Annual, quarterly and semi-annual targets with dynamic expected-revenue distribution across the remaining months.' },
  { icon: Layers, title: 'Goal Cascading', desc: 'Break fiscal targets down by period with date filters, actual-revenue scoring, achievement progress bars and charts.' },
  { icon: Lightbulb, title: 'Action Notes & Task Assignment', desc: 'Log revenue-impacting actions, compute revenue change, assign tasks to team members with notifications and reply threads.' },
  { icon: Bot, title: 'VAS AI Assistant', desc: 'Ask questions in plain language about revenue, targets and performance — with per-user daily quotas and usage reporting.' },
  { icon: MessageSquare, title: 'Staff Feedback & Chat', desc: 'Feedback on every revenue alert, group/direct chat, and notifications so the whole team stays aligned.' },
  { icon: FileBarChart, title: 'Executive Reports', desc: 'One-click PowerPoint and Excel reporting with professional graphs built from live performance data.' },
  { icon: Shield, title: 'Roles, Permissions & Audit', desc: 'Granular role-based access control, user management, profile pictures and a full audit trail of every action.' },
];

/* ── Sample preview data — illustrative figures only ─────────────────────── */
const sampleMonthly = [
  { m: 'Jan', target: 1520, actual: 1240, ach: 82 },
  { m: 'Feb', target: 1520, actual: 1310, ach: 86 },
  { m: 'Mar', target: 1530, actual: 1410, ach: 92 },
  { m: 'Apr', target: 1530, actual: 1180, ach: 77 },
  { m: 'May', target: 1540, actual: 1340, ach: 87 },
  { m: 'Jun', target: 1540, actual: 1470, ach: 95 },
  { m: 'Jul', target: 1550, actual: 1390, ach: 90 },
  { m: 'Aug', target: 1550, actual: 1260, ach: 81 },
  { m: 'Sep', target: 1560, actual: 1430, ach: 92 },
  { m: 'Oct', target: 1560, actual: 1210, ach: 78 },
  { m: 'Nov', target: 1570, actual: 1380, ach: 88 },
  { m: 'Dec', target: 1570, actual: 1500, ach: 96 },
];

const sampleShare = [
  { name: 'Service A', value: 34, color: '#059669' },
  { name: 'Service B', value: 22, color: '#10b981' },
  { name: 'Service C', value: 16, color: '#34d399' },
  { name: 'Service D', value: 11, color: '#6ee7b7' },
  { name: 'Service E', value: 9, color: '#a7f3d0' },
  { name: 'Others', value: 8, color: '#d1fae5' },
];

const sampleTrend = [
  { m: 'W1', rev: 240, prev: 210 },
  { m: 'W2', rev: 280, prev: 240 },
  { m: 'W3', rev: 260, prev: 270 },
  { m: 'W4', rev: 320, prev: 285 },
  { m: 'W5', rev: 300, prev: 310 },
  { m: 'W6', rev: 370, prev: 330 },
  { m: 'W7', rev: 410, prev: 360 },
  { m: 'W8', rev: 390, prev: 380 },
];

const sampleServices = [
  { name: 'Sample Service 1', status: 'On Track', level: 'green', pct: 92 },
  { name: 'Sample Service 2', status: 'On Track', level: 'green', pct: 78 },
  { name: 'Sample Service 3', status: 'Warning', level: 'amber', pct: 47 },
  { name: 'Sample Service 4', status: 'On Track', level: 'green', pct: 88 },
  { name: 'Sample Service 5', status: 'Warning', level: 'amber', pct: 39 },
  { name: 'Sample Service 6', status: 'Critical', level: 'red', pct: 21 },
];

const statusStyle = {
  green: { dot: 'bg-green-500', text: 'text-green-700 bg-green-50 border-green-200', bar: 'bg-green-500' },
  amber: { dot: 'bg-amber-500', text: 'text-amber-700 bg-amber-50 border-amber-200', bar: 'bg-amber-500' },
  red: { dot: 'bg-red-500', text: 'text-red-700 bg-red-50 border-red-200', bar: 'bg-red-500' },
};

/* ── How it works ─────────────────────────────────────────────────────────── */
const steps = [
  { num: '01', title: 'Load Revenue Data', desc: 'Import monthly actual revenue per service from Excel or the built-in data entry forms.' },
  { num: '02', title: 'Set Targets', desc: 'Define revenue targets per service with start and end dates — the system distributes expected revenue across months.' },
  { num: '03', title: 'Monitor Live', desc: 'Revenue Alerts track actual vs expected in real time and flag critical, warning or on-track services.' },
  { num: '04', title: 'Act & Improve', desc: 'Create action notes, assign tasks, get AI insights and watch achievement climb on the dashboard.' },
];

/* ── Counter animation for stat band ──────────────────────────────────────── */
function useCountUp(target, duration = 1400) {
  const [value, setValue] = useState(0);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const startTime = Date.now();
    function tick() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(target * eased);
      if (progress < 1) requestAnimationFrame(tick);
    }
    tick();
  }, [target, duration]);
  return value;
}

function Stat({ icon: Icon, value, suffix, label, color, light }) {
  const n = useCountUp(value);
  return (
    <div className="flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl ${light} flex items-center justify-center shrink-0`}>
        <Icon size={22} className={color} />
      </div>
      <div>
        <p className="text-2xl md:text-3xl font-black text-gray-900 tabular-nums">
          {Math.round(n).toLocaleString()}{suffix}
        </p>
        <p className="text-xs md:text-sm text-gray-500 font-medium">{label}</p>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/ethio-telecom-logo.png" alt="Ethio Telecom" className="h-10" />
            <div className="w-px h-6 bg-gray-300" />
            <div>
              <p className="text-sm font-bold text-gray-900 leading-tight">VAS Performance Tracker</p>
              <p className="text-[10px] font-medium tracking-[0.2em] uppercase text-green-600">Ethio Telecom · VAS Section</p>
            </div>
          </div>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white text-sm font-semibold px-5 py-2.5 rounded-lg shadow-md shadow-green-500/25 transition-all"
          >
            <Lock size={15} />
            Login
          </Link>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-green-50 via-emerald-50 to-white">
        <div className="absolute inset-0 opacity-[0.06] pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #059669 1px, transparent 0)', backgroundSize: '28px 28px' }} />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-24 grid lg:grid-cols-2 gap-12 items-center relative">
          <div>
            <div className="inline-flex items-center gap-2 bg-green-100 text-green-800 text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              LIVE REAL-TIME MONITORING SYSTEM
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-gray-900 leading-tight mb-5">
              Track VAS Revenue{' '}
              <span className="bg-gradient-to-r from-green-600 to-emerald-500 bg-clip-text text-transparent">
                Performance
              </span>{' '}
              in Real Time
            </h1>
            <p className="text-lg text-gray-600 leading-relaxed mb-8 max-w-xl">
              The centralized monitoring platform for Ethio Telecom's Value Added Services —
              revenue targets, actual collection, alerts, action management and AI-powered
              insights across every VAS service.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link
                to="/login"
                className="inline-flex items-center gap-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-semibold px-7 py-3.5 rounded-xl shadow-lg shadow-green-500/30 transition-all"
              >
                Access Dashboard
                <ChevronRight size={18} />
              </Link>
              <a
                href="#services"
                className="inline-flex items-center gap-2 bg-white border border-gray-200 hover:border-green-400 hover:text-green-700 text-gray-700 font-semibold px-7 py-3.5 rounded-xl transition-all"
              >
                Explore Services
              </a>
            </div>
          </div>

          {/* Hero visual — platform capabilities card */}
          <div className="relative">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl shadow-green-900/10 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gray-50/60">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-red-400" />
                  <span className="w-3 h-3 rounded-full bg-amber-400" />
                  <span className="w-3 h-3 rounded-full bg-green-400" />
                </div>
                <span className="text-[11px] font-mono text-gray-400">vas-platform / system-modules</span>
              </div>
              <div className="p-6 space-y-3">
                {[
                  { icon: Gauge, name: 'Revenue Alerts', desc: 'Traffic-light monitoring per service' },
                  { icon: Target, name: 'Target Management', desc: 'Plan targets with start & end dates' },
                  { icon: Layers, name: 'Goal Cascading', desc: 'Fiscal breakdowns with progress bars' },
                  { icon: Lightbulb, name: 'Action Notes', desc: 'Log actions, assign tasks, track replies' },
                  { icon: Bot, name: 'VAS AI Assistant', desc: 'Ask anything about your performance' },
                  { icon: MessageSquare, name: 'Feedback & Chat', desc: 'Team collaboration in one place' },
                  { icon: FileBarChart, name: 'Executive Reports', desc: 'Professional PPT & Excel exports' },
                  { icon: Shield, name: 'Secure Access', desc: 'Role-based permissions & audit trail' },
                ].map(m => (
                  <div key={m.name} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/50 px-4 py-3">
                    <div className="w-9 h-9 rounded-lg bg-white border border-gray-200 flex items-center justify-center shrink-0">
                      <m.icon size={16} className="text-green-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-900">{m.name}</p>
                      <p className="text-[11px] text-gray-500 truncate">{m.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Floating chips */}
            <div className="absolute -top-4 -right-3 bg-white border border-green-200 shadow-lg rounded-xl px-4 py-2.5 flex items-center gap-2">
              <Shield size={16} className="text-green-600" />
              <span className="text-xs font-bold text-gray-800">Secure Role-Based Access</span>
            </div>
            <div className="absolute -bottom-4 -left-3 bg-white border border-green-200 shadow-lg rounded-xl px-4 py-2.5 flex items-center gap-2">
              <Bot size={16} className="text-emerald-600" />
              <span className="text-xs font-bold text-gray-800">AI Assistant Powered</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats band (functionality only) ────────────────────────────────── */}
      <section className="border-y border-gray-100 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 grid grid-cols-2 lg:grid-cols-4 gap-8">
          <Stat icon={Radio} value={10} suffix="" label="VAS Services Monitored" color="text-green-600" light="bg-green-50" />
          <Stat icon={Layers} value={8} suffix="" label="Integrated System Modules" color="text-blue-600" light="bg-blue-50" />
          <Stat icon={Zap} value={24} suffix="/7" label="Real-Time Monitoring" color="text-amber-600" light="bg-amber-50" />
          <Stat icon={Shield} value={100} suffix="%" label="Role-Based Secure Access" color="text-purple-600" light="bg-purple-50" />
        </div>
      </section>

      {/* ── What is the system ─────────────────────────────────────────────── */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-2 gap-14 items-center">
          <div>
            <p className="text-xs font-bold tracking-[0.25em] uppercase text-green-600 mb-3">About the Platform</p>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 leading-tight mb-6">
              One Platform to Plan, Monitor & Grow Your VAS Revenue
            </h2>
            <p className="text-gray-600 leading-relaxed mb-6">
              VAS Performance Tracker gives the VAS section of Ethio Telecom a single source of
              truth for revenue performance. Define targets per service, load actual monthly
              collections, and let the system compute achievement, variance and alerts automatically.
            </p>
            <ul className="space-y-4">
              {[
                'Fiscal-year planning with dynamic expected-revenue distribution',
                'Per-service achievement scoring with progress bars and graphs',
                'Immediate critical / warning / on-track alerting on every service',
                'Accountable actions with task assignment, replies and notifications',
              ].map(t => (
                <li key={t} className="flex items-start gap-3">
                  <CheckCircle2 size={20} className="text-green-600 shrink-0 mt-0.5" />
                  <span className="text-gray-700">{t}</span>
                </li>
              ))}
            </ul>
            <Link to="/login" className="inline-flex items-center gap-2 mt-8 text-green-600 hover:text-green-700 font-semibold">
              Sign in to explore the full dashboard
              <ChevronRight size={18} />
            </Link>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
              <Activity size={18} className="text-green-600" />
              <h3 className="text-sm font-bold text-gray-900">Key Capabilities at a Glance</h3>
            </div>
            <div className="p-6 space-y-4">
              {[
                { title: 'Fiscal-Year Planning', desc: 'Set targets with start & end dates and auto-distribute expected revenue across periods.' },
                { title: 'Live Performance Scoring', desc: 'Achievement scores and progress bars computed automatically for every service.' },
                { title: 'Alerting & Escalation', desc: 'Critical, warning and on-track statuses keep the team focused on what matters.' },
                { title: 'Accountability', desc: 'Action notes, task assignment, notifications and reply threads for every decision.' },
                { title: 'AI-Powered Insights', desc: 'Ask the VAS AI Assistant questions in plain language and get instant answers.' },
                { title: 'Executive Reporting', desc: 'One-click professional reports with graphs — fully automated from live data.' },
              ].map(c => (
                <div key={c.title} className="flex items-start gap-3">
                  <CheckCircle2 size={18} className="text-green-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-gray-900">{c.title}</p>
                    <p className="text-[13px] text-gray-500 leading-relaxed">{c.desc}</p>
                  </div>
                </div>
              ))}
              <div className="border-t border-dashed border-gray-200 pt-4 flex items-center gap-2 text-[11px] text-gray-400">
                <Lock size={13} className="text-green-600" />
                Detailed performance data is available after signing in.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Services grid ───────────────────────────────────────────────────── */}
      <section id="services" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <p className="text-xs font-bold tracking-[0.25em] uppercase text-green-600 mb-3">Services Under Monitoring</p>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-4">Every VAS Service, One Dashboard</h2>
            <p className="text-gray-600">
              Each service gets its own target, actual revenue tracking, alert level and
              achievement score — visible in the Revenue Alerts module in real time.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {services.map(s => (
              <div key={s.name} className="group bg-white border border-gray-200 rounded-2xl p-6 hover:border-green-300 hover:shadow-xl hover:shadow-green-900/5 transition-all duration-300">
                <div className="w-11 h-11 rounded-xl bg-green-50 group-hover:bg-green-600 flex items-center justify-center mb-4 transition-colors">
                  <Activity size={20} className="text-green-600 group-hover:text-white transition-colors" />
                </div>
                <h3 className="text-base font-bold text-gray-900 mb-1.5">{s.name}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Modules / features ──────────────────────────────────────────────── */}
      <section className="py-20 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <p className="text-xs font-bold tracking-[0.25em] uppercase text-green-600 mb-3">System Modules</p>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-4">Everything Your Team Needs</h2>
            <p className="text-gray-600">
              Eight tightly-integrated modules cover the full revenue management lifecycle —
              from planning to execution to executive reporting.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {modules.map(m => (
              <div key={m.title} className="bg-white border border-gray-200 rounded-2xl p-6 hover:-translate-y-1 hover:shadow-xl hover:border-green-200 transition-all duration-300">
                <div className="w-11 h-11 rounded-xl bg-green-100 flex items-center justify-center mb-4">
                  <m.icon size={20} className="text-green-700" />
                </div>
                <h3 className="text-sm font-bold text-gray-900 mb-2">{m.title}</h3>
                <p className="text-[13px] text-gray-500 leading-relaxed">{m.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────────────── */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <p className="text-xs font-bold tracking-[0.25em] uppercase text-green-600 mb-3">How It Works</p>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-4">From Data to Decisions in Four Steps</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {steps.map((s, i) => (
              <div key={s.num} className="relative">
                {i < steps.length - 1 && (
                  <div className="hidden lg:block absolute top-7 left-[calc(50%+2.5rem)] w-[calc(100%-5rem)] border-t-2 border-dashed border-green-200" />
                )}
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-green-600 to-emerald-500 text-white flex items-center justify-center text-lg font-black shadow-lg shadow-green-500/25 mb-5 relative">
                  {s.num}
                </div>
                <h3 className="text-base font-bold text-gray-900 mb-2">{s.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Sample preview section ─────────────────────────────────────────── */}
      <section className="py-20 bg-gray-50 border-y border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <p className="text-xs font-bold tracking-[0.25em] uppercase text-green-600 mb-3">System Preview</p>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-4">What the Dashboard, Monitoring & Reports Look Like</h2>
            <p className="text-gray-600">
              A glimpse of the professional charts and visualisations you get after signing in.
              Everything below is a <span className="font-semibold text-gray-800">sample illustration</span> — live figures appear only inside the secured system.
            </p>
          </div>

          {/* Dashboard preview — target vs actual */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-xl overflow-hidden mb-6">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                  <BarChart3 size={16} className="text-green-700" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Dashboard View — Monthly Target vs Actual</h3>
                  <p className="text-[11px] text-gray-400">Sample · amounts in ETB millions</p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-green-100 text-green-700 text-[11px] font-bold">SAMPLE</span>
            </div>
            <div className="p-6">
              {/* Mini KPI strip — gives the card a real dashboard feel */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
                <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-3">
                  <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                    <Target size={16} className="text-gray-500" />
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Total Target</p>
                    <p className="text-base font-black text-gray-900">ETB 18.5B</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-xl border border-green-100 bg-green-50/60 px-4 py-3">
                  <div className="w-9 h-9 rounded-lg bg-green-600 flex items-center justify-center shrink-0">
                    <Activity size={16} className="text-white" />
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-green-600">Actual Revenue</p>
                    <p className="text-base font-black text-gray-900">ETB 16.1B</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-3">
                  <div className="w-9 h-9 rounded-lg bg-emerald-600 flex items-center justify-center shrink-0">
                    <Zap size={16} className="text-white" />
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">Overall Achievement</p>
                    <p className="text-base font-black text-gray-900">87<span className="text-emerald-600">%</span></p>
                  </div>
                </div>
              </div>

              {/* Gradient area chart — actual vs target with achievement line */}
              <ResponsiveContainer width="100%" height={290}>
                <ComposedChart data={sampleMonthly} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gAct" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.5} />
                      <stop offset="55%" stopColor="#10b981" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.03} />
                    </linearGradient>
                    <linearGradient id="gTgt" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#94a3b8" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="#94a3b8" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" vertical={false} />
                  <XAxis dataKey="m" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
                  <YAxis yAxisId="etb" tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `${v}M`} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `${v}%`} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(v, name) => (name === 'Achievement %' ? [`${v}%`, name] : [`ETB ${v}M`, name])}
                    contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', boxShadow: '0 8px 24px rgba(0,0,0,0.08)', fontSize: 12 }}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Area yAxisId="etb" type="monotone" dataKey="target" name="Monthly Target" stroke="#94a3b8" strokeWidth={2} strokeDasharray="6 5" fill="url(#gTgt)" />
                  <Area yAxisId="etb" type="monotone" dataKey="actual" name="Actual Revenue" stroke="#059669" strokeWidth={3} fill="url(#gAct)" dot={{ r: 3.5, fill: '#fff', stroke: '#059669', strokeWidth: 2.5 }} activeDot={{ r: 6 }} />
                  <Line yAxisId="pct" type="monotone" dataKey="ach" name="Achievement %" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3, fill: '#fff', stroke: '#f59e0b', strokeWidth: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Monitoring preview */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Gauge size={16} className="text-green-600" />
                  <h3 className="text-sm font-bold text-gray-900">Monitoring View</h3>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-bold">SAMPLE</span>
              </div>
              <div className="p-5 space-y-3">
                {sampleServices.map(s => {
                  const st = statusStyle[s.level];
                  return (
                    <div key={s.name} className="rounded-xl border border-gray-100 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-gray-800">{s.name}</span>
                        <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full border ${st.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                          {s.status}
                        </span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full ${st.bar} rounded-full`} style={{ width: `${s.pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                <p className="text-[11px] text-gray-400 text-center pt-1">Achievement status per service — live inside Revenue Alerts</p>
              </div>
            </div>

            {/* Report preview — donut */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileBarChart size={16} className="text-green-600" />
                  <h3 className="text-sm font-bold text-gray-900">Reporting View</h3>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-bold">SAMPLE</span>
              </div>
              <div className="p-5">
                <ResponsiveContainer width="100%" height={190}>
                  <PieChart>
                    <Pie data={sampleShare} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={2}>
                      {sampleShare.map(entry => <Cell key={entry.name} fill={entry.color} />)}
                    </Pie>
                    <Tooltip formatter={(v) => [`${v}%`, 'Share']} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-2">
                  {sampleShare.map(s => (
                    <div key={s.name} className="flex items-center gap-2 text-[11px]">
                      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
                      <span className="text-gray-600 truncate">{s.name}</span>
                      <span className="text-gray-900 font-bold ml-auto">{s.value}%</span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-gray-400 text-center pt-3">Revenue contribution by service — as exported in reports</p>
              </div>
            </div>

            {/* Trend preview — area chart */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity size={16} className="text-green-600" />
                  <h3 className="text-sm font-bold text-gray-900">Trend Analysis</h3>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-bold">SAMPLE</span>
              </div>
              <div className="p-5">
                <ResponsiveContainer width="100%" height={190}>
                  <AreaChart data={sampleTrend} margin={{ top: 5, right: 5, left: -22, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#059669" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#059669" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="gPrev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#94a3b8" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="#94a3b8" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="m" tick={{ fontSize: 11, fill: '#6b7280' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={v => `${v}M`} />
                    <Tooltip formatter={(v, name) => [`ETB ${v}M`, name]} />
                    <Legend />
                    <Area type="monotone" dataKey="prev" name="Previous Period" stroke="#94a3b8" strokeWidth={1.5} fill="url(#gPrev)" />
                    <Area type="monotone" dataKey="rev" name="Current Period" stroke="#059669" strokeWidth={2} fill="url(#gRev)" />
                  </AreaChart>
                </ResponsiveContainer>
                <p className="text-[11px] text-gray-400 text-center pt-3">Period-over-period performance trend</p>
              </div>
            </div>
          </div>

          <div className="mt-6 text-center">
            <Link to="/login" className="inline-flex items-center gap-2 text-green-600 hover:text-green-700 font-semibold">
              Sign in to see these views with your live data
              <ChevronRight size={18} />
            </Link>
          </div>
        </div>
      </section>

      {/* ── CTA banner ──────────────────────────────────────────────────────── */}
      <section className="pb-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-green-600 via-emerald-600 to-green-600 px-8 py-14 text-center shadow-2xl shadow-green-600/30">
            <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)', backgroundSize: '22px 22px' }} />
            <h2 className="relative text-3xl sm:text-4xl font-black text-white mb-3">
              Ready to See Your VAS Revenue in Real Time?
            </h2>
            <p className="relative text-green-50 text-lg mb-8 max-w-xl mx-auto">
              Log in to the monitoring dashboard and get instant visibility into every service,
              target and revenue trend.
            </p>
            <Link
              to="/login"
              className="relative inline-flex items-center gap-2 bg-white text-green-700 hover:bg-green-50 font-bold px-8 py-4 rounded-xl shadow-lg transition-all"
            >
              <Lock size={18} />
              Login to Dashboard
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-100 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="grid md:grid-cols-3 gap-8">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <img src="/ethio-telecom-logo.png" alt="Ethio Telecom" className="h-9" />
                <div>
                  <p className="text-sm font-bold text-gray-900">VAS Performance Tracker</p>
                  <p className="text-[10px] tracking-[0.2em] uppercase text-green-600 font-medium">VAS Section</p>
                </div>
              </div>
              <p className="text-sm text-gray-500 leading-relaxed">
                Real-time revenue monitoring and performance management system for
                Ethio Telecom Value Added Services.
              </p>
            </div>
            <div>
              <h4 className="text-xs font-bold tracking-wider uppercase text-gray-900 mb-3">Quick Links</h4>
              <ul className="space-y-2 text-sm text-gray-500">
                <li><a href="#services" className="hover:text-green-600 transition-colors">Services</a></li>
                <li><Link to="/login" className="hover:text-green-600 transition-colors">Login</Link></li>
                <li><Link to="/forgot-password" className="hover:text-green-600 transition-colors">Forgot Password</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-bold tracking-wider uppercase text-gray-900 mb-3">Key Modules</h4>
              <ul className="space-y-2 text-sm text-gray-500">
                <li className="flex items-center gap-2"><Bell size={14} className="text-green-600" /> Revenue Alerts</li>
                <li className="flex items-center gap-2"><Layers size={14} className="text-green-600" /> Goal Cascading</li>
                <li className="flex items-center gap-2"><Bot size={14} className="text-green-600" /> VAS AI Assistant</li>
                <li className="flex items-center gap-2"><FileBarChart size={14} className="text-green-600" /> Executive Reports</li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-200 mt-8 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-gray-400">© {new Date().getFullYear()} Ethio Telecom · VAS Performance Tracker</p>
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              System Operational
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}