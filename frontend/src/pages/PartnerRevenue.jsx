import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer,
} from 'recharts';
import { Users, TrendingUp, Search, Trash2, Calendar, AlertTriangle, Edit2, X, Check, Activity } from 'lucide-react';
import { partnersAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { formatCurrency, formatNumber } from '../utils/helpers';
import { useDateFilter } from '../context/DateFilterContext';
import { getDateFilter } from '../utils/dateFilter';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1', '#14b8a6', '#a855f7', '#e11d48'];

function formatMonth(m) {
  if (!m) return '';
  const [year, month] = m.split('-');
  const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[parseInt(month)]} ${year}`;
}

function toLocalDateString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function PartnerRevenue() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('partners.edit');
  const canDelete = hasPermission('partners.delete');
  const [kpis, setKpis] = useState(null);
  const [summary, setSummary] = useState([]);
  // topPartners comes from kpis.top_partners (dashboard-kpis returns top 10)
  const [selectedService, setSelectedService] = useState('');
  const [partnerSearch, setPartnerSearch] = useState('');
  const [partnerPage, setPartnerPage] = useState(1);
  const [partnerList, setPartnerList] = useState({ data: [], pagination: {} });
  const [loading, setLoading] = useState(true);

  // Month/Year filter — persisted across page navigation
  const [availableMonths, setAvailableMonths] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(() => getDateFilter('partner_month'));

  // Shared date filter — synced across all modules
  const { startDate, endDate, setStartDate, setEndDate } = useDateFilter();
  const now = new Date();

  // Delete by month
  const [deleteMonth, setDeleteMonth] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // Edit partner record
  const [editRecord, setEditRecord] = useState(null);
  const [editForm, setEditForm] = useState({});

  useEffect(() => { loadMonths(); }, []);
  // When global date changes, clear selectedMonth so it uses the date range instead
  useEffect(() => { setSelectedMonth(''); }, [startDate, endDate]);
  // Debounced load — waits 400ms after last date/month change before fetching
  useEffect(() => {
    const t = setTimeout(() => loadData(), 400);
    return () => clearTimeout(t);
  }, [startDate, endDate, selectedMonth]);
  // loadPartners is staggered at 900ms so KPI cards render before the heavy partner list fires
  useEffect(() => {
    const t = setTimeout(() => loadPartners(), 900);
    return () => clearTimeout(t);
  }, [startDate, endDate, selectedMonth, selectedService, partnerSearch, partnerPage]);

  async function loadMonths() {
    try {
      const months = await partnersAPI.getMonths();
      setAvailableMonths(months);
    } catch { /* ignore */ }
  }

  function getDateParams() {
    const params = {};
    if (selectedMonth) {
      // When a specific month is selected, set start/end to that month
      params.start_date = `${selectedMonth}-01`;
      // Calculate end of month
      const [y, m] = selectedMonth.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      params.end_date = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`;
    } else {
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
    }
    return params;
  }

  async function loadData() {
    setLoading(true);
    try {
      const dateParams = getDateParams();
      // 2 parallel calls instead of 3 — getDashboardKPIs now returns top 10 partners
      const [kpiData, summaryData] = await Promise.all([
        partnersAPI.getDashboardKPIs(dateParams),
        partnersAPI.getSummary(dateParams),
      ]);
      setKpis(kpiData);
      setSummary(summaryData);
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  async function loadPartners() {
    try {
      const params = { limit: 50, page: partnerPage, ...getDateParams() };
      if (selectedService) params.service_name = selectedService;
      if (partnerSearch) params.search = partnerSearch;
      setPartnerList(await partnersAPI.getPartners(params));
    } catch { /* ignore */ }
  }

  // Edit a partner record
  function startEdit(record) {
    setEditRecord(record);
    setEditForm({
      partner_name: record.partner_name,
      service_name: record.service_name,
      total_revenue: record.total_revenue,
      ethio_share: record.ethio_share || '',
      revenue_month: record.revenue_month,
    });
  }

  async function handleSaveEdit() {
    try {
      await partnersAPI.update(editRecord.id, {
        ...editForm,
        total_revenue: parseFloat(editForm.total_revenue),
        ethio_share: editForm.ethio_share ? parseFloat(editForm.ethio_share) : null,
      });
      setEditRecord(null);
      loadPartners();
      loadData();
    } catch (err) { alert('Error: ' + err.message); }
  }

  async function handleDeleteRecord(id) {
    if (!confirm('Delete this partner revenue record?')) return;
    try {
      await partnersAPI.delete(id);
      loadPartners();
      loadData();
    } catch (err) { alert('Error: ' + err.message); }
  }

  async function handleDeleteMonth() {
    if (!deleteMonth) return;
    setDeleteLoading(true);
    try {
      const result = await partnersAPI.deleteMonth(deleteMonth);
      alert(`✅ ${result.message}\nTotal revenue deleted: ${formatCurrency(result.total_revenue_deleted)}`);
      setDeleteMonth('');
      setDeleteConfirm(null);
      // Reload data
      loadMonths();
      loadData();
      loadPartners();
    } catch (err) {
      alert(`❌ Error: ${err.message}`);
    }
    setDeleteLoading(false);
  }

  function getMonthLabel(monthStr) {
    if (!monthStr) return '';
    const [y, m] = monthStr.split('-');
    const months = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${months[parseInt(m)]} ${y}`;
  }

  if (loading && !kpis) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <div className="h-3 bg-gray-200 rounded w-20 mb-3"></div>
              <div className="h-8 bg-gray-200 rounded w-28 mb-2"></div>
              <div className="h-2 bg-gray-100 rounded w-16"></div>
            </div>
          ))}
        </div>
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="h-4 bg-gray-200 rounded w-48 mb-4"></div>
          <div className="h-64 bg-gray-100 rounded-lg"></div>
        </div>
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="h-4 bg-gray-200 rounded w-40 mb-4"></div>
          {[1,2,3,4,5].map(i => (
            <div key={i} className="flex items-center gap-4 py-3 border-b border-gray-50 last:border-0">
              <div className="h-4 bg-gray-200 rounded w-40"></div>
              <div className="h-4 bg-gray-100 rounded w-24 ml-auto"></div>
              <div className="h-4 bg-gray-100 rounded w-20"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const grandTotal = parseFloat(kpis?.grand_total || 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Partner Revenue</h1>
          <p className="text-sm text-gray-500">Imported VAS partner revenue from Excel files</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Month/Year Selector */}
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-gray-400" />
            <select
              value={selectedMonth}
              onChange={(e) => {
                setSelectedMonth(e.target.value);
                // When selecting a month, sync global date range
                if (e.target.value) {
                  const [y, m] = e.target.value.split('-').map(Number);
                  const start = `${e.target.value}-01`;
                  const lastDay = new Date(y, m, 0).getDate();
                  const end = `${e.target.value}-${String(lastDay).padStart(2, '0')}`;
                  setStartDate(start);
                  setEndDate(end);
                }
              }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Months</option>
              {availableMonths.map((m, i) => (
                <option key={i} value={m.revenue_month}>
                  {formatMonth(m.revenue_month)} — {formatCurrency(m.total_revenue)}
                </option>
              ))}
            </select>
          </div>
          {/* Date Range (visible when no month selected) */}
          {!selectedMonth && (
            <>
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-gray-500">From</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-gray-500">To</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Revenue</span>
            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
              <TrendingUp className="text-blue-500" size={18} />
            </div>
          </div>
          <div className="text-xl font-bold text-gray-900">{formatCurrency(grandTotal)}</div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">VAS Services</span>
            <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center">
              <Activity className="text-indigo-500" size={18} />
            </div>
          </div>
          <div className="text-xl font-bold text-gray-900">{summary.length || 0}</div>
          <p className="text-xs text-gray-500 mt-1">Active service types with revenue</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Partners</span>
            <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
              <Users className="text-amber-500" size={18} />
            </div>
          </div>
          <div className="text-xl font-bold text-gray-900">{formatNumber(kpis?.total_partners || 0)}</div>
          <p className="text-xs text-gray-500 mt-1">Across {summary.length || 0} service types</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue by Service Bar Chart */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Revenue by Service Type</h3>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={summary} layout="vertical" margin={{ left: 10, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" tickFormatter={(v) => `${(v / 1000000).toFixed(0)}M`} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="service_name" width={120} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v) => formatCurrency(v)} />
              <Bar dataKey="total_revenue" radius={[0, 4, 4, 0]}>
                {summary.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top 3 VAS Services Leaderboard */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Top 3 Services by Revenue</h3>
          <div className="space-y-3">
            {[...summary].sort((a, b) => parseFloat(b.total_revenue) - parseFloat(a.total_revenue)).slice(0, 3).map((service, idx) => {
              const rev = parseFloat(service.total_revenue);
              const share = grandTotal > 0 ? ((rev / grandTotal) * 100) : 0;
              const topRev = summary.length > 0 ? parseFloat([...summary].sort((a, b) => parseFloat(b.total_revenue) - parseFloat(a.total_revenue))[0].total_revenue) : 1;
              const barPct = topRev > 0 ? (rev / topRev) * 100 : 0;
              const rankColors = ['text-green-600 bg-green-50', 'text-blue-600 bg-blue-50', 'text-gray-500 bg-gray-50'];
              return (
                <div key={idx} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${rankColors[idx]}`}>
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{service.service_name}</div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1.5">
                      <div className="h-1.5 rounded-full bg-green-500" style={{ width: `${barPct}%` }} />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold text-gray-900">{formatCurrency(rev)}</div>
                    <div className="text-xs text-gray-400">{share.toFixed(1)}%</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top 3 Partners Leaderboard */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Top 3 Partners by Revenue</h3>
          <div className="space-y-3">
            {(kpis?.top_partners || []).filter(p => p.partner_name !== 'Unknown Partner').slice(0, 3).map((partner, idx) => {
              const rev = parseFloat(partner.total_revenue);
              const share = grandTotal > 0 ? ((rev / grandTotal) * 100) : 0;
              const rankColors = ['text-green-600 bg-green-50', 'text-blue-600 bg-blue-50', 'text-gray-500 bg-gray-50'];
              return (
                <div key={idx} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${rankColors[idx]}`}>
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate" title={partner.partner_name}>{partner.partner_name}</div>
                    <div className="text-xs text-gray-400 truncate">{partner.services}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold text-gray-900">{formatCurrency(rev)}</div>
                    <div className="text-xs text-gray-400">{share.toFixed(1)}%</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Service Summary Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Service Revenue Summary</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4 font-semibold text-gray-600">Service Name</th>
                <th className="text-right py-3 px-4 font-semibold text-gray-600">Total Revenue</th>
                <th className="text-right py-3 px-4 font-semibold text-gray-600">ET Share</th>
                <th className="text-center py-3 px-4 font-semibold text-gray-600">Partners</th>
                <th className="text-center py-3 px-4 font-semibold text-gray-600">Share</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s, i) => {
                const rev = parseFloat(s.total_revenue);
                const ethio = parseFloat(s.total_ethio || 0);
                const share = grandTotal > 0 ? ((rev / grandTotal) * 100).toFixed(1) : 0;
                return (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedService(selectedService === s.service_name ? '' : s.service_name)}>
                    <td className="py-3 px-4 font-medium text-gray-900">{s.service_name}</td>
                    <td className="text-right py-3 px-4 font-semibold text-gray-900">{formatCurrency(rev)}</td>
                    <td className="text-right py-3 px-4 text-green-600">{ethio > 0 ? formatCurrency(ethio) : '-'}</td>
                    <td className="text-center py-3 px-4 text-gray-600">{s.partner_count}</td>
                    <td className="text-center py-3 px-4">
                      <div className="flex items-center gap-2 justify-center">
                        <div className="w-20 bg-gray-200 rounded-full h-2">
                          <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${Math.min(parseFloat(share), 100)}%` }} />
                        </div>
                        <span className="text-xs text-gray-600 w-10">{share}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top Partners */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Top 10 Partners</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4 font-semibold text-gray-600">#</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-600">Partner Name</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-600">Services</th>
                <th className="text-right py-3 px-4 font-semibold text-gray-600">Total Revenue</th>
                <th className="text-center py-3 px-4 font-semibold text-gray-600">Entries</th>
              </tr>
            </thead>
            <tbody>
              {(kpis?.top_partners || []).filter(p => p.partner_name !== 'Unknown Partner').map((p, i) => {
                const rev = parseFloat(p.total_revenue);
                return (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-3 px-4 text-gray-500 font-medium">{i + 1}</td>
                    <td className="py-3 px-4 font-medium text-gray-900 max-w-[350px] truncate">{p.partner_name}</td>
                    <td className="py-3 px-4 text-gray-600 text-xs">{p.services}</td>
                    <td className="text-right py-3 px-4 font-semibold text-gray-900">{formatCurrency(rev)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Full Partner List with Delete */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h3 className="text-sm font-semibold text-gray-700">All Partners ({partnerList.pagination?.total || 0})</h3>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search partners..."
                value={partnerSearch}
                onChange={(e) => { setPartnerSearch(e.target.value); setPartnerPage(1); }}
                className="border border-gray-300 rounded-lg pl-8 pr-3 py-1.5 text-sm w-60"
              />
            </div>
            <select value={selectedService} onChange={(e) => { setSelectedService(e.target.value); setPartnerPage(1); }} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
              <option value="">All Services</option>
              {summary.map((s, i) => (
                <option key={i} value={s.service_name}>{s.service_name} ({s.partner_count})</option>
              ))}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50">
              <tr>
                <th className="text-left py-2 px-4 font-semibold text-gray-600">Partner Name</th>
                <th className="text-left py-2 px-4 font-semibold text-gray-600">Services</th>
                <th className="text-right py-2 px-4 font-semibold text-gray-600">Total Revenue</th>
                <th className="text-center py-2 px-4 font-semibold text-gray-600">Entries</th>
              </tr>
            </thead>
            <tbody>
              {partnerList.data?.map((p, i) => (
                <tr key={i} className="border-t border-gray-50 hover:bg-gray-50">
                  <td className="py-2 px-4 text-gray-900 max-w-[350px] truncate">{p.partner_name}</td>
                  <td className="py-2 px-4 text-gray-600 text-xs max-w-[250px] truncate" title={p.services}>{p.services}</td>
                  <td className="text-right py-2 px-4 font-medium">{formatCurrency(p.total_revenue)}</td>
                  <td className="text-center py-2 px-4 text-xs text-gray-500">{p.entry_count} entries across {p.service_count} services</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {partnerList.pagination?.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t mt-2 flex-wrap gap-3">
            <span className="text-sm text-gray-500">
              Page {partnerList.pagination.page} of {partnerList.pagination.pages} · {partnerList.pagination.total} partners
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPartnerPage(p => Math.max(1, p - 1))}
                disabled={partnerPage <= 1}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ← Previous
              </button>
              <button
                onClick={() => setPartnerPage(p => Math.min(partnerList.pagination.pages, p + 1))}
                disabled={partnerPage >= partnerList.pagination.pages}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Delete Revenue by Month */}
      {canDelete && (
      <div className="bg-white rounded-xl shadow-sm border border-red-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Trash2 size={18} className="text-red-500" />
          <h3 className="text-sm font-semibold text-red-700">Delete Revenue Data by Month</h3>
        </div>
        <p className="text-xs text-gray-500 mb-4">Permanently delete all revenue records for a specific month. This action cannot be undone.</p>
        <div className="flex items-center gap-3">
          <select
            value={deleteMonth}
            onChange={(e) => { setDeleteMonth(e.target.value); setDeleteConfirm(null); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Select month to delete...</option>
            {availableMonths.map((m, i) => (
              <option key={i} value={m.revenue_month}>
                {formatMonth(m.revenue_month)} — {m.total_partners} records, {formatCurrency(m.total_revenue)}
              </option>
            ))}
          </select>
          {deleteMonth && !deleteConfirm && (
            <button
              onClick={() => setDeleteConfirm(true)}
              className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 flex items-center gap-2"
            >
              <Trash2 size={14} />
              Delete
            </button>
          )}
          {deleteConfirm && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
                <AlertTriangle size={16} className="text-red-500" />
                <span className="text-sm text-red-700 font-medium">
                  Delete all {formatMonth(deleteMonth)} data? This cannot be undone!
                </span>
              </div>
              <button
                onClick={handleDeleteMonth}
                disabled={deleteLoading}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {deleteLoading ? 'Deleting...' : 'Yes, Delete'}
              </button>
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
      )}

      {/* Edit Partner Record Modal */}
      {editRecord && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Edit Partner Record</h2>
              <button onClick={() => setEditRecord(null)} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Partner Name</label>
                <input value={editForm.partner_name || ''} onChange={(e) => setEditForm({ ...editForm, partner_name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Service Name</label>
                <input value={editForm.service_name || ''} onChange={(e) => setEditForm({ ...editForm, service_name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Total Revenue (ETB)</label>
                <input type="number" step="0.01" value={editForm.total_revenue || ''} onChange={(e) => setEditForm({ ...editForm, total_revenue: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ET Share (ETB)</label>
                <input type="number" step="0.01" value={editForm.ethio_share || ''} onChange={(e) => setEditForm({ ...editForm, ethio_share: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Optional" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Revenue Month</label>
                <input value={editForm.revenue_month || ''} onChange={(e) => setEditForm({ ...editForm, revenue_month: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="YYYY-MM" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setEditRecord(null)} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
                <button onClick={handleSaveEdit} className="px-4 py-2 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 flex items-center gap-1"><Check size={14} /> Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
