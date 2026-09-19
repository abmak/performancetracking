import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, X, Check, Filter, Lightbulb, Target, Handshake, Tag, Megaphone, Wrench, Clock, ArrowRight, Play, CheckCircle2, Ban, RotateCcw, ChevronRight, Calendar, User, FileText, XCircle, ListTodo, AlertTriangle, CheckCircle, Circle, MessageCircle, Send } from 'lucide-react';
import { actionsAPI, servicesAPI, actionTasksAPI, usersAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { MONTH_OPTIONS } from '../utils/helpers';
import toast from 'react-hot-toast';

const formatETB = (amount) => {
  if (amount >= 1e9) return `ETB ${(amount / 1e9).toFixed(2)}B`;
  if (amount >= 1e6) return `ETB ${(amount / 1e6).toFixed(2)}M`;
  if (amount >= 1e3) return `ETB ${(amount / 1e3).toFixed(1)}K`;
  return `ETB ${amount.toLocaleString()}`;
};

const ACTION_TYPES = [
  { value: 'strategy', label: 'Strategy', icon: Target, color: 'bg-blue-100 text-blue-700' },
  { value: 'campaign', label: 'Campaign', icon: Megaphone, color: 'bg-purple-100 text-purple-700' },
  { value: 'partnership', label: 'Partnership', icon: Handshake, color: 'bg-green-100 text-green-700' },
  { value: 'pricing', label: 'Pricing', icon: Tag, color: 'bg-amber-100 text-amber-700' },
  { value: 'promotion', label: 'Promotion', icon: Lightbulb, color: 'bg-cyan-100 text-cyan-700' },
  { value: 'technical', label: 'Technical', icon: Wrench, color: 'bg-gray-100 text-gray-700' },
  { value: 'other', label: 'Other', icon: Target, color: 'bg-red-100 text-red-700' },
];

const STATUS_CONFIG = {
  planned: { label: 'Planned', icon: Clock, color: 'bg-yellow-100 text-yellow-700 border-yellow-300', dot: 'bg-yellow-500', ring: 'ring-yellow-200' },
  in_progress: { label: 'In Progress', icon: Play, color: 'bg-blue-100 text-blue-700 border-blue-300', dot: 'bg-blue-500', ring: 'ring-blue-200' },
  completed: { label: 'Completed', icon: CheckCircle2, color: 'bg-green-100 text-green-700 border-green-300', dot: 'bg-green-500', ring: 'ring-green-200' },
  cancelled: { label: 'Cancelled', icon: Ban, color: 'bg-gray-100 text-gray-500 border-gray-300', dot: 'bg-gray-400', ring: 'ring-gray-200' },
  expired: { label: 'Expired', icon: XCircle, color: 'bg-red-100 text-red-700 border-red-300', dot: 'bg-red-500', ring: 'ring-red-200' },
};

const PRIORITY_CONFIG = {
  low: { label: 'Low', color: 'bg-gray-100 text-gray-600' },
  medium: { label: 'Medium', color: 'bg-blue-100 text-blue-600' },
  high: { label: 'High', color: 'bg-orange-100 text-orange-600' },
  critical: { label: 'Critical', color: 'bg-red-100 text-red-600' },
};

const WORKFLOW_STEPS = ['planned', 'in_progress', 'completed'];

const TRANSITION_LABELS = {
  in_progress: { label: 'Start Progress', icon: Play, color: 'bg-blue-600 hover:bg-blue-700' },
  completed: { label: 'Mark Complete', icon: CheckCircle2, color: 'bg-green-600 hover:bg-green-700' },
  cancelled: { label: 'Cancel', icon: Ban, color: 'bg-gray-500 hover:bg-gray-600' },
  planned: { label: 'Reopen', icon: RotateCcw, color: 'bg-yellow-600 hover:bg-yellow-700' },
  expired: { label: 'Mark Expired', icon: XCircle, color: 'bg-red-600 hover:bg-red-700' },
};

export default function ActionNotes() {
  const { user } = useAuth();
  const [actions, setActions] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showDetail, setShowDetail] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [filters, setFilters] = useState({ action_type: '', status: '', revenue_month: '' });
  const [form, setForm] = useState({
    service_name: '', action_type: 'strategy', title: '', description: '',
    expected_impact: '', revenue_month: '2026-05', status: 'planned',
    priority: 'medium', target_date: '',
  });

  useEffect(() => { loadServices(); }, []);
  useEffect(() => { loadActions(); }, [filters]);

  async function loadServices() {
    try { setServices((await servicesAPI.getAll()).filter(s => s.status === 'active')); } catch { /* ignore */ }
  }

  async function loadActions() {
    setLoading(true);
    try {
      const params = {};
      Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
      setActions(await actionsAPI.getAll(params));
    } catch (err) { toast.error('Failed to load actions'); }
    setLoading(false);
  }

  function openCreate() {
    setForm({
      service_name: '', action_type: 'strategy', title: '', description: '',
      expected_impact: '', revenue_month: '2026-05', status: 'planned',
      priority: 'medium', target_date: '',
    });
    setEditingId(null);
    setShowModal(true);
  }

  function openEdit(a) {
    setForm({
      service_name: a.service_name || '', action_type: a.action_type, title: a.title,
      description: a.description || '', expected_impact: a.expected_impact || '',
      actual_impact: a.actual_impact || '', revenue_month: a.revenue_month || '',
      status: a.status, priority: a.priority || 'medium',
      target_date: a.target_date ? a.target_date.substring(0, 10) : '',
    });
    setEditingId(a.id);
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      if (editingId) {
        await actionsAPI.update(editingId, form);
        toast.success('Action updated');
      } else {
        await actionsAPI.create({
          ...form,
          created_by: user?.full_name || user?.username || 'Admin',
          created_by_id: user?.id || null,
        });
        toast.success('Action created');
      }
      setShowModal(false);
      loadActions();
      if (showDetail) loadDetail(showDetail.id);
    } catch (err) { toast.error(err.message); }
  }

  async function handleTransition(action, newStatus) {
    const labels = {
      in_progress: 'start progress on',
      completed: 'complete',
      cancelled: 'cancel',
      planned: 'reopen',
    };
    if (newStatus === 'cancelled') {
      setCancelTarget(action);
      setCancelReason('');
      return;
    }
    if (!confirm(`Are you sure you want to ${labels[newStatus] || 'update'} this action?`)) return;

    try {
      const result = await actionsAPI.transition(action.id, {
        new_status: newStatus,
        changed_by: user?.full_name || user?.username || 'Admin',
        note: `Status changed to ${newStatus.replace('_', ' ')}`,
      });
      toast.success(`Action ${labels[newStatus] || 'updated'}`);
      loadActions();
      if (showDetail && showDetail.id === action.id) {
        setShowDetail(result);
      }
    } catch (err) { toast.error(err.message); }
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    if (!cancelReason.trim()) {
      toast.error('Please provide a reason for cancellation');
      return;
    }
    setCancelling(true);
    try {
      const result = await actionsAPI.transition(cancelTarget.id, {
        new_status: 'cancelled',
        changed_by: user?.full_name || user?.username || 'Admin',
        cancel_reason: cancelReason.trim(),
        note: `Cancelled: ${cancelReason.trim()}`,
      });
      toast.success('Action cancelled');
      setCancelTarget(null);
      setCancelReason('');
      loadActions();
      if (showDetail && showDetail.id === cancelTarget.id) {
        setShowDetail(result);
      }
    } catch (err) { toast.error(err.message); }
    setCancelling(false);
  }

  async function handleDelete(id) {
    if (!confirm('Delete this action note permanently?')) return;
    try {
      await actionsAPI.delete(id);
      toast.success('Deleted');
      setShowDetail(null);
      loadActions();
    } catch (err) { toast.error(err.message); }
  }

  async function loadDetail(action) {
    try {
      const detail = await actionsAPI.getOne(action.id);
      setShowDetail(detail);
    } catch (err) {
      toast.error('Failed to load action details');
    }
  }

  const getActionTypeInfo = (type) => ACTION_TYPES.find(t => t.value === type) || ACTION_TYPES[0];

  // Status summary counts
  const statusCounts = {
    planned: actions.filter(a => a.status === 'planned').length,
    in_progress: actions.filter(a => a.status === 'in_progress').length,
    completed: actions.filter(a => a.status === 'completed').length,
    cancelled: actions.filter(a => a.status === 'cancelled').length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Action Notes</h1>
          <p className="text-sm text-gray-500">Track revenue enhancement actions through their lifecycle</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
          <Plus size={16} /> Add Action
        </button>
      </div>

      {/* Workflow Pipeline Overview */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between">
          {WORKFLOW_STEPS.map((step, i) => {
            const cfg = STATUS_CONFIG[step];
            const Icon = cfg.icon;
            return (
              <div key={step} className="flex items-center">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${cfg.color} border`}>
                    <Icon size={18} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{cfg.label}</p>
                    <p className="text-2xl font-bold text-gray-900">{statusCounts[step]}</p>
                  </div>
                </div>
                {i < WORKFLOW_STEPS.length - 1 && (
                  <div className="flex items-center mx-6">
                    <div className="w-16 h-0.5 bg-gray-300" />
                    <ArrowRight size={16} className="text-gray-400 -ml-1" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <Filter size={16} className="text-gray-400" />
          <select value={filters.action_type} onChange={(e) => setFilters({ ...filters, action_type: e.target.value })} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All Types</option>
            {ACTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All Status</option>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={filters.revenue_month} onChange={(e) => setFilters({ ...filters, revenue_month: e.target.value })} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All Months</option>
            {MONTH_OPTIONS.map(m => (
              <option key={m} value={m}>{new Date(m + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</option>
            ))}
          </select>
          <span className="ml-auto text-sm text-gray-500">{actions.length} actions</span>
        </div>
      </div>

      {/* Action Cards */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : actions.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
          <Lightbulb size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">No action notes yet. Add your first revenue enhancement action!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {actions.map((a) => {
            const typeInfo = getActionTypeInfo(a.action_type);
            const TypeIcon = typeInfo.icon;
            const statusCfg = STATUS_CONFIG[a.status] || STATUS_CONFIG.planned;
            const StatusIcon = statusCfg.icon;
            const priorityCfg = PRIORITY_CONFIG[a.priority] || PRIORITY_CONFIG.medium;

            return (
              <div
                key={a.id}
                onClick={() => loadDetail(a)}
                className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 hover:shadow-md transition cursor-pointer group"
              >
                {/* Top row: type + status + priority */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeInfo.color}`}>
                      {typeInfo.label}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${priorityCfg.color}`}>
                      {priorityCfg.label}
                    </span>
                  </div>
                  <ChevronRight size={16} className="text-gray-400 group-hover:text-blue-500 transition" />
                </div>

                {/* Title */}
                <h3 className="font-semibold text-gray-900 mb-1">{a.title}</h3>
                {a.service_name && <p className="text-xs text-blue-600 mb-2">Service: {a.service_name}</p>}
                {a.description && <p className="text-sm text-gray-600 mb-3 line-clamp-2">{a.description}</p>}

                {/* Created by */}
                <div className="flex items-center gap-2 mb-2">
                  {a.created_by_avatar ? (
                    <img src={a.created_by_avatar} alt="" className="w-5 h-5 rounded-full object-cover" />
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-bold">
                      {(a.created_by_name || a.created_by || '?').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="text-[11px] text-gray-500">
                    Created by <span className="font-medium text-gray-700">{a.created_by_name || a.created_by || 'Unknown'}</span>
                    {a.created_at && <span className="text-gray-400"> · {new Date(a.created_at).toLocaleDateString()}</span>}
                  </span>
                </div>

                {/* Workflow Progress Bar */}
                <div className="mb-3">
                  <div className="flex items-center gap-1">
                    {WORKFLOW_STEPS.map((step, i) => {
                      const stepCfg = STATUS_CONFIG[step];
                      const stepIndex = WORKFLOW_STEPS.indexOf(step);
                      const statusIndex = WORKFLOW_STEPS.indexOf(a.status);
                      const isExpired = a.status === 'expired';
                      const isCancelled = a.status === 'cancelled';
                      const isActive = !isExpired && !isCancelled && statusIndex >= stepIndex;
                      const isCurrent = a.status === step;
                      return (
                        <div key={step} className="flex items-center flex-1">
                          <div className={`w-full h-2 rounded-full transition-all ${
                            isExpired ? 'bg-red-200'
                              : isCancelled ? 'bg-gray-200'
                              : isActive ? stepCfg.dot
                              : 'bg-gray-200'
                          } ${isCurrent ? 'ring-2 ring-offset-1 ' + stepCfg.ring : ''}`} />
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-between mt-1">
                    {WORKFLOW_STEPS.map(step => (
                      <span key={step} className={`text-[10px] ${
                        a.status === step ? 'font-bold text-gray-800'
                          : a.status === 'expired' ? 'text-red-400'
                          : 'text-gray-400'
                      }`}>{STATUS_CONFIG[step].label}</span>
                    ))}
                    {a.status === 'expired' && (
                      <span className="text-[10px] font-bold text-red-600">Expired</span>
                    )}
                  </div>
                </div>

                {/* Expected Impact */}
                {a.expected_impact && (
                  <div className="bg-green-50 rounded-lg p-2 mb-2">
                    <p className="text-xs text-green-700"><span className="font-medium">Expected:</span> {a.expected_impact}</p>
                  </div>
                )}

                {/* Actual Impact */}
                {a.actual_impact && (
                  <div className="bg-blue-50 rounded-lg p-2 mb-2">
                    <p className="text-xs text-blue-700"><span className="font-medium">Actual:</span> {a.actual_impact}</p>
                  </div>
                )}

                {/* Revenue Change */}
                {a.revenue_change && (
                  <div className={`rounded-lg p-2 mb-2 border ${
                    a.revenue_change.direction === 'increase' ? 'bg-emerald-50 border-emerald-200' :
                    a.revenue_change.direction === 'decrease' ? 'bg-red-50 border-red-200' :
                    'bg-gray-50 border-gray-200'
                  }`}>
                    <p className={`text-xs font-semibold ${
                      a.revenue_change.direction === 'increase' ? 'text-emerald-700' :
                      a.revenue_change.direction === 'decrease' ? 'text-red-700' : 'text-gray-600'
                    }`}>
                      {a.revenue_change.direction === 'increase' ? '📈 Revenue +' :
                       a.revenue_change.direction === 'decrease' ? '📉 Revenue ' : '➡️ Revenue '}
                      {formatETB(Math.abs(a.revenue_change.change))}
                      {a.revenue_change.change_pct != null && (
                        <span className="text-[10px] ml-1">({a.revenue_change.change >= 0 ? '+' : ''}{a.revenue_change.change_pct}%)</span>
                      )}
                      <span className="text-[10px] text-gray-400 ml-1">vs {new Date(a.revenue_change.previous_month + '-01').toLocaleDateString('en-US', { month: 'short' })}</span>
                    </p>
                  </div>
                )}

                {/* Cancel reason */}
                {a.status === 'cancelled' && a.cancel_reason && (
                  <div className="bg-red-50 rounded-lg p-2 mb-2 border border-red-200">
                    <p className="text-xs text-red-700"><span className="font-medium">Cancelled:</span> {a.cancel_reason}</p>
                  </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <Calendar size={10} /> {a.revenue_month || 'No period'}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {a.action_caused_change && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200">✅ Confirmed</span>
                    )}
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusCfg.color}`}>
                      {statusCfg.label}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail Modal (Full Workflow View) */}
      {showDetail && (
        <ActionDetailModal
          action={showDetail}
          onClose={() => setShowDetail(null)}
          onTransition={handleTransition}
          onEdit={openEdit}
          onDelete={handleDelete}
          onUpdate={setShowDetail}
        />
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">{editingId ? 'Edit Action' : 'Add Action Note'}</h2>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g., Launch CRBT Summer Promotion" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Service</label>
                  <select value={form.service_name} onChange={(e) => setForm({ ...form, service_name: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                    <option value="">All Services</option>
                    {services.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Action Type</label>
                  <select value={form.action_type} onChange={(e) => setForm({ ...form, action_type: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                    {ACTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                    {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Target Date</label>
                  <input type="date" value={form.target_date} onChange={(e) => setForm({ ...form, target_date: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" rows={3} placeholder="Describe the action taken or planned..." />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Expected Impact</label>
                <input value={form.expected_impact} onChange={(e) => setForm({ ...form, expected_impact: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g., Increase CRBT revenue by 20%" />
              </div>
              {editingId && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Actual Impact</label>
                  <input value={form.actual_impact || ''} onChange={(e) => setForm({ ...form, actual_impact: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Record actual outcome" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Revenue Period</label>
                  <select value={form.revenue_month} onChange={(e) => setForm({ ...form, revenue_month: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                    <option value="">No period</option>
                    {MONTH_OPTIONS.map(m => <option key={m} value={m}>{new Date(m + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                    {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
                <button type="submit" className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-1"><Check size={14} /> {editingId ? 'Update' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cancel Action — Reason Modal */}
      {cancelTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Ban size={18} className="text-red-600" /> Cancel Action
              </h2>
              <button onClick={() => setCancelTarget(null)} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              You are cancelling <span className="font-semibold text-gray-800">"{cancelTarget.title}"</span>. Please provide a reason — it will be recorded and shown on the action.
            </p>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Reason for cancellation (required)..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200"
            />
            <div className="flex justify-end gap-3 mt-4">
              <button
                type="button"
                onClick={() => setCancelTarget(null)}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Keep Action
              </button>
              <button
                type="button"
                onClick={confirmCancel}
                disabled={cancelling || !cancelReason.trim()}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-1"
              >
                <Ban size={14} /> {cancelling ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============ CAUSED CHANGE CHECKBOX WITH SAVE ============ */
function ActionCausedChangeBox({ action, onUpdate }) {
  const [pending, setPending] = useState(action.action_caused_change === true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setPending(action.action_caused_change === true);
    setSaved(false);
  }, [action.action_caused_change]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const val = pending ? true : null;
      await actionsAPI.toggleCausedChange(action.id, val);
      if (onUpdate) onUpdate(prev => ({ ...prev, action_caused_change: val }));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = pending !== (action.action_caused_change === true);

  return (
    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={pending}
            onChange={(e) => { setPending(e.target.checked); setSaved(false); }}
            className="w-5 h-5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
          />
          <div>
            <span className="text-sm font-semibold text-gray-800">The action made this change</span>
            <p className="text-xs text-gray-500 mt-0.5">Confirm if this action directly caused the revenue change during its period</p>
          </div>
        </label>
        <button
          onClick={handleSave}
          disabled={!hasChanges || saving}
          className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            !hasChanges
              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
              : saving
                ? 'bg-emerald-400 text-white cursor-wait'
                : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm'
          }`}
        >
          {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save'}
        </button>
      </div>
      {action.action_caused_change === true && (
        <div className="mt-2 ml-8 text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full font-medium inline-block">✅ Confirmed — action contributed to revenue change</div>
      )}
      {action.action_caused_change === false && (
        <div className="mt-2 ml-8 text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded-full font-medium inline-block">❌ Not related — revenue change is from other factors</div>
      )}
    </div>
  );
}

/* ============ TASK PANEL ============ */
function TaskPanel({ action, onUpdate }) {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ title: '', description: '', assigned_to: '', due_date: '', priority: 'medium' });

  useEffect(() => { loadTasks(); loadUsers(); }, [action.id]);

  async function loadTasks() {
    try {
      const data = await actionTasksAPI.getByAction(action.id);
      setTasks(data);
    } catch { /* */ }
    setLoading(false);
  }

  async function loadUsers() {
    try {
      const data = await usersAPI.getAll();
      setUsers(data);
    } catch { /* */ }
  }

  async function handleAdd(e) {
    e.preventDefault();
    try {
      const assignee = users.find(u => u.id == form.assigned_to);
      await actionTasksAPI.create({
        action_id: action.id,
        ...form,
        assigned_to: form.assigned_to ? parseInt(form.assigned_to) : null,
        assigned_to_name: assignee?.full_name || null,
        assigned_by: user?.full_name || user?.username || 'System',
        assigned_by_id: user?.id || null,
      });
      toast.success('Task assigned');
      setShowAdd(false);
      setForm({ title: '', description: '', assigned_to: '', due_date: '', priority: 'medium' });
      loadTasks();
    } catch (err) { toast.error(err.message); }
  }

  async function handleStatus(taskId, status) {
    try {
      await actionTasksAPI.updateStatus(taskId, status);
      toast.success(`Task marked as ${status}`);
      loadTasks();
    } catch (err) { toast.error(err.message); }
  }

  // Only the assigned user (the task owner) can complete the task
  const isTaskOwner = (task) => !!user?.id && user.id === task.assigned_to;
  // The assigner / action creator / admin (and the owner) may delete a task
  const canManageTask = (task) => {
    if (!user?.id) return false;
    return (
      user.id === task.assigned_to ||
      user.id === task.assigned_by_id ||
      user.id === action.created_by_id ||
      user.role_scope === 'GLOBAL'
    );
  };

  async function handleDeleteTask(taskId) {
    if (!confirm('Delete this task?')) return;
    try {
      await actionTasksAPI.delete(taskId);
      toast.success('Task deleted');
      loadTasks();
    } catch (err) { toast.error(err.message); }
  }

  const TASK_STATUS = {
    pending: { icon: Circle, color: 'text-gray-400', bg: 'bg-gray-100', label: 'Pending' },
    in_progress: { icon: Play, color: 'text-blue-500', bg: 'bg-blue-100', label: 'In Progress' },
    completed: { icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-100', label: 'Done' },
    cancelled: { icon: Ban, color: 'text-red-400', bg: 'bg-red-100', label: 'Cancelled' },
  };
  const PRIORITY_COLORS = {
    low: 'bg-gray-100 text-gray-600',
    medium: 'bg-blue-100 text-blue-600',
    high: 'bg-orange-100 text-orange-600',
    critical: 'bg-red-100 text-red-600',
  };

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  const overdueTasks = tasks.filter(t => t.due_date && new Date(t.due_date) < new Date() && t.status !== 'completed' && t.status !== 'cancelled').length;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ListTodo size={16} className="text-blue-600" />
          <h4 className="text-sm font-semibold text-gray-800">Task Assignment</h4>
          {totalTasks > 0 && (
            <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
              {completedTasks}/{totalTasks} done
            </span>
          )}
          {overdueTasks > 0 && (
            <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-0.5">
              <AlertTriangle size={10} /> {overdueTasks} overdue
            </span>
          )}
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus size={12} /> Assign Task
        </button>
      </div>

      {/* Progress bar */}
      {totalTasks > 0 && (
        <div className="mb-3">
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-[10px] text-gray-500 mt-1 text-right">{progress}% complete</p>
        </div>
      )}

      {/* Add Task Form */}
      {showAdd && (
        <form onSubmit={handleAdd} className="bg-white rounded-lg p-3 mb-3 border border-blue-200 space-y-2">
          <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" placeholder="Task title" />
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" rows={2} placeholder="Description (optional)" />
          <div className="grid grid-cols-3 gap-2">
            <select value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs">
              <option value="">Unassigned</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
            <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs" />
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowAdd(false)} className="px-3 py-1 text-xs text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
            <button type="submit" className="px-3 py-1 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-700">Assign</button>
          </div>
        </form>
      )}

      {/* Task List */}
      {loading ? (
        <p className="text-xs text-gray-400">Loading tasks...</p>
      ) : tasks.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-3">No tasks assigned yet. Click "Assign Task" to add one.</p>
      ) : (
        <div className="space-y-3">
          {tasks.map(task => {
            const cfg = TASK_STATUS[task.status] || TASK_STATUS.pending;
            const TaskIcon = cfg.icon;
            const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'completed' && task.status !== 'cancelled';
            const isOwner = isTaskOwner(task);
            const canManage = canManageTask(task);
            return (
              <div key={task.id} className={`bg-white rounded-lg p-3 border ${isOverdue ? 'border-red-300' : 'border-gray-200'}`}>
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 p-1 rounded ${cfg.bg}`}>
                    <TaskIcon size={14} className={cfg.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-medium ${task.status === 'completed' ? 'line-through text-gray-400' : 'text-gray-900'}`}>{task.title}</p>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium}`}>{task.priority}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
                    </div>
                    {task.description && <p className="text-xs text-gray-500 mt-0.5 truncate">{task.description}</p>}
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      <span className="text-[10px] text-gray-500 flex items-center gap-1">
                        <User size={10} />
                        <span className="text-gray-400">Assigned by</span>
                        <span className="font-medium text-gray-600">{task.assigner_name || task.assigned_by || '—'}</span>
                        <span className="text-gray-400">→ to</span>
                        <span className="font-medium text-gray-600">{task.assignee_name || 'Unassigned'}</span>
                      </span>
                      {task.due_date && (
                        <span className={`text-[10px] flex items-center gap-0.5 ${isOverdue ? 'text-red-600 font-bold' : 'text-gray-400'}`}>
                          <Calendar size={10} /> Due {new Date(task.due_date).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {isOwner && task.status !== 'completed' && task.status !== 'cancelled' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleStatus(task.id, 'completed'); }}
                        className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-green-600 text-white rounded-lg hover:bg-green-700"
                        title="Mark task complete"
                      >
                        <CheckCircle size={12} /> Complete
                      </button>
                    )}
                    {!isOwner && task.status !== 'completed' && task.status !== 'cancelled' && task.assigned_to && (
                      <span
                        className="px-2.5 py-1 text-[11px] font-medium bg-gray-100 text-gray-400 rounded-lg"
                        title="Only the assigned user can complete this task"
                      >
                        Awaiting assignee
                      </span>
                    )}
                    {canManage && (
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.id); }}
                        className="p-1 text-gray-400 hover:text-red-500 transition">
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
                {/* Per-task discussion thread */}
                <TaskReplies actionId={action.id} taskId={task.id} taskTitle={task.title} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============ PER-TASK REPLY THREAD ============ */
function TaskReplies({ actionId, taskId, taskTitle }) {
  const { user } = useAuth();
  const [replies, setReplies] = useState([]);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState(false);

  async function loadReplies() {
    try {
      const data = await actionsAPI.getReplies(actionId, taskId);
      setReplies(data);
    } catch { /* */ }
  }

  useEffect(() => { if (open) loadReplies(); }, [actionId, taskId, open]);

  async function handleSend(e) {
    e.preventDefault();
    if (!message.trim()) return;
    if (!user?.id) { toast.error('Please sign in to reply'); return; }
    setSending(true);
    try {
      await actionsAPI.addReply(actionId, { user_id: user.id, task_id: taskId, message: message.trim() });
      setMessage('');
      loadReplies();
      toast.success('Reply posted');
    } catch (err) { toast.error(err.message); }
    setSending(false);
  }

  return (
    <div className="mt-2.5 pt-2.5 border-t border-gray-100">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500 hover:text-blue-600 transition"
      >
        <MessageCircle size={12} />
        {replies.length > 0 ? `${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}` : 'Reply'}
        <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {replies.length === 0 ? (
              <p className="text-[11px] text-gray-400">No replies on this task yet.</p>
            ) : replies.map(r => (
              <div key={r.id} className="flex items-start gap-2">
                {r.user_avatar ? (
                  <img src={r.user_avatar} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-bold shrink-0">
                    {(r.user_name || '?').charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[11px] font-semibold text-gray-800">{r.user_name || 'User'}</span>
                    <span className="text-[9px] text-gray-400">{r.created_at ? new Date(r.created_at).toLocaleString() : ''}</span>
                  </div>
                  <p className="text-[11px] text-gray-600 whitespace-pre-wrap break-words">{r.message}</p>
                </div>
              </div>
            ))}
          </div>
          <form onSubmit={handleSend} className="flex gap-2">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={`Reply on "${taskTitle}"…`}
              className="flex-1 border border-gray-300 rounded-lg px-2.5 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            <button
              type="submit"
              disabled={sending || !message.trim()}
              className="px-3 py-1.5 text-[11px] bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
            >
              <Send size={10} /> Send
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

/* ============ ACTION REPLIES (discussion) ============ */
function ActionReplies({ action }) {
  const { user } = useAuth();
  const [replies, setReplies] = useState([]);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => { loadReplies(); }, [action.id]);

  async function loadReplies() {
    try {
      const data = await actionsAPI.getReplies(action.id);
      setReplies(data);
    } catch { /* */ }
  }

  async function handleSend(e) {
    e.preventDefault();
    if (!message.trim()) return;
    if (!user?.id) { toast.error('Please sign in to reply'); return; }
    setSending(true);
    try {
      await actionsAPI.addReply(action.id, { user_id: user.id, message: message.trim() });
      setMessage('');
      loadReplies();
      toast.success('Reply posted');
    } catch (err) { toast.error(err.message); }
    setSending(false);
  }

  return (
    <div className="bg-white rounded-lg p-4 border border-gray-200">
      <div className="flex items-center gap-2 mb-3">
        <MessageCircle size={16} className="text-green-600" />
        <h4 className="text-sm font-semibold text-gray-800">Discussion / Replies</h4>
        {replies.length > 0 && (
          <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">{replies.length}</span>
        )}
      </div>

      <div className="space-y-3 max-h-64 overflow-y-auto mb-3">
        {replies.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-3">No replies yet — the assigner and assigned users can discuss the action here.</p>
        ) : replies.map(r => (
          <div key={r.id} className="flex items-start gap-2.5">
            {r.user_avatar ? (
              <img src={r.user_avatar} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold shrink-0">
                {(r.user_name || '?').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold text-gray-800">{r.user_name || 'User'}</span>
                <span className="text-[10px] text-gray-400">{r.created_at ? new Date(r.created_at).toLocaleString() : ''}</span>
              </div>
              <p className="text-xs text-gray-600 mt-0.5 whitespace-pre-wrap break-words">{r.message}</p>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={handleSend} className="flex gap-2">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Write a reply…"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-200"
        />
        <button
          type="submit"
          disabled={sending || !message.trim()}
          className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-1"
        >
          <Send size={12} /> Send
        </button>
      </form>
    </div>
  );
}

/* ============ DETAIL MODAL ============ */
function ActionDetailModal({ action, onClose, onTransition, onEdit, onDelete, onUpdate }) {
  const [note, setNote] = useState('');
  const typeInfo = ACTION_TYPES.find(t => t.value === action.action_type) || ACTION_TYPES[0];
  const TypeIcon = typeInfo.icon;
  const statusCfg = STATUS_CONFIG[action.status] || STATUS_CONFIG.planned;
  const StatusIcon = statusCfg.icon;
  const priorityCfg = PRIORITY_CONFIG[action.priority] || PRIORITY_CONFIG.medium;
  const history = action.history || [];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${typeInfo.color}`}>
                <TypeIcon size={12} className="inline mr-1" />{typeInfo.label}
              </span>
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${priorityCfg.color}`}>
                {priorityCfg.label} Priority
              </span>
            </div>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-1">{action.title}</h2>
          {action.service_name && <p className="text-sm text-blue-600">Service: {action.service_name}</p>}
        </div>

        {/* Workflow Progress */}
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Workflow Progress</h3>
          <div className="flex items-center justify-between relative">
            {/* Connecting line */}
            <div className="absolute top-5 left-8 right-8 h-0.5 bg-gray-200" />
            <div
              className="absolute top-5 left-8 h-0.5 bg-blue-500 transition-all"
              style={{ width: `${(WORKFLOW_STEPS.indexOf(action.status) / (WORKFLOW_STEPS.length - 1)) * (100 - 16)}%` }}
            />

            {WORKFLOW_STEPS.map((step, i) => {
              const cfg = STATUS_CONFIG[step];
              const Icon = cfg.icon;
              const stepIndex = WORKFLOW_STEPS.indexOf(step);
              const statusIndex = WORKFLOW_STEPS.indexOf(action.status);
              const isExpired = action.status === 'expired';
              const isCancelled = action.status === 'cancelled';
              const isReached = !isExpired && !isCancelled && statusIndex >= stepIndex;
              const isCurrent = action.status === step;
              return (
                <div key={step} className="relative z-10 flex flex-col items-center">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                    isCurrent ? `${cfg.color} border-current ring-4 ${cfg.ring}`
                      : isReached ? `${cfg.color} border-current`
                      : isExpired ? 'bg-red-100 text-red-400 border-red-300'
                      : 'bg-gray-100 text-gray-400 border-gray-300'
                  }`}>
                    <Icon size={18} />
                  </div>
                  <span className={`text-xs mt-2 font-medium ${isCurrent ? 'text-gray-900' : isExpired ? 'text-red-400' : 'text-gray-400'}`}>
                    {cfg.label}
                  </span>
                  {isCurrent && action.status === 'completed' && action.completed_date && (
                    <span className="text-[10px] text-gray-500 mt-0.5">
                      {new Date(action.completed_date).toLocaleDateString()}
                    </span>
                  )}
                </div>
              );
            })}

            {action.status === 'cancelled' && (
              <div className="absolute inset-0 flex items-center justify-center z-20">
                <div className="bg-red-100 border-2 border-red-400 rounded-lg px-4 py-2 flex items-center gap-2">
                  <Ban size={18} className="text-red-600" />
                  <span className="font-bold text-red-700">CANCELLED</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Status Transition Buttons — only creator / assigned user / admin */}
        {action.can_change_status && action.valid_transitions && action.valid_transitions.length > 0 && (
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Available Actions</h3>
            <div className="flex flex-wrap gap-2">
              {action.valid_transitions.map(newStatus => {
                const tCfg = TRANSITION_LABELS[newStatus];
                const TIcon = tCfg.icon;
                return (
                  <button
                    key={newStatus}
                    onClick={() => onTransition(action, newStatus)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-white font-medium transition ${tCfg.color}`}
                  >
                    <TIcon size={14} /> {tCfg.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-gray-400 mt-2">Only the action creator or an assigned user can change the status.</p>
          </div>
        )}

        {/* Details */}
        <div className="px-6 py-4 space-y-4 border-b border-gray-100">
          {action.description && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-1"><FileText size={14} /> Description</h4>
              <p className="text-sm text-gray-600">{action.description}</p>
            </div>
          )}
          {action.expected_impact && (
            <div className="bg-green-50 rounded-lg p-3">
              <h4 className="text-sm font-semibold text-green-700 mb-1">Expected Impact</h4>
              <p className="text-sm text-green-600">{action.expected_impact}</p>
            </div>
          )}
          {action.actual_impact && (
            <div className="bg-blue-50 rounded-lg p-3">
              <h4 className="text-sm font-semibold text-blue-700 mb-1">Actual Impact</h4>
              <p className="text-sm text-blue-600">{action.actual_impact}</p>
            </div>
          )}
          <div className="flex gap-4 text-sm text-gray-500 flex-wrap">
            {action.revenue_month && <span>📅 Period: {new Date(action.revenue_month + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>}
            {action.target_date && <span>🎯 Target: {new Date(action.target_date).toLocaleDateString()}</span>}
            <span className="flex items-center gap-1.5">
              {action.created_by_avatar ? (
                <img src={action.created_by_avatar} alt="" className="w-4 h-4 rounded-full object-cover" />
              ) : (
                <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[9px] font-bold">
                  {(action.created_by_name || action.created_by || '?').charAt(0).toUpperCase()}
                </span>
              )}
              <span>Created by <span className="font-medium text-gray-700">{action.created_by_name || action.created_by || 'Unknown'}</span></span>
            </span>
          </div>
          {action.status === 'cancelled' && action.cancel_reason && (
            <div className="bg-red-50 rounded-lg p-3 border border-red-200">
              <h4 className="text-sm font-semibold text-red-700 mb-1 flex items-center gap-1"><Ban size={14} /> Cancellation Reason</h4>
              <p className="text-sm text-red-600">{action.cancel_reason}</p>
            </div>
          )}

          {/* Revenue Change Analysis */}
          {action.revenue_change && (
            <div className={`rounded-lg p-4 border ${
              action.revenue_change.direction === 'increase' ? 'bg-emerald-50 border-emerald-200' :
              action.revenue_change.direction === 'decrease' ? 'bg-red-50 border-red-200' :
              'bg-gray-50 border-gray-200'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                  📊 Revenue Change — {new Date(action.revenue_change.current_month + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                </h4>
                <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                  action.revenue_change.direction === 'increase' ? 'bg-emerald-200 text-emerald-800' :
                  action.revenue_change.direction === 'decrease' ? 'bg-red-200 text-red-800' :
                  'bg-gray-200 text-gray-800'
                }`}>
                  {action.revenue_change.direction === 'increase' ? '📈 Increase' :
                   action.revenue_change.direction === 'decrease' ? '📉 Decrease' : '➡️ Same'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div className="text-center">
                  <p className="text-xs text-gray-500 mb-1">Previous Month ({new Date(action.revenue_change.previous_month + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })})</p>
                  <p className="text-lg font-bold text-gray-700">ETB {action.revenue_change.previous_revenue.toLocaleString()}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-500 mb-1">Current Month ({new Date(action.revenue_change.current_month + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })})</p>
                  <p className="text-lg font-bold text-gray-900">ETB {action.revenue_change.current_revenue.toLocaleString()}</p>
                </div>
              </div>
              <div className="text-center mb-3">
                <span className={`text-lg font-bold ${
                  action.revenue_change.direction === 'increase' ? 'text-emerald-700' :
                  action.revenue_change.direction === 'decrease' ? 'text-red-700' : 'text-gray-700'
                }`}>
                  {action.revenue_change.change >= 0 ? '+' : ''}{formatETB(Math.abs(action.revenue_change.change))}
                  {action.revenue_change.change_pct != null && (
                    <span className="text-sm ml-2">({action.revenue_change.change >= 0 ? '+' : ''}{action.revenue_change.change_pct}%)</span>
                  )}
                </span>
              </div>
            </div>
          )}

          {/* Action Caused Change Checkbox — always visible */}
          <ActionCausedChangeBox action={action} onUpdate={onUpdate} />

          {/* Task Assignment Section */}
          <TaskPanel action={action} onUpdate={onUpdate} />

          {/* Discussion / Replies — assigner & assigned users */}
          <ActionReplies action={action} />
        </div>

        {/* Timeline / History */}
        <div className="px-6 py-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Activity Timeline</h3>
          {history.length === 0 ? (
            <p className="text-xs text-gray-400">No history yet</p>
          ) : (
            <div className="relative pl-6">
              <div className="absolute left-2 top-2 bottom-2 w-0.5 bg-gray-200" />
              {history.map((h, i) => {
                const hCfg = STATUS_CONFIG[h.new_status] || STATUS_CONFIG.planned;
                const HIcon = hCfg.icon;
                return (
                  <div key={h.id || i} className="relative mb-4 last:mb-0">
                    <div className={`absolute -left-4 top-1 w-5 h-5 rounded-full flex items-center justify-center ${hCfg.color} border-2 border-white`}>
                      <HIcon size={10} />
                    </div>
                    <div className="ml-2">
                      <p className="text-sm text-gray-800">
                        {h.old_status ? (
                          <>Status changed from <strong>{STATUS_CONFIG[h.old_status]?.label || h.old_status}</strong> to <strong>{hCfg.label}</strong></>
                        ) : (
                          <>Action created with status <strong>{hCfg.label}</strong></>
                        )}
                      </p>
                      {h.note && <p className="text-xs text-gray-500 mt-0.5">{h.note}</p>}
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-400">
                        <span>{h.changed_by}</span>
                        <span>{h.created_at ? new Date(h.created_at).toLocaleString() : ''}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-gray-100 flex justify-between">
          <button
            onClick={() => onDelete(action.id)}
            className="flex items-center gap-1 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition"
          >
            <Trash2 size={14} /> Delete
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => { onEdit(action); onClose(); }}
              className="flex items-center gap-1 px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
            >
              <Edit2 size={14} /> Edit
            </button>
            <button onClick={onClose} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
