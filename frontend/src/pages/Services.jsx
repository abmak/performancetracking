import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, X, Check, AlertTriangle } from 'lucide-react';
import { servicesAPI, request } from '../services/api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

const emptyService = { name: '', code: '', description: '', category_id: '', status: 'active' };

export default function Services() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('services.edit');
  const canDelete = hasPermission('services.delete');
  const canCreate = hasPermission('services.create');
  const [services, setServices] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyService);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [svcs, cats] = await Promise.all([
        servicesAPI.getAll(),
        request('/categories'),
      ]);
      setServices(svcs);
      setCategories(cats);
    } catch (err) {
      toast.error('Failed to load data');
    }
    setLoading(false);
  }

  function openCreate() {
    setForm(emptyService);
    setEditingId(null);
    setShowModal(true);
  }

  function openEdit(svc) {
    setForm({
      name: svc.name,
      code: svc.code,
      description: svc.description || '',
      category_id: svc.category_id || '',
      status: svc.status,
    });
    setEditingId(svc.id);
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      const payload = {
        ...form,
        category_id: form.category_id ? Number(form.category_id) : null,
      };
      if (editingId) {
        await servicesAPI.update(editingId, payload);
        toast.success('Service updated');
      } else {
        await servicesAPI.create(payload);
        toast.success('Service created');
      }
      setShowModal(false);
      loadData();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleDelete(id, name) {
    if (!confirm(`Delete service "${name}"?\n\nNote: Services with revenue targets cannot be deleted.`)) return;
    try {
      await servicesAPI.delete(id);
      toast.success('Service deleted');
      loadData();
    } catch (err) {
      toast.error(err.message);
    }
  }

  // Build a quick lookup for category color by id
  const catColorMap = {};
  categories.forEach(c => { catColorMap[c.id] = c.color || '#6B7280'; });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">VAS Services</h1>
          <p className="text-sm text-gray-500">Manage your Value Added Services portfolio</p>
        </div>
        {canCreate && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition"
          >
            <Plus size={16} /> Add Service
          </button>
        )}
      </div>

      {/* Service cards */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : services.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <p className="text-gray-500">No services yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {services.map((svc) => (
            <div
              key={svc.id}
              className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 hover:shadow-md transition"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-gray-900">{svc.name}</h3>
                  <span className="text-xs text-gray-500 font-mono">{svc.code}</span>
                </div>
                <div className="flex gap-1">
                  {canEdit && (
                    <button
                      onClick={() => openEdit(svc)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-blue-600"
                    >
                      <Edit2 size={14} />
                    </button>
                  )}
                  {canDelete && (
                    <button
                      onClick={() => handleDelete(svc.id, svc.name)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-red-600"
                      title="Delete service"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
              {svc.description && (
                <p className="text-sm text-gray-600 mb-3 line-clamp-2">{svc.description}</p>
              )}
              <div className="flex items-center gap-2">
                {(svc.category_name || svc.category_id) && (
                  <span
                    className="px-2 py-0.5 rounded-full text-xs font-medium text-white"
                    style={{ backgroundColor: svc.category_color || catColorMap[svc.category_id] || '#6B7280' }}
                  >
                    {svc.category_name || categories.find(c => c.id === svc.category_id)?.name || 'Unknown'}
                  </span>
                )}
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    svc.status === 'active'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {svc.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">{editingId ? 'Edit Service' : 'Add New Service'}</h2>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Service Name *</label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g., Caller Ring Back Tone"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Service Code *</label>
                <input
                  required
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
                  placeholder="e.g., CRBT"
                  disabled={!!editingId}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  rows={3}
                  placeholder="Brief description of the service"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
                  <select
                    required
                    value={form.category_id}
                    onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Select category</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-1"
                >
                  <Check size={14} /> {editingId ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
