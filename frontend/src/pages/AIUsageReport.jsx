import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import { Brain, Users, Activity, AlertTriangle, TrendingUp, Calendar, BarChart3, Crown, Key } from 'lucide-react';
import { aiUsageAPI } from '../services/api';
import toast from 'react-hot-toast';

const COLORS = ['#16a34a', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1'];

export default function AIUsageReport() {
  const [report, setReport] = useState(null);
  const [apiKeys, setApiKeys] = useState(null);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('vas_date_filters') || '{}');
      if (stored.ai_start) return stored.ai_start;
    } catch {}
    const d = new Date(); d.setDate(d.getDate() - 30);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [endDate, setEndDate] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('vas_date_filters') || '{}');
      if (stored.ai_end) return stored.ai_end;
    } catch {}
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  useEffect(() => { loadReport(); }, [startDate, endDate]);
  useEffect(() => {
    const interval = setInterval(loadApiKeys, 5000); // refresh every 5s
    loadApiKeys();
    return () => clearInterval(interval);
  }, []);

  async function loadApiKeys() {
    try {
      const data = await aiUsageAPI.getApiKeys();
      setApiKeys(data);
    } catch (err) {
      // silently fail
    }
  }

  async function loadReport() {
    setLoading(true);
    try {
      const data = await aiUsageAPI.getReport({ start_date: startDate, end_date: endDate });
      setReport(data);
    } catch (err) {
      toast.error('Failed to load usage report');
    }
    setLoading(false);
  }

  function fmtNum(n) { return Number(n || 0).toLocaleString(); }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Brain className="text-purple-600" size={28} />
            AI Usage Report
          </h1>
          <p className="text-sm text-gray-500">Gemini AI assistant quota usage across all users</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">From:</span>
          <input type="date" value={startDate} onChange={e => {
            setStartDate(e.target.value);
            try {
              const stored = JSON.parse(localStorage.getItem('vas_date_filters') || '{}');
              stored.ai_start = e.target.value;
              localStorage.setItem('vas_date_filters', JSON.stringify(stored));
            } catch {}
          }} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          <span className="text-xs text-gray-500">To:</span>
          <input type="date" value={endDate} onChange={e => {
            setEndDate(e.target.value);
            try {
              const stored = JSON.parse(localStorage.getItem('vas_date_filters') || '{}');
              stored.ai_end = e.target.value;
              localStorage.setItem('vas_date_filters', JSON.stringify(stored));
            } catch {}
          }} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading usage report...</div>
      ) : report && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <SummaryCard icon={Brain} label="Total Questions" value={fmtNum(report.summary.total_questions)} color="bg-purple-500" />
            <SummaryCard icon={Users} label="Active Users" value={`${report.summary.total_active_users}/${report.summary.total_users}`} color="bg-blue-500" />
            <SummaryCard icon={Activity} label="Avg per User" value={fmtNum(report.summary.avg_per_active_user)} color="bg-green-500" />
            <SummaryCard icon={TrendingUp} label="Peak Daily Total" value={fmtNum(report.summary.peak_daily_total)} color="bg-amber-500" />
            <SummaryCard icon={Calendar} label="Peak Day" value={report.summary.peak_day ? new Date(report.summary.peak_day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'} color="bg-cyan-500" small />
            <SummaryCard icon={AlertTriangle} label="Quota Exhausted" value={`${report.exhaustions?.length || 0} users`} color="bg-red-500" />
          </div>

          {/* API Key Status */}
          {apiKeys && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <Key size={14} /> API Key Pool Status
                <span className="text-xs font-normal text-gray-400">(auto-refreshes every 5s)</span>
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {apiKeys.keys.map((k) => (
                  <div
                    key={k.key_index}
                    className={`rounded-xl border p-4 transition-all duration-300 ${
                      k.status === 'active' ? 'border-green-300 bg-green-50 shadow-md shadow-green-100' :
                      k.status === 'rate_limited' ? 'border-red-300 bg-red-50' :
                      'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Key #{k.key_index}</span>
                      <span className={`w-2.5 h-2.5 rounded-full ${
                        k.status === 'active' ? 'bg-green-500 animate-pulse' :
                        k.status === 'rate_limited' ? 'bg-red-500' :
                        'bg-gray-400'
                      }`} />
                    </div>
                    <p className="text-xs font-mono text-gray-700 mb-2 bg-white/60 rounded px-2 py-1">{k.masked_key}</p>
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${
                      k.status === 'active' ? 'bg-green-200 text-green-800' :
                      k.status === 'rate_limited' ? 'bg-red-200 text-red-800' :
                      'bg-gray-200 text-gray-600'
                    }`}>
                      {k.status === 'active' ? '⚡ ACTIVE' : k.status === 'rate_limited' ? `⏳ ${k.cooldown_remaining_sec}s` : '💤 STANDBY'}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-4 mt-4 text-xs text-gray-500">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Active = Currently handling requests</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Rate Limited = Cooldown period</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-400" /> Standby = Ready to rotate in</span>
              </div>
            </div>
          )}

          {/* Daily Trend + Top Users pie chart */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Daily Usage Trend */}
            <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <Activity size={14} /> Daily Usage Trend
              </h3>
              {report.daily_trend.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={report.daily_trend} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => { if (!d) return ''; const parts = d.split('T')[0].split('-'); return `${parts[1]}/${parts[2]}`; }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-3">
                            <p className="text-xs font-bold text-gray-700 mb-1">{label}</p>
                            <p className="text-sm text-gray-600">Questions: <span className="font-bold">{fmtNum(payload[0]?.value)}</span></p>
                            <p className="text-sm text-gray-600">Active Users: <span className="font-bold">{payload[0]?.payload?.active_users || 0}</span></p>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="questions" name="Questions" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-center text-gray-400 py-8">No usage data for this period</p>
              )}
            </div>

            {/* Top Users Pie */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <Crown size={14} /> Top Users
              </h3>
              {report.top_users.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={report.top_users.slice(0, 6)} dataKey="total" nameKey="name"
                        cx="50%" cy="50%" outerRadius={80} innerRadius={40} paddingAngle={2}>
                        {report.top_users.slice(0, 6).map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => fmtNum(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1.5 mt-2">
                    {report.top_users.slice(0, 5).map((u, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i] }} />
                          <span className="text-gray-600 truncate max-w-[120px]">{u.name}</span>
                        </div>
                        <span className="font-semibold text-gray-800">{fmtNum(u.total)}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-center text-gray-400 py-8">No usage data</p>
              )}
            </div>
          </div>

          {/* User Detail Table */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6 pb-3">
              <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Users size={14} /> User Usage Details
              </h3>
              <p className="text-xs text-gray-400 mt-1">Per-user breakdown of AI assistant usage</p>
            </div>
            <div className="overflow-x-auto px-6 pb-6">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left py-3 px-3 font-semibold text-gray-600">User</th>
                    <th className="text-center py-3 px-3 font-semibold text-gray-600">Daily Limit</th>
                    <th className="text-center py-3 px-3 font-semibold text-gray-600">Total Questions</th>
                    <th className="text-center py-3 px-3 font-semibold text-gray-600">Active Days</th>
                    <th className="text-center py-3 px-3 font-semibold text-gray-600">Avg/Day</th>
                    <th className="text-center py-3 px-3 font-semibold text-gray-600">Peak Day</th>
                    <th className="text-center py-3 px-3 font-semibold text-gray-600">Usage Rate</th>
                    <th className="text-center py-3 px-3 font-semibold text-gray-600">First / Last</th>
                  </tr>
                </thead>
                <tbody>
                  {report.user_usage.length > 0 ? report.user_usage.map((u) => {
                    const avgPct = u.daily_limit > 0 ? Math.round((u.avg_per_day / u.daily_limit) * 100) : 0;
                    return (
                      <tr key={u.user_id} className="border-t border-gray-50 hover:bg-gray-50">
                        <td className="py-3 px-3">
                          <div className="font-medium text-gray-900">{u.full_name}</div>
                          <div className="text-xs text-gray-400">{u.email}</div>
                        </td>
                        <td className="text-center py-3 px-3">
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">{u.daily_limit}/day</span>
                        </td>
                        <td className="text-center py-3 px-3 font-semibold text-gray-900">{fmtNum(u.total_questions)}</td>
                        <td className="text-center py-3 px-3 text-gray-600">{u.active_days}</td>
                        <td className="text-center py-3 px-3 font-medium text-gray-700">{u.avg_per_day}</td>
                        <td className="text-center py-3 px-3">
                          <span className={`font-medium ${u.peak_daily >= u.daily_limit ? 'text-red-600' : 'text-gray-700'}`}>
                            {fmtNum(u.peak_daily)}
                          </span>
                        </td>
                        <td className="text-center py-3 px-3">
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-16 bg-gray-200 rounded-full h-2">
                              <div
                                className={`h-2 rounded-full ${avgPct >= 90 ? 'bg-red-500' : avgPct >= 60 ? 'bg-amber-500' : 'bg-green-500'}`}
                                style={{ width: `${Math.min(avgPct, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs font-medium text-gray-600 w-8">{avgPct}%</span>
                          </div>
                        </td>
                        <td className="text-center py-3 px-3 text-xs text-gray-500">
                          {u.first_usage ? new Date(u.first_usage).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                          {' → '}
                          {u.last_usage ? new Date(u.last_usage).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                        </td>
                      </tr>
                    );
                  }) : (
                    <tr><td colSpan={8} className="text-center py-8 text-gray-400">No users have used the AI assistant yet</td></tr>
                  )}
                </tbody>
                {report.user_usage.length > 0 && (
                  <tfoot className="bg-gray-50 font-semibold">
                    <tr>
                      <td className="py-3 px-3 text-gray-700">Total</td>
                      <td className="text-center py-3 px-3">—</td>
                      <td className="text-center py-3 px-3 text-gray-900">{fmtNum(report.user_usage.reduce((s, u) => s + u.total_questions, 0))}</td>
                      <td className="text-center py-3 px-3">—</td>
                      <td className="text-center py-3 px-3">
                        {report.user_usage.filter(u => u.active_days > 0).length > 0
                          ? Math.round(report.user_usage.reduce((s, u) => s + u.avg_per_day, 0) / report.user_usage.filter(u => u.active_days > 0).length)
                          : 0}
                      </td>
                      <td className="text-center py-3 px-3">{fmtNum(Math.max(...report.user_usage.map(u => u.peak_daily)))}</td>
                      <td className="text-center py-3 px-3">—</td>
                      <td className="text-center py-3 px-3">—</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Quota Exhaustion Alerts */}
          {report.exhaustions?.length > 0 && (
            <div className="bg-red-50 rounded-xl border border-red-200 p-6">
              <h3 className="text-sm font-semibold text-red-700 mb-3 flex items-center gap-2">
                <AlertTriangle size={14} /> Quota Exhaustion Alerts
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {report.exhaustions.map((e, i) => (
                  <div key={i} className="bg-white rounded-lg border border-red-100 p-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{e.full_name}</p>
                      <p className="text-xs text-gray-500">Hit daily limit {e.times_exhausted} time(s)</p>
                    </div>
                    <span className="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-bold">{e.times_exhausted}×</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, color, small }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
      <div className={`w-9 h-9 rounded-lg ${color} flex items-center justify-center mb-3`}>
        <Icon size={18} className="text-white" />
      </div>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</p>
      <p className={`font-bold text-gray-900 mt-1 ${small ? 'text-sm' : 'text-lg'}`}>{value}</p>
    </div>
  );
}
