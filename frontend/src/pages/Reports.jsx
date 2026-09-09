import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, ComposedChart, Line, ReferenceLine } from 'recharts';
import { FileBarChart, Download } from 'lucide-react';
import { reportsAPI, exportsAPI } from '../services/api';
import { formatCurrency, formatPercent, getAchievementBg } from '../utils/helpers';
import { useDateFilter } from '../context/DateFilterContext';
import toast from 'react-hot-toast';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1'];

export default function Reports() {
  const [report, setReport] = useState(null);
  const [monthlyTrend, setMonthlyTrend] = useState([]);
  const [loading, setLoading] = useState(true);
  const { startDate, endDate, setStartDate, setEndDate } = useDateFilter();

  useEffect(() => { loadReport(); }, [startDate, endDate]);

  async function loadReport() {
    setLoading(true);
    try {
      const params = { start_date: startDate, end_date: endDate };
      const [reportData, trendData] = await Promise.all([
        reportsAPI.getPerformance(params),
        reportsAPI.getMonthlyTrend(params),
      ]);
      setReport(reportData);
      setMonthlyTrend(trendData);
    } catch (err) { toast.error('Failed to load report'); }
    setLoading(false);
  }

  function exportCSV() {
    if (!report?.services?.length) { toast.error('No data to export'); return; }
    const headers = ['Service', 'Category', 'Revenue', 'Target', 'Achievement %', 'Remaining', 'Partners'];
    const rows = report.services.map(s => [
      s.name, s.category, s.actual_amount, s.target_amount, s.achievement_pct, s.remaining, s.partner_count,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `vas_report_${startDate}_to_${endDate}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast.success('Report exported');
  }

  function fmtDate(d) {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Performance Reports</h1>
          <p className="text-sm text-gray-500">VAS revenue performance analysis from imported partner data</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCSV} className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700">
            <Download size={16} /> CSV
          </button>
          <button onClick={() => exportsAPI.downloadPPTX({ start_date: startDate, end_date: endDate })}
            className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
            PPTX
          </button>
        </div>
      </div>

      {/* Date Range Filter */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <label className="text-sm font-medium text-gray-600">Date Range:</label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Start:</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">End:</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <span className="text-xs text-gray-400">({fmtDate(startDate)} — {fmtDate(endDate)})</span>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading report...</div>
      ) : report && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Total Services', value: report.summary.total_services },
              { label: 'Total Revenue', value: formatCurrency(report.summary.total_actual) },
              { label: 'Target Achievement', value: report.summary.total_target > 0 ? formatPercent(report.summary.overall_achievement) : 'No targets set' },
              { label: 'Partners', value: report.summary.total_partners || 0 },
            ].map((card, i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{card.label}</p>
                <p className="text-lg font-bold mt-1 text-gray-900">{card.value}</p>
              </div>
            ))}
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Revenue by Service</h3>
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={report.services} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tickFormatter={(v) => `${(v / 1000000).toFixed(0)}M`} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => formatCurrency(v)} />
                  <Legend />
                  <Bar dataKey="actual_amount" name="Revenue" fill="#16a34a" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Revenue by Category</h3>
              <ResponsiveContainer width="100%" height={350}>
                <BarChart
                  data={report.services.reduce((acc, s) => {
                    const existing = acc.find(a => a.category === s.category);
                    if (existing) { existing.value += s.actual_amount; } else { acc.push({ category: s.category, value: s.actual_amount, color: s.category_color || '#6B7280' }); }
                    return acc;
                  }, []).sort((a, b) => b.value - a.value)}
                  layout="vertical"
                  margin={{ left: 10, right: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tickFormatter={(v) => `${(v / 1000000).toFixed(0)}M`} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="category" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => formatCurrency(v)} />
                  <Legend />
                  <Bar dataKey="value" name="Revenue" radius={[0, 4, 4, 0]}>
                    {report.services.reduce((acc, s) => {
                      const existing = acc.find(a => a.category === s.category);
                      if (!existing) acc.push({ category: s.category, color: s.category_color || '#6B7280' });
                      return acc;
                    }, []).sort((a, b) => b.value - a.value).map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Monthly Trend */}
          {monthlyTrend.length > 0 && (() => {
            const sorted = [...monthlyTrend].filter(m => m.revenue_month).sort((a, b) => (a.revenue_month || '').localeCompare(b.revenue_month || ''));
            const chartData = sorted.map((m, i) => {
              const revenue = parseFloat(m.total_revenue || 0);
              const prevRevenue = i > 0 ? parseFloat(sorted[i - 1].total_revenue || 0) : 0;
              const momChange = i > 0 ? revenue - prevRevenue : 0;
              const momGrowth = i > 0 && prevRevenue > 0 ? parseFloat(((revenue - prevRevenue) / prevRevenue * 100).toFixed(1)) : 0;
              return { month: m.revenue_month, revenue, mom_growth: i > 0 ? momGrowth : null, mom_change: i > 0 ? momChange : null, prevRevenue };
            });
            const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const formatChange = (val) => { if (val === null || val === undefined) return ''; const sign = val >= 0 ? '+' : ''; return `${sign}${formatCurrency(val)}`; };
            return (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Monthly Revenue Trend & MoM Growth</h3>
                <ResponsiveContainer width="100%" height={380}>
                  <ComposedChart data={chartData} margin={{ top: 20, right: 20, left: 20, bottom: 5 }}>
                    <defs>
                      <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#16a34a" stopOpacity={0.9}/>
                        <stop offset="100%" stopColor="#22c55e" stopOpacity={0.6}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} tickFormatter={(v) => { const [y, m] = v.split('-'); return monthNames[parseInt(m)] + ' ' + y.substring(2); }} />
                    <YAxis yAxisId="revenue" tickFormatter={(v) => v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : `${(v / 1e3).toFixed(0)}K`} tick={{ fontSize: 12 }} width={70} />
                    <YAxis yAxisId="growth" orientation="right" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} width={50} domain={['dataMin - 10', 'dataMax + 10']} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const data = payload[0]?.payload;
                        const [y, m] = (data?.month || label).split('-');
                        const monthLabel = monthNames[parseInt(m)] + ' ' + y;
                        const rev = data?.revenue || 0;
                        const change = data?.mom_change;
                        const growth = data?.mom_growth;
                        const isUp = change !== null && change > 0;
                        const isDown = change !== null && change < 0;
                        const changeColor = isUp ? 'text-emerald-600' : isDown ? 'text-red-600' : 'text-gray-500';
                        const changeIcon = isUp ? '▲' : isDown ? '▼' : '—';
                        return (
                          <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-3 min-w-[200px]">
                            <p className="text-xs font-bold text-gray-700 mb-2">{monthLabel}</p>
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-gray-500">Revenue</span>
                                <span className="text-sm font-bold text-gray-900">{formatCurrency(rev)}</span>
                              </div>
                              {growth !== null && (
                                <>
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs text-gray-500">MoM Change</span>
                                    <span className={`text-sm font-bold ${changeColor}`}>{changeIcon} {formatChange(change)}</span>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs text-gray-500">MoM Growth</span>
                                    <span className={`text-sm font-bold ${changeColor}`}>{growth > 0 ? '+' : ''}{growth}%</span>
                                  </div>
                                </>
                              )}
                              {growth === null && (
                                <p className="text-xs text-gray-400 italic">No previous month data</p>
                              )}
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Legend />
                    <ReferenceLine yAxisId="growth" y={0} stroke="#9ca3af" strokeDasharray="3 3" />
                    <Bar yAxisId="revenue" dataKey="revenue" name="Total Revenue" fill="url(#barGradient)" radius={[6, 6, 0, 0]} />
                    <Line yAxisId="growth" type="monotone" dataKey="mom_growth" name="MoM Growth %" stroke="#f59e0b" strokeWidth={2.5} dot={(props) => {
                      const { cx, cy, payload } = props;
                      if (payload?.mom_growth === null) return null;
                      const isUp = payload.mom_growth > 0;
                      const color = isUp ? '#16a34a' : '#ef4444';
                      return (
                        <g>
                          <circle cx={cx} cy={cy} r={5} fill={color} stroke="#fff" strokeWidth={2} />
                          <text x={cx} y={cy - 12} textAnchor="middle" fill={color} fontSize={10} fontWeight="bold">
                            {isUp ? '+' : ''}{payload.mom_growth}%
                          </text>
                        </g>
                      );
                    }} connectNulls={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            );
          })()}

          {/* Detailed Table */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6 pb-0">
              <h3 className="text-sm font-semibold text-gray-700">Service Performance Details</h3>
            </div>
            <div className="overflow-x-auto p-6 pt-4">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left py-3 px-4 font-semibold text-gray-600">Service</th>
                    <th className="text-center py-3 px-4 font-semibold text-gray-600">Category</th>
                    <th className="text-right py-3 px-4 font-semibold text-gray-600">Revenue</th>
                    <th className="text-right py-3 px-4 font-semibold text-gray-600">Target</th>
                    <th className="text-center py-3 px-4 font-semibold text-gray-600">Achievement</th>
                    <th className="text-center py-3 px-4 font-semibold text-gray-600">Partners</th>
                    <th className="text-center py-3 px-4 font-semibold text-gray-600">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {report.services.map((s) => {
                    const pct = parseFloat(s.achievement_pct || 0);
                    return (
                      <tr key={s.id} className="border-t border-gray-50 hover:bg-gray-50">
                        <td className="py-3 px-4">
                          <div className="font-medium text-gray-900">{s.name}</div>
                        </td>
                        <td className="text-center py-3 px-4">
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 capitalize">{s.category}</span>
                        </td>
                        <td className="text-right py-3 px-4 font-semibold text-gray-900">{formatCurrency(s.actual_amount)}</td>
                        <td className="text-right py-3 px-4 text-gray-600">{s.target_amount > 0 ? formatCurrency(s.target_amount) : '—'}</td>
                        <td className="text-center py-3 px-4">
                          {s.target_amount > 0 ? (
                            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getAchievementBg(pct)}`}>
                              {formatPercent(pct)}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                        <td className="text-center py-3 px-4 text-gray-600">{s.partner_count}</td>
                        <td className="text-center py-3 px-4">
                          <span className="text-xs font-medium text-green-600">✓ Active</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
