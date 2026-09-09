import { useState, useEffect } from 'react';
import { Layers, ChevronDown, ChevronRight, Plus, Trash2, X, Check, Target, Calendar, RefreshCw, Zap, BarChart3 } from 'lucide-react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { goalCascadeAPI, servicesAPI, targetsAPI } from '../services/api';
import toast from 'react-hot-toast';

const formatAxis = (v) => {
  const n = Number(v) || 0;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return `${n}`;
};

const formatETB = (amount) => {
  if (amount >= 1e9) return `ETB ${(amount / 1e9).toFixed(2)}B`;
  if (amount >= 1e6) return `ETB ${(amount / 1e6).toFixed(2)}M`;
  if (amount >= 1e3) return `ETB ${(amount / 1e3).toFixed(1)}K`;
  return `ETB ${Number(amount).toLocaleString()}`;
};

function toInputDate(v) {
  if (!v) return '';
  const s = String(v);
  // Plain YYYY-MM-DD (goal-cascade API returns these already local) — full match only
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return m[0];
  // ISO/UTC string (revenue-targets API) — shift to the local calendar date
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }
  return '';
}

/* ---- Period filter persistence (localStorage) ---- */
const PERIOD_STORAGE_KEY = 'vas_goal_cascade_period';

function savePeriod(p) {
  try {
    if (p && p.start && p.end) {
      localStorage.setItem(PERIOD_STORAGE_KEY, JSON.stringify({ start: p.start, end: p.end }));
    }
  } catch { /* storage unavailable */ }
}

