import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { alertsAPI, alertFeedbackAPI } from '../services/api';
import { useDateFilter } from '../context/DateFilterContext';
import { BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, ReferenceLine, Cell } from 'recharts';
import {
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Calendar,
  Target,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  BarChart3,
  Bell,
  XCircle,
  Info,
  Clock,
  TrendingUp,
  MessageSquare,
  Send,
  Trash2,
} from 'lucide-react';

const formatETB = (amount) => {
  if (amount >= 1e9) return `ETB ${(amount / 1e9).toFixed(2)}B`;
  if (amount >= 1e6) return `ETB ${(amount / 1e6).toFixed(2)}M`;
  if (amount >= 1e3) return `ETB ${(amount / 1e3).toFixed(1)}K`;
  return `ETB ${amount.toLocaleString()}`;
};

const alertColors = {
  green: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', icon: CheckCircle2, label: 'On Track', dot: 'bg-emerald-500' },
  yellow: { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700', icon: AlertTriangle, label: 'Slightly Behind', dot: 'bg-yellow-500' },
  orange: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', icon: AlertCircle, label: 'Behind Target', dot: 'bg-orange-500' },
  red: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', icon: XCircle, label: 'Critical', dot: 'bg-red-500' },
  none: { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-500', icon: Minus, label: 'No Data', dot: 'bg-gray-400' },
};

const alertTips = {
  green: {
    title: '✅ On Track (≥90%)',
    desc: 'Revenue is meeting or exceeding the expected amount for this period. No action needed.',
  },
  yellow: {
    title: '⚠️ Slightly Behind (70–89%)',
    desc: 'Revenue is slightly below target. Monitor closely and consider minor adjustments to get back on track.',
  },
  orange: {
    title: '🔶 Behind Target (50–69%)',
    desc: 'Revenue is significantly below target. Review action items, partner performance, and market conditions to recover.',
  },
  red: {
    title: '🔴 Critical (<50%)',
    desc: 'Revenue is far below expected. Immediate action required — escalate to management, review partnerships, and implement corrective measures.',
  },
  none: {
    title: '— No Data',
    desc: 'No revenue data available for this period yet.',
  },
};

export default function Alerts() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedService, setExpandedService] = useState(null);
  const [filter, setFilter] = useState('all');
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [feedbackSummary, setFeedbackSummary] = useState([]);
  const [feedbackModal, setFeedbackModal] = useState(null);
  const [newFeedback, setNewFeedback] = useState({ feedback: '', insight: '' });
  const [expandedReplies, setExpandedReplies] = useState({});
  const [replyText, setReplyText] = useState({});
  const [myReactions, setMyReactions] = useState({}); // { feedbackId: reactionType }
  const { startDate, endDate, setStartDate, setEndDate } = useDateFilter();

  useEffect(() => {
    loadAlerts();
    loadFeedbackSummary();
  }, [startDate, endDate]);

  async function loadAlerts() {
    try {
      setLoading(true);
      const params = {};
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      const result = await alertsAPI.getAll(params);
      setData(result);
    } catch (err) {
      console.error('Failed to load alerts:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadFeedbackSummary() {
    try {
      const result = await alertFeedbackAPI.getSummary();
      setFeedbackSummary(result);
    } catch (err) { console.error(err); }
  }

  async function openFeedback(serviceName) {
    try {
      const feedbacks = await alertFeedbackAPI.getByService(serviceName);
      setFeedbackModal({ serviceName, feedbacks, showNew: false });
      setNewFeedback({ feedback: '', insight: '' });
      // Load user's existing reactions for each feedback
      if (user?.id) {
        const newMyReactions = {};
        for (const fb of feedbacks) {
          try {
            const reactions = await alertFeedbackAPI.getReactions(fb.id);
            const userReaction = reactions.find(r => r.user_id === user.id);
            if (userReaction) newMyReactions[fb.id] = userReaction.reaction_type;
          } catch {}
        }
        setMyReactions(newMyReactions);
      }
    } catch (err) { console.error(err); }
  }

  async function submitFeedback() {
    if (!newFeedback.feedback.trim()) return;
    try {
      const result = await alertFeedbackAPI.create({
        service_name: feedbackModal.serviceName,
        feedback: newFeedback.feedback,
        insight: newFeedback.insight,
        created_by: user?.id || 1,
      });
      result.reaction_count = 0;
      result.reply_count = 0;
      setFeedbackModal(prev => ({ ...prev, feedbacks: [result, ...prev.feedbacks], showNew: false }));
      setNewFeedback({ feedback: '', insight: '' });
      loadFeedbackSummary();
    } catch (err) { console.error(err); }
  }

  async function deleteFeedback(id) {
    try {
      await alertFeedbackAPI.delete(id);
      setFeedbackModal(prev => ({ ...prev, feedbacks: prev.feedbacks.filter(f => f.id !== id) }));
      loadFeedbackSummary();
    } catch (err) { console.error(err); }
  }

  async function handleReaction(feedbackId, reactionType) {
    try {
      await alertFeedbackAPI.toggleReaction(feedbackId, { reaction_type: reactionType, user_id: user?.id || 1 });
      // Toggle local state — only one reaction per user
      const oldReaction = myReactions[feedbackId];
      const isSameReaction = oldReaction === reactionType;
      const newType = isSameReaction ? null : reactionType;
      setMyReactions(prev2 => ({ ...prev2, [feedbackId]: newType }));
      // Update per-type counts locally
      setFeedbackModal(modal => ({
        ...modal,
        feedbacks: modal.feedbacks.map(fb => {
          if (fb.id !== feedbackId) return fb;
          const newReactionTypes = { ...(fb.reaction_types || {}) };
          // Decrement old reaction count
          if (oldReaction && !isSameReaction) {
            newReactionTypes[oldReaction] = Math.max(0, (newReactionTypes[oldReaction] || 1) - 1);
            if (newReactionTypes[oldReaction] === 0) delete newReactionTypes[oldReaction];
          }
          // Increment new reaction count (or toggle off)
          if (isSameReaction) {
            newReactionTypes[reactionType] = Math.max(0, (newReactionTypes[reactionType] || 1) - 1);
            if (newReactionTypes[reactionType] === 0) delete newReactionTypes[reactionType];
          } else {
            newReactionTypes[reactionType] = (newReactionTypes[reactionType] || 0) + 1;
          }
          // Compute total reaction_count
          const totalCount = Object.values(newReactionTypes).reduce((a, b) => a + b, 0);
          return { ...fb, reaction_types: newReactionTypes, reaction_count: totalCount };
        })
      }));
    } catch (err) { console.error(err); }
  }

  async function handleReply(feedbackId) {
    const text = replyText[feedbackId];
    if (!text || !text.trim()) return;
    try {
      const result = await alertFeedbackAPI.addReply(feedbackId, { reply: text, user_id: user?.id || 1 });
      setFeedbackModal(prev => ({
        ...prev,
        feedbacks: prev.feedbacks.map(fb => fb.id === feedbackId ? { ...fb, reply_count: (fb.reply_count || 0) + 1 } : fb)
      }));
      setReplyText(prev => ({ ...prev, [feedbackId]: '' }));
      setExpandedReplies(prev => ({ ...prev, [feedbackId]: true }));
    } catch (err) { console.error(err); }
  }

  function getFeedbackCount(serviceName) {
    const found = feedbackSummary.find(s => s.service_name === serviceName);
    return found ? found.total_feedback : 0;
  }

  const reactionTypes = [
    { type: 'like', emoji: '👍', label: 'Like' },
    { type: 'agree', emoji: '✅', label: 'Agree' },
    { type: 'insightful', emoji: '💡', label: 'Insightful' },
    { type: 'concern', emoji: '⚠️', label: 'Concern' },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data || data.services.length === 0) {
    return (
      <div className="space-y-6">
        {/* Header with date filter always visible */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/25 flex items-center justify-center">
              <Bell size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Revenue Alerts</h1>
              <p className="text-gray-500 text-sm">Real-time expected vs actual revenue monitoring</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-white border border-gray-200 shadow-sm rounded-xl px-3 py-2">
              <Calendar size={14} className="text-emerald-500" />
              <label className="text-xs font-medium text-gray-500">Start:</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="text-sm border-0 outline-none text-gray-700 bg-transparent"
              />
              <span className="text-gray-300 mx-1">—</span>
              <label className="text-xs font-medium text-gray-500">End:</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="text-sm border-0 outline-none text-gray-700 bg-transparent"
              />
            </div>
            <button
              onClick={() => {
                const now = new Date();
                const y = now.getFullYear();
                const m = String(now.getMonth() + 1).padStart(2, '0');
                const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
                const s = `${y}-${m}-01`;
                const e = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
                setStartDate(s); setEndDate(e);
                
              }}
              className="px-3 py-2.5 bg-white border border-gray-200 shadow-sm rounded-xl hover:bg-gray-50 text-sm font-medium text-gray-700"
            >
              This Month
            </button>
            <button
              onClick={loadAlerts}
              className="px-4 py-2.5 bg-white border border-gray-200 shadow-sm rounded-xl hover:bg-gray-50 text-sm font-medium text-gray-700 flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              Refresh
            </button>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-12 text-center border border-gray-100 shadow-sm">
          <Bell size={48} className="text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 mb-2">No Targets Found for Selected Period</h3>
          <p className="text-gray-500">
            No revenue targets overlap with the selected date range. Try adjusting the dates or set up new targets on the{' '}
            <a href="/targets" className="text-green-600 hover:underline">Revenue Targets</a>{' '}
            page.
          </p>
        </div>
      </div>
    );
  }

  const { services, summary } = data;

  const filteredServices = services.filter(s => {
    if (filter === 'all') return true;
    if (filter === 'critical') return s.overall_alert_level === 'red';
    if (filter === 'warning') return s.overall_alert_level === 'orange' || s.overall_alert_level === 'yellow';
    if (filter === 'on_track') return s.overall_alert_level === 'green';
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/25 flex items-center justify-center">
              <Bell size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Revenue Alerts</h1>
              <p className="text-gray-500 text-sm">Real-time expected vs actual revenue monitoring</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 bg-white border border-gray-200 shadow-sm rounded-xl px-3 py-2">
            <Calendar size={14} className="text-emerald-500" />
            <label className="text-xs font-medium text-gray-500">Start:</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="text-sm border-0 outline-none text-gray-700 bg-transparent"
            />
            <span className="text-gray-300 mx-1">—</span>
            <label className="text-xs font-medium text-gray-500">End:</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="text-sm border-0 outline-none text-gray-700 bg-transparent"
            />
          </div>
          <button
            onClick={() => {
              const now = new Date();
              const y = now.getFullYear();
              const m = String(now.getMonth() + 1).padStart(2, '0');
              const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
              const s = `${y}-${m}-01`;
              const e = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
              setStartDate(s); setEndDate(e);
              
            }}
            className="px-3 py-2.5 bg-white border border-gray-200 shadow-sm rounded-xl hover:bg-gray-50 text-sm font-medium text-gray-700"
          >
            This Month
          </button>
          <button
            onClick={() => setShowInfoPanel(!showInfoPanel)}
            className={`px-3 py-2.5 rounded-xl text-sm font-medium flex items-center gap-1.5 transition ${
              showInfoPanel ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/25' : 'bg-white border border-gray-200 shadow-sm text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Info size={16} /> Alert Guide
          </button>
          <button
            onClick={loadAlerts}
            className="px-4 py-2.5 bg-white border border-gray-200 shadow-sm rounded-xl hover:bg-gray-50 text-sm font-medium text-gray-700 flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Alert Guide Panel */}
      {showInfoPanel && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
          <h3 className="font-semibold text-green-900 mb-3 flex items-center gap-2">
            <Info size={18} /> Understanding Alert Levels
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Object.entries(alertTips).filter(([k]) => k !== 'none').map(([level, tip]) => {
              const cfg = alertColors[level];
              const Icon = cfg.icon;
              return (
                <div key={level} className={`flex items-start gap-3 p-3 rounded-lg ${cfg.bg} border ${cfg.border}`}>
                  <Icon size={20} className={cfg.text} style={{ marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <p className={`text-sm font-semibold ${cfg.text}`}>{tip.title}</p>
                    <p className="text-xs text-gray-600 mt-0.5">{tip.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 p-3 bg-white rounded-lg border border-gray-200">
            <p className="text-sm text-gray-700">
              <strong className="text-gray-800">Two Flags per Service:</strong>{' '}
              Each service shows <strong>two alert flags</strong> —{' '}
              <span className="inline-flex items-center gap-1"><Clock size={12} className="text-green-500" /><strong>Current Period</strong></span> shows performance for the most recent month, while{' '}
              <span className="inline-flex items-center gap-1"><TrendingUp size={12} className="text-purple-500" /><strong>Overall</strong></span> shows the total achievement across the full target period.
            </p>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          title="Total Services"
          value={summary.total_services}
          subtitle="under monitoring"
          icon={BarChart3}
          gradient="from-blue-500 to-indigo-600"
          ring="ring-blue-100"
          valueColor="text-blue-600"
        />
        <SummaryCard
          title="Total Target"
          value={formatETB(summary.total_target)}
          subtitle={`${formatETB(summary.total_actual)} collected`}
          icon={Target}
          gradient="from-violet-500 to-purple-600"
          ring="ring-violet-100"
          valueColor="text-violet-600"
        />
        <SummaryCard
          title="Critical"
          value={summary.critical}
          subtitle="services need action"
          icon={XCircle}
          gradient="from-rose-500 to-red-600"
          ring="ring-rose-100"
          valueColor="text-rose-600"
          pulse={summary.critical > 0}
        />
        <SummaryCard
          title="On Track"
          value={summary.on_track}
          subtitle="meeting expectations"
          icon={CheckCircle2}
          gradient="from-emerald-500 to-teal-600"
          ring="ring-emerald-100"
          valueColor="text-emerald-600"
        />
      </div>

      {/* Achievement overview band */}
      <div className="bg-gradient-to-br from-[#b5ecd0] via-[#9fe4c2] to-[#c6f2dc] border border-emerald-200/60 rounded-2xl p-6 text-emerald-950 relative overflow-hidden shadow-sm">
        <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full bg-white/40 blur-2xl" />
        <div className="absolute -bottom-16 -left-10 w-56 h-56 rounded-full bg-white/30 blur-2xl" />
        <div className="relative flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-600" />
              </span>
              <h3 className="text-sm font-bold text-emerald-800 uppercase tracking-wider">Overall Target Achievement</h3>
            </div>
            <p className="text-5xl font-extrabold tracking-tight text-emerald-900">{summary.overall_achievement_pct}<span className="text-2xl text-emerald-600">%</span></p>
            <p className="text-sm text-emerald-700 mt-2">
              <span className="font-bold text-emerald-900">{formatETB(summary.total_actual)}</span> collected of{' '}
              <span className="font-bold text-emerald-900">{formatETB(summary.total_target)}</span> target
            </p>
          </div>
          <div className="w-full max-w-sm">
            <div className="w-full bg-white/70 rounded-full h-3.5 overflow-hidden">
              <div
                className={`h-full rounded-full bg-gradient-to-r transition-all duration-1000 ${
                  parseFloat(summary.overall_achievement_pct) >= 90 ? 'from-emerald-500 to-teal-400'
                    : parseFloat(summary.overall_achievement_pct) >= 70 ? 'from-lime-500 to-yellow-400'
                    : parseFloat(summary.overall_achievement_pct) >= 50 ? 'from-amber-400 to-orange-400'
                    : 'from-rose-500 to-red-400'
                }`}
                style={{ width: `${Math.min(100, Math.max(4, parseFloat(summary.overall_achievement_pct)))}%` }}
              />
            </div>
            <div className="flex justify-between mt-2 text-xs text-emerald-700">
              <span>{formatETB(summary.total_target - summary.total_actual)} remaining</span>
              <span>Target: 100%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl p-1 shadow-sm">
          {[
            { key: 'all', label: `All`, count: services.length, dot: 'bg-gray-400' },
            { key: 'critical', label: `Critical`, count: summary.critical, dot: 'bg-rose-500' },
            { key: 'warning', label: `Warning`, count: summary.warning, dot: 'bg-amber-400' },
            { key: 'on_track', label: `On Track`, count: summary.on_track, dot: 'bg-emerald-500' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                filter === tab.key
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${tab.dot} ${filter === tab.key ? 'ring-2 ring-white/40' : ''}`} />
              {tab.label}
              <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                filter === tab.key ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
              }`}>{tab.count}</span>
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-400 ml-auto hidden md:block">Showing {filteredServices.length} of {services.length} services</span>
      </div>

      {/* Service Alert Cards */}
      <div className="space-y-4">
        {filteredServices.map(service => (
          <ServiceAlertCard
            key={service.target_id}
            service={service}
            expanded={expandedService === service.target_id}
            onToggle={() => setExpandedService(expandedService === service.target_id ? null : service.target_id)}
            onFeedback={() => openFeedback(service.service_name)}
            feedbackCount={getFeedbackCount(service.service_name)}
          />
        ))}
      </div>

      {/* Feedback Modal */}
      {feedbackModal && (
        <div className="fixed inset-0 z-50 bg-emerald-950/60 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="relative flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-500 overflow-hidden">
              <div className="absolute -top-8 -right-6 w-32 h-32 rounded-full bg-white/10 blur-xl" />
              <div className="relative flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-white/15 backdrop-blur border border-white/20 flex items-center justify-center shadow-md">
                  <MessageSquare size={21} className="text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-white text-lg leading-tight">Staff Feedback</h3>
                    <span className="px-2 py-0.5 rounded-full bg-white/20 text-[10px] font-bold text-white uppercase tracking-wide">
                      {feedbackModal.feedbacks.length} {feedbackModal.feedbacks.length === 1 ? 'post' : 'posts'}
                    </span>
                  </div>
                  <p className="text-xs text-emerald-100 mt-0.5">
                    Insights & recommendations on <span className="font-semibold text-white">{feedbackModal.serviceName}</span> revenue alert
                  </p>
                </div>
              </div>
              <button onClick={() => setFeedbackModal(null)} className="relative p-2 hover:bg-white/20 rounded-lg transition text-white/80 hover:text-white">
                <XCircle size={20} />
              </button>
            </div>

            {/* Add new feedback */}
            <div className="px-5 py-4 border-b bg-slate-50/90">
              {!feedbackModal.showNew ? (
                <button
                  onClick={() => setFeedbackModal(prev => ({ ...prev, showNew: true }))}
                  className="w-full flex items-center gap-3 bg-white border-2 border-dashed border-gray-200 hover:border-emerald-400 hover:shadow-sm rounded-2xl px-4 py-3.5 text-sm text-gray-400 hover:text-emerald-600 transition-all group"
                >
                  {user?.avatar_url ? (
                    <img src={user.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0 border border-gray-200" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-xs font-bold">{(user?.full_name || 'U')[0]}</span>
                    </div>
                  )}
                  <span className="flex-1 text-left">Share your feedback or insight about this alert...</span>
                  <span className="px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-600 text-xs font-semibold opacity-0 group-hover:opacity-100 transition">Write</span>
                </button>
              ) : (
                <div className="flex gap-3">
                  {user?.avatar_url ? (
                    <img src={user.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0 border border-gray-200" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-sm font-bold">{(user?.full_name || 'U')[0]}</span>
                    </div>
                  )}
                  <div className="flex-1 space-y-2">
                    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden focus-within:ring-2 focus-within:ring-emerald-500/40 transition">
                      <textarea
                        placeholder={`What's your feedback on ${feedbackModal.serviceName}?`}
                        value={newFeedback.feedback}
                        onChange={(e) => setNewFeedback(prev => ({ ...prev, feedback: e.target.value }))}
                        className="w-full border-0 outline-none px-4 py-3 text-sm resize-none bg-transparent"
                        rows={2}
                        autoFocus
                      />
                      <div className="flex items-center gap-2 px-4 pb-2.5">
                        <span className="text-[10px] font-bold text-gray-300 uppercase tracking-wide">Insight</span>
                        <input
                          type="text"
                          placeholder="Add an insight or recommendation..."
                          value={newFeedback.insight}
                          onChange={(e) => setNewFeedback(prev => ({ ...prev, insight: e.target.value }))}
                          className="flex-1 border-0 outline-none text-xs bg-transparent text-gray-600"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] text-gray-400">Posting as <span className="font-semibold text-gray-600">{user?.full_name || 'Staff'}</span></p>
                      <div className="flex gap-2">
                        <button onClick={() => setFeedbackModal(prev => ({ ...prev, showNew: false }))}
                          className="px-3.5 py-2 rounded-xl text-xs font-medium text-gray-500 hover:bg-gray-100 transition">
                          Cancel
                        </button>
                        <button onClick={submitFeedback}
                          disabled={!newFeedback.feedback.trim()}
                          className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-xl text-xs font-semibold transition shadow-sm">
                          <Send size={12} /> Share Feedback
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Feedback feed */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-gray-50/60">
              {feedbackModal.feedbacks.length === 0 ? (
                <div className="text-center py-14">
                  <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center mx-auto mb-3">
                    <MessageSquare size={28} className="text-emerald-500" />
                  </div>
                  <p className="text-gray-500 text-sm font-semibold">No staff feedback yet</p>
                  <p className="text-gray-400 text-xs mt-1">Be the first to share insights about this revenue alert!</p>
                </div>
              ) : (
                feedbackModal.feedbacks.map(fb => (
                  <div key={fb.id} className="group bg-white border border-gray-100 rounded-2xl p-4 shadow-sm transition hover:shadow-md">
                    <div className="flex gap-3">
                      {/* Avatar */}
                      {fb.author_avatar ? (
                        <img src={fb.author_avatar} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0 border border-gray-100" />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
                          <span className="text-white text-xs font-bold">{(fb.author_name || 'A')[0]}</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        {/* Author + time */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-gray-900">{fb.author_name || 'Anonymous'}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${
                            fb.status === 'resolved' ? 'bg-emerald-100 text-emerald-700' :
                            fb.status === 'reviewed' ? 'bg-blue-100 text-blue-700' : 'bg-sky-100 text-sky-700'
                          }`}>{fb.status}</span>
                          <span className="text-xs text-gray-400 ml-auto">{timeAgo(fb.created_at)}</span>
                          <button onClick={() => deleteFeedback(fb.id)} className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-50 rounded-lg transition">
                            <Trash2 size={13} className="text-gray-300 hover:text-red-500" />
                          </button>
                        </div>
                        {/* Content */}
                        <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap leading-relaxed">{fb.feedback}</p>
                        {fb.insight && (
                          <div className="mt-3 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-100 rounded-xl px-3.5 py-2.5 border-l-4 border-l-amber-400">
                            <p className="text-[10px] text-amber-600 font-bold uppercase tracking-wider mb-0.5">💡 Insight</p>
                            <p className="text-xs text-amber-800 whitespace-pre-wrap">{fb.insight}</p>
                          </div>
                        )}
                        {/* Reactions + Reply toggle */}
                        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                          {reactionTypes.map(r => {
                            const isActive = myReactions[fb.id] === r.type;
                            const typeCount = (fb.reaction_types && fb.reaction_types[r.type]) || 0;
                            return (
                              <button key={r.type}
                                onClick={() => handleReaction(fb.id, r.type)}
                                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-all border ${
                                  isActive ? 'bg-emerald-50 border-emerald-300 text-emerald-700 shadow-sm' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50 hover:border-gray-300'
                                }`} title={r.label}>
                                <span className="text-sm leading-none">{r.emoji}</span>
                                {typeCount > 0 && <span className="font-bold">{typeCount}</span>}
                                <span className="text-[10px] font-medium opacity-70 hidden sm:inline">{r.label}</span>
                              </button>
                            );
                          })}
                          <span className="w-px h-4 bg-gray-200 mx-1" />
                          <button
                            onClick={() => setExpandedReplies(prev => ({ ...prev, [fb.id]: !prev[fb.id] }))}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-all border ${
                              expandedReplies[fb.id] ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                            }`}
                          >
                            <MessageSquare size={11} /> {expandedReplies[fb.id] ? 'Hide' : 'Reply'}{fb.reply_count > 0 ? ` (${fb.reply_count})` : ''}
                          </button>
                        </div>
                        {/* Replies section */}
                        {expandedReplies[fb.id] && (
                          <FeedbackReplies feedbackId={fb.id} onReply={handleReply} replyText={replyText[fb.id] || ''} setReplyText={(val) => setReplyText(prev => ({ ...prev, [fb.id]: val }))} />
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ title, value, subtitle, icon: Icon, gradient, ring, valueColor, pulse }) {
  return (
    <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${gradient} opacity-70`} />
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{title}</p>
          <p className={`text-2xl font-extrabold mt-1.5 truncate ${valueColor}`}>{value}</p>
          {subtitle && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{subtitle}</p>}
        </div>
        <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${gradient} shadow-lg flex items-center justify-center shrink-0 ${pulse ? 'animate-pulse' : ''} transition-transform group-hover:scale-110`}>
          <Icon size={20} className="text-white" />
        </div>
      </div>
    </div>
  );
}

function AlertFlagBadge({ type, level, achievementPct, actual, expected, monthLabel }) {
  const cfg = alertColors[level] || alertColors.none;
  const tip = alertTips[level];
  const Icon = cfg.icon;
  const isCurrent = type === 'current';

  return (
    <div className="group relative inline-flex items-center gap-1.5">
      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
        {isCurrent ? <Clock size={12} /> : <TrendingUp size={12} />}
        <span>{isCurrent ? 'Period' : 'Overall'}</span>
        <span className="font-bold">{achievementPct}%</span>
      </div>

      {/* Tooltip */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-50">
        <div className="bg-emerald-900 text-white rounded-lg p-3 shadow-xl">
          <div className="flex items-center gap-2 mb-1.5">
            <Icon size={14} className={cfg.text.replace(cfg.text.split('-')[1], '300')} />
            <span className="font-semibold text-sm">{tip.title}</span>
          </div>
          <p className="text-xs text-gray-300 mb-2">{tip.desc}</p>
          <div className="border-t border-gray-700 pt-2 space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">Expected:</span>
              <span className="font-medium">{formatETB(expected)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">Actual:</span>
              <span className="font-medium">{formatETB(actual)}</span>
            </div>
            {monthLabel && (
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Month:</span>
                <span className="font-medium">{monthLabel}</span>
              </div>
            )}
          </div>
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 bg-emerald-900 rotate-45 -mt-1" />
        </div>
      </div>
    </div>
  );
}

function timeAgo(dateStr) {
  const now = new Date();
  const date = new Date(dateStr);
  const seconds = Math.floor((now - date) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function FeedbackReplies({ feedbackId, onReply, replyText, setReplyText }) {
  const [replies, setReplies] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadReplies();
  }, [feedbackId]);

  async function loadReplies() {
    try {
      const data = await alertFeedbackAPI.getReplies(feedbackId);
      setReplies(data);
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  return (
    <div className="mt-3 ml-2 border-l-2 border-gray-100 pl-4 space-y-3">
      {loading ? <p className="text-xs text-gray-400">Loading replies...</p> : (
        <>
          {replies.length > 0 && (
            <div className="space-y-3">
              {replies.map(r => (
                <div key={r.id} className="flex gap-2.5">
                  {r.author_avatar ? (
                    <img src={r.author_avatar} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0 border border-gray-100" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-[10px] font-bold">{(r.author_name || 'A')[0]}</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-800">{r.author_name || 'Anonymous'}</span>
                      <span className="text-[10px] text-gray-400">{timeAgo(r.created_at)}</span>
                    </div>
                    <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap leading-relaxed">{r.reply}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 items-center bg-white border border-gray-200 rounded-xl pl-3 pr-1.5 py-1.5 focus-within:ring-2 focus-within:ring-emerald-500/30 transition shadow-sm">
            <input
              type="text"
              placeholder="Write a reply..."
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onReply(feedbackId); } }}
              className="flex-1 border-0 outline-none text-xs bg-transparent"
            />
            <button onClick={() => onReply(feedbackId)}
              className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm inline-flex items-center gap-1">
              <Send size={11} /> Reply
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ServiceAlertCard({ service, expanded, onToggle, onFeedback, feedbackCount }) {
  // Card severity/accent follows the OVERALL achievement of the full target window,
  // so a service that is beyond target is never shown as critical.
  const level = ['red', 'orange', 'yellow', 'green'].includes(service.overall_alert_level)
    ? service.overall_alert_level : 'none';
  const overallCfg = alertColors[level] || alertColors.none;
  const OverallIcon = overallCfg.icon;
  const statusLabel = {
    red: 'Critical', orange: 'Behind Target', yellow: 'Slightly Behind', green: 'On Track', none: 'No Data',
  }[level] || 'No Data';
  const statusPillCls = {
    red: 'bg-rose-50 text-rose-700 border-rose-200',
    orange: 'bg-orange-50 text-orange-700 border-orange-200',
    yellow: 'bg-amber-50 text-amber-700 border-amber-200',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    none: 'bg-gray-50 text-gray-500 border-gray-200',
  }[level] || 'bg-gray-50 text-gray-500 border-gray-200';
  const statusDot = {
    red: 'bg-rose-500',
    orange: 'bg-orange-400',
    yellow: 'bg-amber-400',
    green: 'bg-emerald-500',
    none: 'bg-gray-300',
  }[level] || 'bg-gray-300';

  const statusChipCls = {
    red: 'bg-rose-50 text-rose-600 border-rose-100',
    orange: 'bg-orange-50 text-orange-600 border-orange-100',
    yellow: 'bg-amber-50 text-amber-600 border-amber-100',
    green: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    none: 'bg-gray-50 text-gray-400 border-gray-100',
  }[level] || 'bg-gray-50 text-gray-400 border-gray-100';

  const accentSolid = {
    red: 'bg-rose-500',
    orange: 'bg-orange-400',
    yellow: 'bg-amber-400',
    green: 'bg-emerald-500',
    none: 'bg-gray-300',
  }[level] || 'bg-gray-300';

  const currentPctCls = (alertColors[service.current_alert_level] || alertColors.none).text;
  const overallPctCls = overallCfg.text;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden transition-all duration-300 hover:shadow-lg hover:border-gray-200 relative">
      {/* Left accent bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${accentSolid}`} />
      {/* Header - clickable */}
      <div
        onClick={onToggle}
        className="w-full pl-5 pr-4 py-4 text-left hover:bg-gray-50/60 transition cursor-pointer"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggle(); }}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            {/* Status chip */}
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border ${statusChipCls}`}>
              <OverallIcon size={18} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-gray-900 text-[15px] truncate">{service.service_name}</h3>
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusPillCls}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
                  {statusLabel}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {service.period_type.charAt(0).toUpperCase() + service.period_type.slice(1)} target ·{' '}
                {service.months_count} month{service.months_count > 1 ? 's' : ''} ·{' '}
                Expected <span className="font-semibold text-gray-700">{formatETB(service.monthly_expected)}</span>/month
              </p>
              {/* Period target & actual for the selected date range */}
              <div className="flex items-center gap-2 mt-1.5 text-[11px]">
                <span className="text-gray-400">
                  Target <span className="font-bold text-gray-700">{formatETB(service.total_target)}</span>
                </span>
                <span className="w-px h-3 bg-gray-200" />
                <span className="text-gray-400">
                  Actual <span className="font-bold text-gray-700">{formatETB(service.total_actual)}</span>
                </span>
                <span className="w-px h-3 bg-gray-200" />
                <span className="text-gray-400">
                  Variance <span className={`font-bold ${service.overall_variance >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{formatETB(Math.abs(service.overall_variance))}</span>
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1.5 text-[11px]">
                <span className="text-gray-400">
                  Period <span className={`font-bold ${currentPctCls}`}>{service.current_achievement_pct}%</span>
                </span>
                <span className="w-px h-3 bg-gray-200" />
                <span className="text-gray-400">
                  Overall <span className={`font-bold ${overallPctCls}`}>{service.overall_achievement_pct}%</span>
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {/* Variance */}
            <div className="text-right hidden md:block mr-1">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">Variance</p>
              <p className={`text-sm font-bold ${service.overall_variance >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {service.overall_variance >= 0 ? <ArrowUpRight size={13} className="inline" /> : <ArrowDownRight size={13} className="inline" />}
                {formatETB(Math.abs(service.overall_variance))}
              </p>
            </div>

            {/* Feedback button */}
            <button
              onClick={(e) => { e.stopPropagation(); onFeedback(); }}
              className="relative flex items-center justify-center w-9 h-9 rounded-lg border border-gray-200 text-gray-400 hover:border-emerald-300 hover:text-emerald-600 hover:bg-emerald-50 transition-all"
              title="Feedback & Insights"
            >
              <MessageSquare size={15} />
              {feedbackCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-emerald-500 text-white text-[10px] font-bold rounded-full min-w-[1.1rem] h-4 px-0.5 flex items-center justify-center shadow">
                  {feedbackCount}
                </span>
              )}
            </button>

            {/* Expand chevron */}
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${expanded ? 'bg-emerald-600 text-white rotate-180' : 'text-gray-400 hover:bg-gray-100'}`}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Expanded monthly breakdown */}
      {expanded && (
        <div className="border-t border-gray-100 bg-gradient-to-b from-slate-50 to-white px-6 py-5 pl-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
              <Calendar size={15} className="text-white" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-gray-800">Monthly Breakdown</h4>
              <p className="text-[11px] text-gray-400">{service.period_type.charAt(0).toUpperCase() + service.period_type.slice(1)} target period · click a month badge for details</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {service.monthly_breakdown.map(month => {
              const mc = alertColors[month.alert_level] || alertColors.none;
              const MonthIcon = mc.icon;
              const isCurrentMonth = month.month_label === service.current_month;
              const monthBarGrad = {
                red: 'from-rose-500 to-red-500',
                orange: 'from-orange-400 to-amber-500',
                yellow: 'from-amber-400 to-yellow-500',
                green: 'from-emerald-500 to-teal-500',
                gray: 'from-gray-300 to-gray-400',
              }[month.alert_level] || 'from-gray-300 to-gray-400';
              return (
                <div
                  key={month.month}
                  className={`rounded-xl p-4 bg-white border shadow-sm overflow-hidden relative ${
                    isCurrentMonth ? 'ring-2 ring-emerald-500 shadow-lg' : mc.border || 'border-gray-200'
                  }`}
                >
                  <div className={`absolute inset-x-0 top-0 h-1 ${mc.dot}`} />
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
                      {month.month_label}
                      {month.is_future && (
                        <span className="px-1.5 py-0.5 bg-gray-200 text-gray-500 rounded text-[9px] font-bold uppercase tracking-wider">Upcoming</span>
                      )}
                      {isCurrentMonth && (
                        <span className="px-1.5 py-0.5 bg-emerald-600 text-white rounded text-[9px] font-bold uppercase tracking-wider">Now</span>
                      )}
                    </span>
                    <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${mc.bg}`}>
                      <MonthIcon size={13} className={mc.text} />
                    </span>
                  </div>

                  <div className="flex items-end justify-between mb-3">
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide">Achieved</p>
                      <p className={`text-xl font-extrabold ${mc.text}`}>{month.is_future ? '—' : `${month.achievement_pct}%`}</p>
                    </div>
                    <span className="text-[10px] text-gray-400">
                      {formatETB(month.actual)} / {formatETB(month.expected)}
                    </span>
                  </div>

                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-gray-400">Expected</span>
                    <span className="font-medium text-gray-600">{formatETB(month.expected)}</span>
                  </div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-gray-400">Actual</span>
                    <span className="font-semibold text-gray-800">{formatETB(month.actual)}</span>
                  </div>
                  <div className="flex justify-between text-xs mb-2">
                    <span className="text-gray-400">Variance</span>
                    <span className={`font-semibold inline-flex items-center gap-0.5 ${month.variance >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {month.variance >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                      {formatETB(Math.abs(month.variance))}
                    </span>
                  </div>

                  {/* Mini bar */}
                  <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r transition-all duration-700 ${monthBarGrad}`}
                      style={{ width: `${Math.min(100, month.achievement_pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Variance Chart */}
          <div className="mt-5 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                <BarChart3 size={15} className="text-white" />
              </div>
              <div>
                <h5 className="text-sm font-bold text-gray-800">Monthly Variance Analysis</h5>
                <p className="text-[11px] text-gray-400">Expected vs actual vs variance across the period</p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={service.monthly_breakdown.reduce((acc, m, i) => {
                const prev = i > 0 ? acc[i - 1] : null;
                acc.push({
                  ...m,
                  // Straight overall target line (same value every month)
                  target_line: service.total_target || 0,
                  cum_actual: (prev ? prev.cum_actual : 0) + (m.actual || 0),
                });
                return acc;
              }, [])} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month_label" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" height={50} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1e9 ? `${(v/1e9).toFixed(1)}B` : v >= 1e6 ? `${(v/1e6).toFixed(0)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : v} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1e9 ? `${(v/1e9).toFixed(1)}B` : v >= 1e6 ? `${(v/1e6).toFixed(0)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : v} />
                <Tooltip formatter={(value, name) => name === 'Overall Target' || name === 'Cumulative Actual' ? `${name}: ${formatETB(value)}` : formatETB(value)} labelStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0} yAxisId="left" stroke="#999" strokeDasharray="3 3" />
                <Bar yAxisId="left" dataKey="expected" name="Expected" fill="#e5e7eb" radius={[2,2,0,0]} barSize={18} />
                <Bar yAxisId="left" dataKey="actual" name="Actual" radius={[2,2,0,0]} barSize={18}>
                  {service.monthly_breakdown.map((entry, idx) => (
                    <Cell key={idx} fill={entry.variance >= 0 ? '#10b981' : '#ef4444'} />
                  ))}
                </Bar>
                <Line yAxisId="left" type="monotone" dataKey="variance" name="Variance" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4, fill: '#f59e0b' }} />
                <Line yAxisId="right" type="monotone" dataKey="target_line" name="Overall Target" stroke="#8b5cf6" strokeWidth={2.5} dot={false} strokeDasharray="6 3" />
                <Line yAxisId="right" type="monotone" dataKey="cum_actual" name="Cumulative Actual" stroke="#06b6d4" strokeWidth={2.5} dot={{ r: 3.5, fill: '#06b6d4' }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Month summary strip */}
          <div className="flex items-center gap-3 mt-5 flex-wrap bg-emerald-700 rounded-2xl px-4 py-3">
            <span className="text-[11px] font-semibold text-emerald-100 uppercase tracking-wider mr-1">Period summary</span>
            {service.alert_counts.green > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                {service.alert_counts.green} on track
              </span>
            )}
            {service.alert_counts.yellow > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                {service.alert_counts.yellow} slightly behind
              </span>
            )}
            {service.alert_counts.orange > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-orange-500/15 text-orange-300 border border-orange-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                {service.alert_counts.orange} behind
              </span>
            )}
            {service.alert_counts.red > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                {service.alert_counts.red} critical
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
