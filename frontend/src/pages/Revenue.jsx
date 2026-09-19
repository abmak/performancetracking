import { useState, useEffect } from 'react';
import { Plus, Trash2, X, Check, Filter, Edit2 } from 'lucide-react';
import { revenueAPI, servicesAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { formatCurrency, MONTH_OPTIONS } from '../utils/helpers';
import toast from 'react-hot-toast';

// Helper: strip commas from number strings like "1,213,722.60" → "1213722.60"
function parseCommaNumber(v) {
  if (typeof v === 'number') return v;
  return parseFloat(String(v).replace(/,/g, '')) || 0;
}

export default function Revenue() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('revenue.edit');
  const canDelete = hasPermission('revenue.delete');
  const canCreate = hasPermission('revenue.create');
  const [revenue, setRevenue] = useState({ data: [], pagination: {} });
  const [services, setServices] = useState([]);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editRecord, setEditRecord] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [filters, setFilters] = useState(() => {
    const saved = localStorage.getItem('revenue_filters');
    return saved ? JSON.parse(saved) : { revenue_month: '2026-06', service_id: '', page: 1 };
  });
  const [form, setForm] = useState({ service_id: '', partner_name: '', amount: '', revenue_month: '2026-06', notes: '' });

  useEffect(() => { loadServices(); }, []);
  useEffect(() => { loadRevenue(); loadSummary(); }, [filters]);
  useEffect(() => { localStorage.setItem('revenue_filters', JSON.stringify(filters)); }, [filters]);

  async function loadServices() {
    try { setServices((await servicesAPI.getAll()).filter(s => s.status === 'active')); } catch { /* ignore */ }
  }

  async function loadRevenue() {
    setLoading(true);
    try {
      const params = { ...filters };
      Object.keys(params).forEach(k => { if (!params[k]) delete params[k]; });
      setRevenue(await revenueAPI.getAll(params));
    } catch (err) { toast.error('Failed to load revenue data'); }
    setLoading(false);
  }

  async function loadSummary() {
    try {
      const params = {};
      if (filters.revenue_month) params.revenue_month = filters.revenue_month;
      setSummary(await revenueAPI.getSummary(params));
    } catch { /* ignore */ }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      await revenueAPI.create({ ...form, service_id: parseInt(form.service_id), amount: parseCommaNumber(form.amount) });
      toast.success('Revenue entry added');
      setShowModal(false);
      setForm({ service_id: '', partner_name: '', amount: '', revenue_month: filters.revenue_month || '2026-06', notes: '' });
      loadRevenue();
      loadSummary();
    } catch (err) { toast.error(err.message); }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this revenue entry?')) return;
    try { await revenueAPI.delete(id); toast.success('Entry deleted'); loadRevenue(); loadSummary(); } catch (err) { toast.error(err.message); }
  }

  function startEdit(record) {
    setEditRecord(record);
    setEditForm({
      service_id: record.service_id,
      partner_name: record.partner_name || '',
      amount: record.amount,
      revenue_month: record.revenue_month,
      notes: record.notes || '',
    });
  }

  async function handleSaveEdit() {
    try {
      await revenueAPI.update(editRecord.id, {
        ...editForm,
        service_id: parseInt(editForm.service_id),
        amount: parseCommaNumber(editForm.amount),
      });
      toast.success('Entry updated');
      setEditRecord(null);
      loadRevenue();
      loadSummary();
    } catch (err) { toast.error(err.message); }
  }

  // Summary totals
  const totalRevenue = summary.reduce((s, r) => s + parseFloat(r.total_revenue || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Revenue Data</h1>
          <p className="text-sm text-gray-500">Monthly revenue entries by service</p>
        </div>
        {canCreate && (
          <button onClick={() => setShowModal(true)} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
            <Plus size={16} /> Add Entry
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <Filter size={16} className="text-gray-400" />
          <select value={filters.revenue_month} onChange={(e) => setFilters({ ...filters, revenue_month: e.target.value, page: 1 })} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All Months</option>
            {MONTH_OPTIONS.map(m => (
              <option key={m} value={m}>{new Date(m + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</option>
            ))}
          </select>
          <select value={filters.service_id} onChange={(e) => setFilters({ ...filters, service_id: e.target.value, page: 1 })} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All Services</option>
            {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <span className="ml-auto text-sm text-gray-500">
            Total: <span className="font-bold text-blue-600">{formatCurrency(totalRevenue)}</span>
            <span className="mx-2">·</span>
            {revenue.pagination?.total || 0} entries
          </span>
        </div>
      </div>

      {/* Summary by Service */}
      {summary.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Revenue Summary by Service</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {summary.filter(s => parseFloat(s.total_revenue) > 0).map((s, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <div className="text-sm font-medium text-gray-900">{s.service_name}</div>
                  <div className="text-xs text-gray-500">{s.entry_count} entries</div>
                </div>
                <div className="text-sm font-semibold text-gray-900">{formatCurrency(s.total_revenue)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Revenue Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-3 px-4 font-semibold text-gray-600">Month</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-600">Service</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-600">Partner</th>
                <th className="text-right py-3 px-4 font-semibold text-gray-600">Amount</th>
                <th className="text-center py-3 px-4 font-semibold text-gray-600">Source</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-600">Notes</th>
                <th className="text-center py-3 px-4 font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">Loading...</td></tr>
              ) : revenue.data?.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">No revenue entries found</td></tr>
              ) : (
                revenue.data?.map((r) => (
                  <tr key={r.id} className="border-t border-gray-50 hover:bg-gray-50">
                    <td className="py-3 px-4 text-gray-900 font-medium">{r.revenue_month || '-'}</td>
                    <td className="py-3 px-4">
                      <span className="font-medium">{r.service_name}</span>
                      <span className="text-xs text-gray-500 ml-1">({r.service_code})</span>
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600">{r.partner_name || '-'}</td>
                    <td className="text-right py-3 px-4 font-semibold text-gray-900">{formatCurrency(r.amount)}</td>
                    <td className="text-center py-3 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.source === 'excel_import' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                        {r.source === 'excel_import' ? 'Excel' : 'Manual'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-500 text-xs max-w-[200px] truncate">{r.notes}</td>
                    <td className="text-center py-3 px-4">
                      <div className="flex items-center justify-center gap-1">
                        {canEdit && <button onClick={() => startEdit(r)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-blue-600"><Edit2 size={14} /></button>}
                        {canDelete && <button onClick={() => handleDelete(r.id)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        {revenue.pagination?.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <span className="text-sm text-gray-500">Page {revenue.pagination.page} of {revenue.pagination.pages}</span>
            <div className="flex gap-2">
              <button disabled={filters.page <= 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })} className="px-3 py-1 text-sm border rounded-lg disabled:opacity-50 hover:bg-gray-50">Previous</button>
              <button disabled={filters.page >= revenue.pagination.pages} onClick={() => setFilters({ ...filters, page: filters.page + 1 })} className="px-3 py-1 text-sm border rounded-lg disabled:opacity-50 hover:bg-gray-50">Next</button>
            </div>
          </div>
        )}
      </div>

      {/* Modal - Monthly Entry */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Add Revenue Entry</h2>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Service *</label>
                <select required value={form.service_id} onChange={(e) => setForm({ ...form, service_id: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  <option value="">Select a service</option>
                  {services.map(s => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Partner Name</label>
                <input value={form.partner_name} onChange={(e) => setForm({ ...form, partner_name: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g., Credoks Digital Service PLC" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (ETB) *</label>
                <input required type="text" inputMode="decimal" value={form.amount} onChange={(e) => {
                  // Strip non-numeric chars except digits, dots, and commas
                  const raw = e.target.value.replace(/[^0-9.,]/g, '');
                  setForm({ ...form, amount: raw });
                }} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g., 2,500,000" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Revenue Month *</label>
                <select required value={form.revenue_month} onChange={(e) => setForm({ ...form, revenue_month: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {MONTH_OPTIONS.map(m => (
                    <option key={m} value={m}>{new Date(m + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Optional notes" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
                <button type="submit" className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-1"><Check size={14} /> Add Entry</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editRecord && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Edit Revenue Entry</h2>
              <button onClick={() => setEditRecord(null)} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Service</label>
                <select value={editForm.service_id || ''} onChange={(e) => setEditForm({ ...editForm, service_id: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  <option value="">Select service</option>
                  {services.map(s => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Partner Name</label>
                <input value={editForm.partner_name || ''} onChange={(e) => setEditForm({ ...editForm, partner_name: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Optional" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (ETB)</label>
                <input type="text" inputMode="decimal" value={editForm.amount || ''} onChange={(e) => {
                  const raw = e.target.value.replace(/[^0-9.,]/g, '');
                  setEditForm({ ...editForm, amount: raw });
                }} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Revenue Month</label>
                <select value={editForm.revenue_month || ''} onChange={(e) => setEditForm({ ...editForm, revenue_month: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {MONTH_OPTIONS.map(m => (
                    <option key={m} value={m}>{new Date(m + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <input value={editForm.notes || ''} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Optional" />
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