function loadSavedPeriod() {
  try {
    const raw = localStorage.getItem(PERIOD_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    const ok = p && /^\d{4}-\d{2}-\d{2}$/.test(p.start) && /^\d{4}-\d{2}-\d{2}$/.test(p.end) && p.start <= p.end;
    return ok ? { start: p.start, end: p.end } : null;
  } catch { /* ignore */ }
  return null;
}

export default function GoalCascade() {
  const [cascades, setCascades] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selectedCascade, setSelectedCascade] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // Selected reporting period (start / end dates)
  const [period, setPeriod] = useState(null); // { start, end }
  const [form, setForm] = useState({
    service_id: '', annual_target: '', target_start_date: '', target_end_date: '', cascade_method: 'equal',
  });

  // Set the period AND remember it, so the filter survives reloads/navigation
  function applyPeriod(p) {
    setPeriod(p);
    savePeriod(p);
  }

  useEffect(() => { init(); }, []);
  useEffect(() => { if (period) loadCascades(); }, [period]);

  async function init() {
    try { setServices((await servicesAPI.getAll()).filter(s => s.status === 'active')); } catch { /* */ }
    // Restore the user's last selected period filter, if one was saved
    const saved = loadSavedPeriod();
    if (saved) {
      applyPeriod(saved);
      return;
    }
    // Otherwise derive the default reporting period from the revenue TARGET windows
    // (source of truth) so cascades always show the exact configured targets. Fall
    // back to any existing cascades, then the current calendar year.
    try {
      const targets = await targetsAPI.getAll({});
      const dated = (targets || []).filter(t => t.target_start_date && t.target_end_date);
      if (dated.length > 0) {
        let s = toInputDate(dated[0].target_start_date), e = toInputDate(dated[0].target_end_date);
        dated.forEach(t => {
          const ts = toInputDate(t.target_start_date), te = toInputDate(t.target_end_date);
          if (ts && ts < s) s = ts;
          if (te && te > e) e = te;
        });
        applyPeriod({ start: s, end: e });
        return;
      }
    } catch { /* ignore */ }
    try {
      const all = await goalCascadeAPI.getAll({});
      if (all && all.length > 0) {
        let s = all[0].target_start_date, e = all[0].target_end_date;
        all.forEach(c => {
          if (c.target_start_date && c.target_start_date < s) s = c.target_start_date;
          if (c.target_end_date && c.target_end_date > e) e = c.target_end_date;
        });
        applyPeriod({ start: toInputDate(s), end: toInputDate(e) });
        return;
      }
    } catch { /* ignore */ }
    const y = new Date().getFullYear();
    applyPeriod({ start: `${y}-01-01`, end: `${y}-12-31` });
  }

  async function loadCascades() {
    setLoading(true);
    try {
      const data = await goalCascadeAPI.getAll({ start_date: period.start, end_date: period.end });
      setCascades(data);
    } catch (err) { toast.error('Failed to load cascades'); }
    setLoading(false);
  }

  async function loadDetail(cascade) {
    setDetailLoading(true);
    try {
      const params = period ? { start_date: period.start, end_date: period.end } : {};
      const detail = await goalCascadeAPI.getOne(cascade.id, params);
      setSelectedCascade(detail);
    } catch (err) { toast.error('Failed to load details'); }
    setDetailLoading(false);
  }

  async function handleCreate(e) {
    e.preventDefault();
    try {
      await goalCascadeAPI.create({
        ...form,
        annual_target: parseFloat(form.annual_target),
        created_by: 'Admin',
      });
      toast.success('Cascade created');
      setShowModal(false);
      // refresh over the created period
      if (form.target_start_date && form.target_end_date) {
        applyPeriod({ start: form.target_start_date, end: form.target_end_date });
      } else {
        loadCascades();
      }
    } catch (err) { toast.error(err.message); }
  }

  async function handleAutoGenerate() {
    if (!period) return;
    if (!confirm(`Auto-generate cascades for ALL active services over ${period.start} → ${period.end}?`)) return;
    try {
      const result = await goalCascadeAPI.autoGenerate({ start_date: period.start, end_date: period.end, created_by: 'Admin' });
      toast.success(result.message);
      setSelectedCascade(null);
      loadCascades();
    } catch (err) { toast.error(err.message); }
  }

  async function handleRefreshAchievements() {
    if (!period) return;
    try {
      await goalCascadeAPI.refreshAchievements({ start_date: period.start, end_date: period.end });
      toast.success('Achievement data refreshed');
      loadCascades();
      if (selectedCascade) {
        const params = { start_date: period.start, end_date: period.end };
        const detail = await goalCascadeAPI.getOne(selectedCascade.id, params);
        setSelectedCascade(detail);
      }
    } catch (err) { toast.error(err.message); }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this cascade?')) return;
    try {
      await goalCascadeAPI.delete(id);
      toast.success('Deleted');
      if (selectedCascade?.id === id) setSelectedCascade(null);
      loadCascades();
    } catch (err) { toast.error(err.message); }
  }

  const totalTarget = cascades.reduce((sum, c) => sum + parseFloat((c.effective_target ?? c.annual_target) || 0), 0);
  const totalActual = cascades.reduce((sum, c) => sum + parseFloat((c.effective_actual ?? c.total_actual) || 0), 0);
  const overallAchievement = totalTarget > 0 ? Math.round((totalActual / totalTarget) * 10000) / 100 : 0;

  // Chart data: Target vs Actual (ETB) + Achievement % line, per service
  const chartData = cascades.map((c) => {
    const name = c.service_name || c.service_name_fallback || 'SVC';
    return {
      name: name.length > 16 ? `${name.slice(0, 15)}…` : name,
      Target: parseFloat((c.effective_target ?? c.annual_target) || 0),
      Actual: parseFloat((c.effective_actual ?? c.total_actual) || 0),
      Achievement: parseFloat((c.effective_achievement ?? c.overall_achievement) || 0),
    };
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Layers size={24} className="text-blue-600" /> Goal Cascading
          </h1>
          <p className="text-sm text-gray-500">Yearly → Semi-Annual → Quarterly targets over a selected date period</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={handleRefreshAchievements} disabled={!period} className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
            <RefreshCw size={16} /> Refresh Achievement
          </button>
          <button onClick={handleAutoGenerate} disabled={!period} className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
            <Zap size={16} /> Auto-Generate All
          </button>
          <button onClick={() => setShowModal(true)} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
            <Plus size={16} /> Add Cascade
          </button>
        </div>
      </div>

      {/* Period Filter + Summary */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Calendar size={16} className="text-gray-400" />
          <span className="text-sm font-medium text-gray-700">Period:</span>
          <input
            type="date"
            value={period?.start || ''}
            onChange={(e) => period && applyPeriod({ ...period, start: e.target.value })}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <span className="text-gray-400 text-sm">→</span>
          <input
            type="date"
            value={period?.end || ''}
            onChange={(e) => period && applyPeriod({ ...period, end: e.target.value })}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <div className="ml-auto flex items-center gap-6">
            <div className="text-center">
              <p className="text-[10px] text-gray-500 font-medium">TOTAL TARGET</p>
              <p className="text-sm font-bold text-gray-900">{formatETB(totalTarget)}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-gray-500 font-medium">TOTAL ACTUAL</p>
              <p className="text-sm font-bold text-blue-700">{formatETB(totalActual)}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-gray-500 font-medium">ACHIEVEMENT</p>
              <p className={`text-sm font-bold ${overallAchievement >= 100 ? 'text-green-700' : overallAchievement >= 50 ? 'text-amber-700' : 'text-red-700'}`}>{overallAchievement}%</p>
            </div>
            <span className="text-sm text-gray-500">{cascades.length} services</span>
          </div>
        </div>
      </div>

      {/* Performance Chart — Target vs Actual + Achievement % */}
      {cascades.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <BarChart3 size={15} className="text-blue-600" />
              Target vs Actual — {formatDisplayDate(period?.start)} → {formatDisplayDate(period?.end)}
            </h2>
            <span className="text-[10px] text-gray-400">ETB per service · amber line = achievement %</span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 5, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-18} textAnchor="end" height={64} />
              <YAxis yAxisId="amt" tick={{ fontSize: 10 }} tickFormatter={formatAxis} />
              <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
              <Tooltip
                formatter={(value, name) => (name === 'Achievement' ? [`${Number(value).toFixed(2)}%`, name] : [formatETB(value), name])}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="amt" dataKey="Target" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              <Bar yAxisId="amt" dataKey="Actual" fill="#10b981" radius={[3, 3, 0, 0]} />
              <ReferenceLine yAxisId="pct" y={100} stroke="#ef4444" strokeDasharray="4 4" />
              <Line yAxisId="pct" type="monotone" dataKey="Achievement" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Cascade Cards */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading cascades...</div>
      ) : cascades.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
          <Layers size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 mb-2">No cascades for the selected period</p>
          <p className="text-xs text-gray-400 mb-4">Pick a period above, then use "Auto-Generate All" to pull targets from revenue data for those dates.</p>
          <button onClick={handleAutoGenerate} className="px-4 py-2 text-sm text-white bg-emerald-600 rounded-lg hover:bg-emerald-700">Auto-Generate All</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {cascades.map((c) => {
            const achievement = parseFloat((c.effective_achievement ?? c.overall_achievement) || 0);
            const actual = parseFloat((c.effective_actual ?? c.total_actual) || 0);
            const target = parseFloat((c.effective_target ?? c.annual_target) || 0);
            const cardStart = c.effective_start || c.target_start_date;
            const cardEnd = c.effective_end || c.target_end_date;
            const progressWidth = Math.min(achievement, 100);
            // Achievement status thresholds (same as Revenue Alerts):
            // On Track >=90% · Slightly Behind 70–89% · Behind Target 50–69% · Critical <50%
            const cardLevel = achievement >= 90 ? 'green' : achievement >= 70 ? 'yellow' : achievement >= 50 ? 'orange' : 'red';
            const cardAccent = { green: 'bg-emerald-500', yellow: 'bg-amber-400', orange: 'bg-orange-500', red: 'bg-rose-500' }[cardLevel];
            const cardStatusChip = {
              green: 'bg-emerald-50 text-emerald-600 border-emerald-100',
              yellow: 'bg-amber-50 text-amber-600 border-amber-100',
              orange: 'bg-orange-50 text-orange-600 border-orange-100',
              red: 'bg-rose-50 text-rose-600 border-rose-100',
            }[cardLevel];
            const cardStatusLabel = {
              green: '✅ On Track',
              yellow: '⚠️ Slightly Behind',
              orange: '🔶 Behind Target',
              red: '🔴 Critical',
            }[cardLevel];
            const cardBarCls = { green: 'bg-emerald-500', yellow: 'bg-amber-400', orange: 'bg-orange-500', red: 'bg-rose-500' }[cardLevel];
            const cardPctCls = { green: 'text-emerald-600', yellow: 'text-amber-600', orange: 'text-orange-600', red: 'text-rose-600' }[cardLevel];
            return (
              <div
                key={c.id}
                onClick={() => loadDetail(c)}
                className={`bg-white rounded-xl border shadow-sm overflow-hidden cursor-pointer hover:shadow-lg hover:border-gray-200 transition group relative ${
                  selectedCascade?.id === c.id ? 'border-emerald-400 ring-2 ring-emerald-100' : 'border-gray-100'
                }`}
              >
                {/* Left accent bar */}
                <div className={`absolute left-0 top-0 bottom-0 w-1 ${cardAccent}`} />
                <div className="pl-5 pr-4 py-4">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cardStatusChip}`}>
                        {cardStatusLabel}
                      </span>
                      <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">{c.service_code || 'SVC'}</span>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(c.id); }} className="p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <h3 className="font-semibold text-gray-900 text-[15px] truncate">{c.service_name || c.service_name_fallback}</h3>
                  <p className="text-xl font-bold text-gray-900 mt-0.5">{formatETB(target)}</p>
                  {cardStart && cardEnd ? (
                    <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1">
                      <Calendar size={9} />
                      {formatDisplayDate(cardStart)} → {formatDisplayDate(cardEnd)}
                    </p>
                  ) : <div className="h-4" />}

                  {/* Achievement Progress Bar */}
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-gray-500 font-medium">ACHIEVEMENT</span>
                      <span className={`text-xs font-bold ${cardPctCls}`}>{achievement}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2.5">
                      <div
                        className={`h-2.5 rounded-full transition-all duration-700 ${cardBarCls}`}
                        style={{ width: `${progressWidth}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[10px] text-gray-400">Actual: {formatETB(actual)}</span>
                      <span className="text-[10px] text-gray-400">Target: {formatETB(target)}</span>
                    </div>
                  </div>

                  {/* Breakdown Summary — real monthly-prorated period targets */}
                  <div className="grid grid-cols-3 gap-2 text-center mt-3">
                    <div className="bg-blue-50 rounded-lg p-2">
                      <p className="text-[9px] text-blue-500 font-medium">Yearly</p>
                      <p className="text-[10px] font-bold text-blue-700">{formatETB(c.effective_yearly_target ?? target)}</p>
                    </div>
                    <div className="bg-purple-50 rounded-lg p-2">
                      <p className="text-[9px] text-purple-500 font-medium">Semi-Annual</p>
                      <p className="text-[10px] font-bold text-purple-700">{formatETB(c.effective_semi_target ?? target / 2)}</p>
                    </div>
                    <div className="bg-green-50 rounded-lg p-2">
                      <p className="text-[9px] text-green-500 font-medium">Quarterly</p>
                      <p className="text-[10px] font-bold text-green-700">{formatETB(c.effective_quarterly_target ?? target / 4)}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                    <span className="text-[10px] text-gray-400 capitalize">{c.cascade_method} split</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${c.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{c.status}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail Panel */}
      {selectedCascade && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          {detailLoading ? (
            <div className="text-center py-8 text-gray-500">Loading cascade details...</div>
          ) : (
            <CascadeDetail cascade={selectedCascade} />
          )}
        </div>
      )}

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Add Goal Cascade</h2>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Service *</label>
                <select required value={form.service_id} onChange={(e) => setForm({ ...form, service_id: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  <option value="">Select service</option>
                  {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Annual Target (ETB) *</label>
                <input required type="number" step="0.01" value={form.annual_target} onChange={(e) => setForm({ ...form, annual_target: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g., 50000000" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date *</label>
                  <input required type="date" value={form.target_start_date} onChange={(e) => setForm({ ...form, target_start_date: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date *</label>
                  <input required type="date" value={form.target_end_date} onChange={(e) => setForm({ ...form, target_end_date: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Split Method</label>
                <select value={form.cascade_method} onChange={(e) => setForm({ ...form, cascade_method: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  <option value="equal">Equal Distribution</option>
                  <option value="weighted">Weighted (seasonal)</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
                <button type="submit" className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-1"><Check size={14} /> Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============ CASCADE DETAIL ============ */
function CascadeDetail({ cascade }) {
  const [expandedS, setExpandedS] = useState({});
  const [expandedQ, setExpandedQ] = useState({});

  const yearly = cascade.yearly || [];
  const semiAnnual = cascade.semiAnnual || [];
  const quarterly = cascade.quarterly || [];

  const sWithQuarters = semiAnnual.map(s => ({
    ...s,
    quarters: quarterly.filter(q => q.parent_item_id === s.id),
  }));

  const toggleS = (id) => setExpandedS(prev => ({ ...prev, [id]: !prev[id] }));
  const toggleQ = (id) => setExpandedQ(prev => ({ ...prev, [id]: !prev[id] }));

  const getAchievementColor = (pct) => {
    if (pct >= 90) return 'text-emerald-700 bg-emerald-50 border-emerald-200';
    if (pct >= 70) return 'text-amber-700 bg-amber-50 border-amber-200';
    if (pct >= 50) return 'text-orange-700 bg-orange-50 border-orange-200';
    return 'text-red-700 bg-red-50 border-red-200';
  };

  const getProgressColor = (pct) => {
    if (pct >= 90) return 'bg-emerald-500';
    if (pct >= 70) return 'bg-amber-400';
    if (pct >= 50) return 'bg-orange-500';
    return 'bg-rose-500';
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-bold text-gray-900">{cascade.service_name || cascade.service_name_fallback}</h3>
          <p className="text-sm text-gray-500">Period Target: <span className="font-bold text-blue-700">{formatETB(cascade.annual_target)}</span></p>
          {cascade.target_start_date && cascade.target_end_date && (
            <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
              <Calendar size={10} />
              {formatDisplayDate(cascade.target_start_date)} → {formatDisplayDate(cascade.target_end_date)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium capitalize">{cascade.cascade_method} split</span>
        </div>
      </div>

      <div className="space-y-3">
        {/* Yearly Summary Bar */}
        {yearly.map(y => {
          const yPct = parseFloat(y.achievement_pct || 0);
          const yActual = parseFloat(y.actual_revenue || 0);
          return (
            <div key={y.id} className="bg-gradient-to-r from-blue-600 to-blue-800 text-white rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <Target size={20} />
                  <div>
                    <p className="text-sm font-medium opacity-90">Period Target — {y.period_label}</p>
                    <p className="text-2xl font-bold">{formatETB(y.target_amount)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs opacity-75">Actual Revenue</p>
                  <p className="text-lg font-bold">{formatETB(y.actual_revenue)}</p>
                </div>
              </div>
              <div className="mt-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs opacity-75">Achievement</span>
                  <span className="text-sm font-bold">{yPct.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-white/20 rounded-full h-3">
                  <div className={`h-3 rounded-full transition-all duration-1000 ${yPct >= 100 ? 'bg-green-400' : yPct >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                    style={{ width: `${Math.min(yPct, 100)}%` }} />
                </div>
              </div>
            </div>
          );
        })}

        {/* Semi-Annual Cards */}
        {sWithQuarters.map((s) => (
          <div key={s.id} className="border border-purple-200 rounded-xl overflow-hidden">
            <button
              onClick={() => toggleS(s.id)}
              className="w-full flex items-center justify-between p-4 bg-purple-50 hover:bg-purple-100 transition text-left"
            >
              <div className="flex items-center gap-3">
                {expandedS[s.id] ? <ChevronDown size={16} className="text-purple-600" /> : <ChevronRight size={16} className="text-purple-600" />}
                <div>
                  <p className="font-semibold text-gray-900">{s.period_label}</p>
                  <p className="text-xs text-gray-500">{formatDisplayDate(s.period_start)} → {formatDisplayDate(s.period_end)}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="font-bold text-purple-700">{formatETB(s.target_amount)}</p>
                </div>
                <div className="w-20">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[9px] text-gray-500">{parseFloat(s.achievement_pct || 0).toFixed(0)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full ${getProgressColor(parseFloat(s.achievement_pct || 0))}`}
                      style={{ width: `${Math.min(parseFloat(s.achievement_pct || 0), 100)}%` }} />
                  </div>
                </div>
              </div>
            </button>

            {expandedS[s.id] && (
              <div className="p-4 bg-white space-y-2">
                <div className="flex items-center gap-4 mb-2 px-4">
                  <div className="text-center">
                    <p className="text-[10px] text-gray-500">Target</p>
                    <p className="text-sm font-bold text-purple-700">{formatETB(s.target_amount)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-gray-500">Actual</p>
                    <p className={`text-sm font-bold ${parseFloat(s.achievement_pct || 0) >= 90 ? 'text-emerald-700' : parseFloat(s.achievement_pct || 0) >= 70 ? 'text-amber-700' : parseFloat(s.achievement_pct || 0) >= 50 ? 'text-orange-700' : 'text-red-700'}`}>
                      {formatETB(s.actual_revenue)}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-gray-500">Achievement</p>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${getAchievementColor(parseFloat(s.achievement_pct || 0))}`}>
                      {parseFloat(s.achievement_pct || 0).toFixed(1)}%
                    </span>
                  </div>
                </div>

                {s.quarters.map((q) => (
                  <div key={q.id} className="border border-green-200 rounded-lg overflow-hidden">
                    <button
                      onClick={() => toggleQ(q.id)}
                      className="w-full flex items-center justify-between p-3 bg-green-50 hover:bg-green-100 transition text-left"
                    >
                      <div className="flex items-center gap-2 ml-4">
                        {expandedQ[q.id] ? <ChevronDown size={14} className="text-green-600" /> : <ChevronRight size={14} className="text-green-600" />}
                        <div>
                          <p className="text-sm font-medium text-gray-900">{q.period_label}</p>
                          <p className="text-[10px] text-gray-500">{formatDisplayDate(q.period_start)} → {formatDisplayDate(q.period_end)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 mr-2">
                        <div className="text-right">
                          <p className="text-sm font-bold text-green-700">{formatETB(q.target_amount)}</p>
                        </div>
                        <div className="w-16">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-[9px] text-gray-500">{parseFloat(q.achievement_pct || 0).toFixed(0)}%</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-1.5">
                            <div className={`h-1.5 rounded-full ${getProgressColor(parseFloat(q.achievement_pct || 0))}`}
                              style={{ width: `${Math.min(parseFloat(q.achievement_pct || 0), 100)}%` }} />
                          </div>
                        </div>
                      </div>
                    </button>

                    {expandedQ[q.id] && (
                      <div className="p-3 bg-gray-50 ml-8 border-l-2 border-green-300">
                        <div className="grid grid-cols-3 gap-4">
                          <div className="text-center">
                            <p className="text-[10px] text-gray-500">Target</p>
                            <p className="text-sm font-bold text-green-700">{formatETB(q.target_amount)}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-[10px] text-gray-500">Actual</p>
                            <p className={`text-sm font-bold ${parseFloat(q.achievement_pct || 0) >= 90 ? 'text-emerald-700' : parseFloat(q.achievement_pct || 0) >= 70 ? 'text-amber-700' : parseFloat(q.achievement_pct || 0) >= 50 ? 'text-orange-700' : 'text-red-700'}`}>
                              {formatETB(q.actual_revenue)}
                            </p>
                          </div>
                          <div className="text-center">
                            <p className="text-[10px] text-gray-500">Achievement</p>
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${getAchievementColor(parseFloat(q.achievement_pct || 0))}`}>
                              {parseFloat(q.achievement_pct || 0).toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {semiAnnual.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-4">No cascade items generated</p>
        )}
      </div>

      {/* Summary Table */}
      <div className="mt-6 bg-gray-50 rounded-xl p-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">📋 Target Distribution Summary</h4>
        <div className="grid grid-cols-4 gap-4 text-center">
          <div>
            <p className="text-[10px] text-gray-500 font-medium">Yearly</p>
            <p className="text-sm font-bold text-gray-900">{formatETB(cascade.annual_target)}</p>
          </div>
          <div>
            <p className="text-[10px] text-purple-500 font-medium">Semi-Annual (avg)</p>
            <p className="text-sm font-bold text-purple-700">
              {formatETB(semiAnnual.length ? semiAnnual.reduce((s, x) => s + parseFloat(x.target_amount || 0), 0) / semiAnnual.length : cascade.annual_target / 2)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-green-500 font-medium">Quarterly (avg)</p>
            <p className="text-sm font-bold text-green-700">
              {formatETB(quarterly.length ? quarterly.reduce((s, x) => s + parseFloat(x.target_amount || 0), 0) / quarterly.length : cascade.annual_target / 4)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-blue-500 font-medium">Overall Achievement</p>
            {(() => {
              const pct = parseFloat(cascade.yearly?.[0]?.achievement_pct || 0);
              return <p className={`text-sm font-bold ${pct >= 100 ? 'text-green-700' : pct >= 50 ? 'text-amber-700' : 'text-red-700'}`}>{pct.toFixed(1)}%</p>;
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}
