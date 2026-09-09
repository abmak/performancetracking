import { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, ResponsiveContainer, AreaChart, Area,
  LineChart, Line, ReferenceLine,
} from 'recharts';
import { Target, TrendingUp, AlertTriangle, CheckCircle, Building2, DollarSign, Users, Landmark, Activity, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { dashboardAPI } from '../services/api';
import { formatCurrency, formatPercent, getAchievementColor, getProgressBarColor, getAchievementBg } from '../utils/helpers';
import { useDateFilter } from '../context/DateFilterContext';

const COLORS = ['#16a34a', '#22c55e', '#4ade80', '#86efac', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

export default function Dashboard() {
  const [kpis, setKpis] = useState(null);
  const [achievements, setAchievements] = useState([]);
  const [momGrowth, setMomGrowth] = useState([]);
  const [loading, setLoading] = useState(true);
  // Shared date filter — synced across all modules
  const { startDate, endDate, setStartDate, setEndDate } = useDateFilter();

  // Debounced loader — waits 400ms after the last date change before fetching
  useEffect(() => {
    const t = setTimeout(() => loadData(), 400);
    return () => clearTimeout(t);
  }, [startDate, endDate]);

  async function loadData() {
    setLoading(true);
    try {
      const params = { start_date: startDate, end_date: endDate };
      // Single parallel fetch — no duplicate /partners/dashboard-kpis call
      // (top_partners & category_breakdown come from /dashboard/kpis directly)
      const [kpiData, achieveData, growthData] = await Promise.all([
        dashboardAPI.getKPIs(params),
        dashboardAPI.getServiceAchievements(params),
        dashboardAPI.getMomGrowth(params),
      ]);
      setKpis(kpiData);
      setAchievements(achieveData);
      setMomGrowth(growthData);
    } catch (err) {
      console.error('Dashboard load error:', err);
    }
    setLoading(false);
  }

  if (loading && !kpis) {
    return (
      <div className="space-y-6 animate-pulse">
        {/* KPI Cards skeleton */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <div className="h-3 bg-gray-200 rounded w-20 mb-3"></div>
              <div className="h-8 bg-gray-200 rounded w-28 mb-2"></div>
              <div className="h-2 bg-gray-100 rounded w-16"></div>
            </div>
          ))}
        </div>
        {/* Chart skeleton */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="h-4 bg-gray-200 rounded w-48 mb-4"></div>
          <div className="h-64 bg-gray-100 rounded-lg"></div>
        </div>
        {/* Table skeleton */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="h-4 bg-gray-200 rounded w-40 mb-4"></div>
          {[1,2,3].map(i => (
            <div key={i} className="flex items-center gap-4 py-3 border-b border-gray-50 last:border-0">
              <div className="h-4 bg-gray-200 rounded w-32"></div>
              <div className="h-4 bg-gray-100 rounded w-20 ml-auto"></div>
              <div className="h-4 bg-gray-100 rounded w-20"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const totalActual = parseFloat(kpis?.total_actual || 0);
  const totalTarget = parseFloat(kpis?.total_target || 0);
  const totalEthio = parseFloat(kpis?.total_ethio || 0);
  const partnerShare = totalActual - totalEthio;
  const achievement = totalTarget > 0 ? ((totalActual / totalTarget) * 100).toFixed(1) : 0;
  const remaining = Math.max(0, totalTarget - totalActual);

  const kpiCards = [
    { title: 'Total Revenue', value: formatCurrency(totalActual), icon: DollarSign, color: 'bg-green-500', lightColor: 'bg-green-50 text-green-600' },
    { title: 'Total Target', value: formatCurrency(totalTarget), icon: Target, color: 'bg-purple-500', lightColor: 'bg-purple-50 text-purple-600' },
    { title: 'Achievement', value: totalTarget > 0 ? formatPercent(achievement) : 'No targets', icon: TrendingUp, color: 'bg-cyan-500', lightColor: 'bg-cyan-50 text-cyan-600' },
    { title: 'VAS Services', value: kpis?.active_services || 0, icon: Activity, color: 'bg-indigo-500', lightColor: 'bg-indigo-50 text-indigo-600' },
    { title: 'Partners', value: kpis?.partner_count || 0, icon: Users, color: 'bg-emerald-500', lightColor: 'bg-emerald-50 text-emerald-600' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500">VAS Revenue Performance Overview</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500">Start:</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500">End:</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {kpiCards.map((card, i) => (
          <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">{card.title}</span>
              <div className={`w-8 h-8 rounded-lg ${card.lightColor} flex items-center justify-center`}>
                <card.icon size={16} />
              </div>
            </div>
            <div className="text-lg font-bold text-gray-900 truncate">{card.value}</div>
          </div>
        ))}
      </div>

      {/* Overall Achievement Bar */}
      {totalTarget > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Overall Target Achievement</h3>
          <div className="w-full bg-gray-200 rounded-full h-6 overflow-hidden">
            <div
              className={`h-6 rounded-full flex items-center justify-end pr-3 text-xs font-bold text-white ${getProgressBarColor(achievement)}`}
              style={{ width: `${Math.min(achievement, 100)}%` }}
            >
              {achievement > 10 && `${formatPercent(achievement)}`}
            </div>
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>Revenue: {formatCurrency(totalActual)}</span>
            <span>{formatPercent(achievement)} of Target: {formatCurrency(totalTarget)}</span>
          </div>
        </div>
      )}

      {/* Service Achievement Table */}
      {achievements.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Service Achievement</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 font-semibold text-gray-600">Service</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-600">Target</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-600">Actual</th>
                  <th className="text-center py-2 px-3 font-semibold text-gray-600">Achievement</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-600">Remaining</th>
                  <th className="text-center py-2 px-3 font-semibold text-gray-600">Progress</th>
                </tr>
              </thead>
              <tbody>
                {achievements.map((s, i) => {
                  const pct = parseFloat(s.achievement_pct || 0);
                  return (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-3 px-3">
                        <div className="font-medium text-gray-900">{s.service_name}</div>
                        <div className="text-xs text-gray-500">{s.partner_count} partners</div>
                      </td>
                      <td className="text-right py-3 px-3 text-gray-600">{s.target_amount > 0 ? formatCurrency(s.target_amount) : '—'}</td>
                      <td className="text-right py-3 px-3 font-semibold text-gray-900">{formatCurrency(s.actual_amount)}</td>
                      <td className="text-center py-3 px-3">
                        {s.target_amount > 0 ? (
                          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getAchievementBg(pct)}`}>
                            {formatPercent(pct)}
                          </span>
                        ) : <span className="text-xs text-gray-400">—</span>}
                      </td>
                      <td className="text-right py-3 px-3 text-red-600 text-xs">
                        {s.remaining > 0 ? formatCurrency(s.remaining) : '—'}
                      </td>
                      <td className="py-3 px-3 w-32">
                        {s.target_amount > 0 && (
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div className={`h-2 rounded-full ${getProgressBarColor(pct)}`}
                              style={{ width: `${Math.min(pct, 100)}%` }} />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Service Revenue Distribution & Target vs Actual Charts */}
      {achievements.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Service Contribution to Target Line — ALL services */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Service Revenue Contribution to Target (%)</h3>
            <ResponsiveContainer width="100%" height={350}>
              <LineChart
                data={achievements.map(a => {
                  const actual = parseFloat(a.actual_amount || 0);
                  const contributionPct = totalTarget > 0 ? parseFloat(((actual / totalTarget) * 100).toFixed(2)) : 0;
                  return {
                    name: a.service_name.length > 18 ? a.service_name.substring(0, 18) + '…' : a.service_name,
                    fullName: a.service_name,
                    contribution: contributionPct,
                    achievement: parseFloat(a.achievement_pct || 0),
                    revenue: actual,
                    partners: a.partner_count,
                  };
                })}
                margin={{ top: 5, right: 30, left: 20, bottom: 60 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-30} textAnchor="end" height={80} />
                <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} domain={[0, 'dataMax + 10']} />
                <Tooltip formatter={(v, name, props) => {
                  const d = props.payload;
                  if (name === 'contribution') return [`${d.contribution}% (${formatCurrency(d.revenue)})`, 'Contribution to Target'];
                  return [v, name];
                }} labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName || label} />
                <Legend />
                <Line type="monotone" dataKey="contribution" name="% of Total Target" stroke="#3b82f6" strokeWidth={3} dot={{ r: 5, fill: '#3b82f6' }} activeDot={{ r: 7 }} />
              </LineChart>
            </ResponsiveContainer>
            <div className="mt-2 flex flex-wrap gap-2 justify-center">
              {achievements.map((a, i) => {
                const actual = parseFloat(a.actual_amount || 0);
                const pct = totalTarget > 0 ? ((actual / totalTarget) * 100).toFixed(1) : 0;
                return (
                  <div key={i} className="flex items-center gap-1 text-xs text-gray-600">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="truncate max-w-[100px]">{a.service_name}</span>
                    <span className="text-blue-600 font-semibold">{pct}%</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 text-center text-xs text-gray-400">
              Total Target: {formatCurrency(totalTarget)} | Total Actual: {formatCurrency(totalActual)} | Overall: {achievement}%
            </div>
          </div>

          {/* Target vs Actual — Achievement Progress (Real-Time Style) */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-base font-bold text-gray-800">Target vs Actual by Service</h3>
                <p className="text-xs text-gray-400 mt-0.5">Real-time achievement tracking</p>
              </div>
              <div className="flex items-center gap-1.5 bg-green-50 border border-green-200 rounded-full px-3 py-1">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-[10px] text-green-700 font-semibold uppercase tracking-wider">Live</span>
              </div>
            </div>
            <div className="space-y-5">
              {achievements
                .filter(a => parseFloat(a.target_amount || 0) > 0)
                .map((a, idx) => {
                  const actual = parseFloat(a.actual_amount || 0);
                  const target = parseFloat(a.target_amount || 0);
                  const rawPct = target > 0 ? (actual / target) * 100 : 0;
                  const displayPct = Math.min(rawPct, 100);
                  const remaining = Math.max(0, target - actual);
                  // Color config based on achievement
                  let barGradient, bgColor, textColor, badgeBg, badgeText, statusLabel, statusIcon;
                  if (rawPct >= 90) {
                    barGradient = 'linear-gradient(90deg, #22c55e 0%, #16a34a 60%, #15803d 100%)';
                    bgColor = 'bg-emerald-50'; textColor = 'text-emerald-700';
                    badgeBg = 'bg-emerald-100 border-emerald-200'; badgeText = 'text-emerald-700';
                    statusLabel = 'On Track'; statusIcon = CheckCircle;
                  } else if (rawPct >= 60) {
                    barGradient = 'linear-gradient(90deg, #facc15 0%, #f59e0b 60%, #d97706 100%)';
                    bgColor = 'bg-amber-50'; textColor = 'text-amber-700';
                    badgeBg = 'bg-amber-100 border-amber-200'; badgeText = 'text-amber-700';
                    statusLabel = 'Warning'; statusIcon = AlertTriangle;
                  } else {
                    barGradient = 'linear-gradient(90deg, #f87171 0%, #ef4444 60%, #dc2626 100%)';
                    bgColor = 'bg-red-50'; textColor = 'text-red-700';
                    badgeBg = 'bg-red-100 border-red-200'; badgeText = 'text-red-700';
                    statusLabel = 'Critical'; statusIcon = AlertTriangle;
                  }
                  const StatusIconComp = statusIcon;
                  return (
                    <div key={a.service_name} className="group">
                      {/* Header row */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <StatusIconComp size={14} className={textColor} />
                          <span className="text-sm font-bold text-gray-800">{a.service_name}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${badgeBg} ${badgeText}`}>
                            {rawPct.toFixed(1)}%
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs">
                            <span className="font-bold text-gray-800">{formatCurrency(actual)}</span>
                            <span className="text-gray-400 mx-1">/</span>
                            <span className="text-gray-500">{formatCurrency(target)}</span>
                          </span>
                          {remaining > 0 && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-50 text-red-600 font-semibold border border-red-100">
                              −{formatCurrency(remaining)}
                            </span>
                          )}
                          {rawPct >= 100 && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold border border-emerald-200">
                              ✓ Target Hit
                            </span>
                          )}
                        </div>
                      </div>
                      {/* Progress bar */}
                      <div className="relative h-8 bg-gray-100 rounded-xl overflow-hidden">
                        {/* The actual progress fill */}
                        <div
                          className="absolute inset-y-0 left-0 rounded-xl"
                          style={{ width: `${displayPct}%`, background: barGradient, transition: 'width 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)', boxShadow: `0 0 12px ${rawPct >= 90 ? 'rgba(34,197,94,0.3)' : rawPct >= 60 ? 'rgba(245,158,11,0.3)' : 'rgba(239,68,68,0.3)'}` }}
                        />
                        {/* Shimmer overlay */}
                        <div
                          className="absolute inset-y-0 left-0 rounded-xl pointer-events-none"
                          style={{ width: `${displayPct}%`, background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.25) 50%, transparent 100%)', backgroundSize: '200% 100%', animation: 'shimmerSweep 3s ease-in-out infinite' }}
                        />
                        {/* Milestone lines */}
                        {[25, 50, 75].map(p => (
                          <div key={p} className="absolute top-0 bottom-0 w-px bg-gray-200/70" style={{ left: `${p}%` }} />
                        ))}
                        {/* Percentage label inside bar */}
                        {displayPct > 10 && (
                          <div className="absolute inset-0 flex items-center pl-3">
                            <span className="text-[11px] font-bold text-white drop-shadow-md">{rawPct.toFixed(1)}%</span>
                          </div>
                        )}
                        {/* Percentage label outside for very small bars */}
                        {displayPct <= 10 && displayPct > 0 && (
                          <div className="absolute inset-y-0 flex items-center" style={{ left: `${displayPct + 1}%` }}>
                            <span className="text-[11px] font-bold text-gray-600">{rawPct.toFixed(1)}%</span>
                          </div>
                        )}
                      </div>
                      {/* Scale markers */}
                      <div className="flex justify-between mt-1 px-0.5">
                        <span className="text-[9px] text-gray-300 font-medium">0%</span>
                        <span className="text-[9px] text-gray-300 font-medium">25%</span>
                        <span className="text-[9px] text-gray-300 font-medium">50%</span>
                        <span className="text-[9px] text-gray-300 font-medium">75%</span>
                        <span className="text-[9px] text-gray-300 font-medium">100%</span>
                      </div>
                    </div>
                  );
                })}
              {achievements.filter(a => parseFloat(a.target_amount || 0) > 0).length === 0 && (
                <div className="text-center py-8 text-gray-400">
                  <Target size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No targets set for the selected period</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MoM Growth Chart */}
      {momGrowth.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">Month-over-Month Service Growth</h3>
          <p className="text-xs text-gray-400 mb-4">Revenue change compared to previous month per service</p>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart
              data={(() => {
                // Group by month and show latest growth for each service
                const latestByService = {};
                momGrowth.forEach(g => {
                  if (!latestByService[g.service_name] || g.month > latestByService[g.service_name].month) {
                    latestByService[g.service_name] = g;
                  }
                });
                return Object.values(latestByService).sort((a, b) => b.growth_pct - a.growth_pct);
              })()}
              margin={{ top: 5, right: 30, left: 20, bottom: 60 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="service_name" tick={{ fontSize: 9 }} angle={-30} textAnchor="end" height={80} />
              <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v, name, props) => {
                const d = props.payload;
                return [
                  `${v > 0 ? '+' : ''}${v}%`,
                  'Growth',
                ];
              }} labelFormatter={(label, payload) => {
                const d = payload?.[0]?.payload;
                return d ? `${d.service_name} (${d.prev_month} → ${d.month})` : label;
              }} />
              <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="3 3" />
              <Bar dataKey="growth_pct" name="MoM Growth %" radius={[4, 4, 0, 0]}>
                {(() => {
                  const latestByService = {};
                  momGrowth.forEach(g => {
                    if (!latestByService[g.service_name] || g.month > latestByService[g.service_name].month) {
                      latestByService[g.service_name] = g;
                    }
                  });
                  return Object.values(latestByService).sort((a, b) => b.growth_pct - a.growth_pct);
                })().map((entry, index) => (
                  <Cell key={index} fill={entry.growth_pct > 0 ? '#22c55e' : entry.growth_pct < 0 ? '#ef4444' : '#94a3b8'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Service Revenue Bar Chart */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Revenue by Service</h3>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={kpis?.top_services?.map(s => ({ service_name: s.name, total_revenue: s.revenue, total_ethio: 0 })) || []} layout="vertical" margin={{ left: 10, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" tickFormatter={(v) => `${(v / 1000000).toFixed(0)}M`} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="service_name" width={120} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v) => formatCurrency(v)} />
              <Legend />
              <Bar dataKey="total_revenue" name="Total Revenue" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              <Bar dataKey="total_ethio" name="ET Share" fill="#10b981" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

      </div>

      {/* Top Partners & Underperforming */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Partners */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Top 5 Partners</h3>
          <div className="space-y-3">
            {kpis?.top_partners?.map((p, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-semibold">
                    {i + 1}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-900 truncate max-w-[200px]">{p.partner_name}</div>
                    <div className="text-xs text-gray-500 truncate max-w-[200px]">{p.services || p.service_name || ''}</div>
                  </div>
                </div>
                <div className="text-sm font-semibold text-gray-900">{formatCurrency(p.total_revenue)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Underperforming Services */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">
            <AlertTriangle size={16} className="inline mr-1 text-amber-500" />
            Underperforming Services (&lt;50%)
          </h3>
          {kpis?.underperforming_services?.length > 0 ? (
            <div className="space-y-3">
              {kpis.underperforming_services.map((s, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <div className="text-sm font-medium text-gray-900">{s.name}</div>
                    <div className="text-xs text-gray-500">
                      {formatCurrency(s.actual_revenue)} of {formatCurrency(s.target_amount)} target
                    </div>
                  </div>
                  <span className="px-2 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                    {formatPercent(s.achievement_pct)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400 text-sm">
              {totalTarget > 0 ? 'All services are performing well!' : 'Set targets to track performance'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
