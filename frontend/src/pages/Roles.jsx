import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, X, Check, Shield, Users, ChevronDown, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { rolesAPI, permissionsAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';

const emptyRole = { name: '', description: '', is_default: false, permission_ids: [] };

export default function Roles() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('roles.edit');
  const canDelete = hasPermission('roles.delete');
  const canCreate = hasPermission('roles.create');
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [permGrouped, setPermGrouped] = useState({});
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyRole);
  const [expandedModules, setExpandedModules] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [rolesData, permsData] = await Promise.all([rolesAPI.getAll(), permissionsAPI.getAll()]);
      setRoles(rolesData);
      setPermissions(permsData.all);
      setPermGrouped(permsData.grouped);
    } catch (err) {
      toast.error('Failed to load data');
    }
    setLoading(false);
  }

  function openCreate() {
    setForm(emptyRole);
    setEditingId(null);
    setExpandedModules({});
    setShowModal(true);
  }

  async function openEdit(role) {
    try {
      const fullRole = await rolesAPI.getOne(role.id);
      setForm({
        name: fullRole.name,
        description: fullRole.description || '',
        is_default: !!fullRole.is_default,
        permission_ids: fullRole.permissions.map(p => p.id),
      });
      setEditingId(role.id);
      // Expand all modules that have selected permissions
      const expanded = {};
      fullRole.permissions.forEach(p => { expanded[p.module] = true; });
      setExpandedModules(expanded);
      setShowModal(true);
    } catch (err) {
      toast.error('Failed to load role details');
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingId) {
        await rolesAPI.update(editingId, form);
        toast.success('Role updated');
      } else {
        await rolesAPI.create(form);
        toast.success('Role created');
      }
      setShowModal(false);
      loadData();
    } catch (err) {
      toast.error(err.message);
    }
    setSaving(false);
  }

  async function handleDelete(id, name) {
    if (!confirm(`Delete role "${name}"?`)) return;
    try {
      await rolesAPI.delete(id);
      toast.success('Role deleted');
      loadData();
    } catch (err) {
      toast.error(err.message);
    }
  }

  function toggleModule(module) {
    setExpandedModules(prev => ({ ...prev, [module]: !prev[module] }));
  }

  function togglePermission(permId) {
    setForm(prev => {
      const ids = prev.permission_ids.includes(permId)
        ? prev.permission_ids.filter(id => id !== permId)
        : [...prev.permission_ids, permId];
      return { ...prev, permission_ids: ids };
    });
  }

  function toggleModuleAll(module) {
    const modulePerms = permGrouped[module] || [];
    const moduleIds = modulePerms.map(p => p.id);
    const allSelected = moduleIds.every(id => form.permission_ids.includes(id));
    setForm(prev => {
      let ids;
      if (allSelected) {
        ids = prev.permission_ids.filter(id => !moduleIds.includes(id));
      } else {
        ids = [...new Set([...prev.permission_ids, ...moduleIds])];
      }
      return { ...prev, permission_ids: ids };
    });
  }

  const MODULE_LABELS = {
    dashboard: '📊 Dashboard',
    services: '🏢 VAS Services',
    categories: '🏷️ Categories',
    targets: '🎯 Revenue Targets',
    revenue: '💰 Revenue Data',
    partners: '👥 Partner Revenue',
    actions: '💡 Action Notes',
    alerts: '🔔 Revenue Alerts',
    import: '📤 Excel Import',
    reports: '📋 Reports',
    audit: '📜 Audit Trail',
    messages: '✉️ Messages',
    chat: '💬 Chat',
    ai: '🤖 AI Assistant',
    ai_usage: '📈 AI Usage Report',
    users: '👤 User Management',
    roles: '🛡️ Role Management',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Role Management</h1>
          <p className="text-sm text-gray-500">Configure roles and assign permissions to control system access</p>
        </div>
        {canCreate && (
          <button onClick={openCreate} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition">
            <Plus size={16} /> Add Role
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {roles.map((role) => (
            <div key={role.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 hover:shadow-md transition">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-white text-sm font-bold ${
                    role.name === 'Admin' ? 'bg-red-500' :
                    role.name === 'Manager' ? 'bg-blue-500' :
                    role.name === 'Analyst' ? 'bg-green-500' : 'bg-gray-500'
                  }`}>
                    <Shield size={18} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                      {role.name}
                      {role.is_default ? <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Default</span> : null}
                    </h3>
                    <span className="text-xs text-gray-500">
                      {role.permission_count || 0} permissions · {role.user_count || 0} users
                    </span>
                  </div>
                </div>
                <div className="flex gap-1">
                  {canEdit && (
                    <button onClick={() => openEdit(role)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-blue-600">
                      <Edit2 size={14} />
                    </button>
                  )}
                  {canDelete && (
                    <button onClick={() => handleDelete(role.id, role.name)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-red-600">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
              {role.description && <p className="text-sm text-gray-600 mb-3">{role.description}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between p-6 pb-4 border-b">
              <h2 className="text-lg font-semibold">{editingId ? 'Edit Role' : 'Add New Role'}</h2>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit} className="flex-1 overflow-auto p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role Name *</label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g., Senior Analyst"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  rows={2}
                  placeholder="Brief description of this role"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.is_default}
                  onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
                  className="rounded border-gray-300 text-blue-600"
                />
                <label className="text-sm text-gray-700">Set as default role (assigned to new users)</label>
              </div>

              {/* Permissions */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Permissions ({form.permission_ids.length} selected)
                </label>
                <div className="border border-gray-200 rounded-lg divide-y">
                  {Object.entries(permGrouped).map(([module, perms]) => {
                    const moduleIds = perms.map(p => p.id);
                    const selectedCount = moduleIds.filter(id => form.permission_ids.includes(id)).length;
                    const allSelected = selectedCount === moduleIds.length;
                    const someSelected = selectedCount > 0 && !allSelected;

                    return (
                      <div key={module}>
                        <div
                          className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-50"
                          onClick={() => toggleModule(module)}
                        >
                          <div className="flex items-center gap-2">
                            {expandedModules[module] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            <span className="text-sm font-medium text-gray-800">
                              {MODULE_LABELS[module] || module}
                            </span>
                            <span className="text-xs text-gray-400">
                              {selectedCount}/{moduleIds.length}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); toggleModuleAll(module); }}
                            className={`text-xs px-2 py-0.5 rounded ${
                              allSelected ? 'bg-green-100 text-green-700' :
                              someSelected ? 'bg-yellow-100 text-yellow-700' :
                              'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {allSelected ? 'All' : someSelected ? 'Some' : 'None'}
                          </button>
                        </div>
                        {expandedModules[module] && (
                          <div className="px-6 py-2 bg-gray-50 grid grid-cols-2 gap-2">
                            {perms.map(perm => (
                              <label key={perm.id} className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={form.permission_ids.includes(perm.id)}
                                  onChange={() => togglePermission(perm.id)}
                                  className="rounded border-gray-300 text-blue-600"
                                />
                                <span className="text-xs text-gray-700">{perm.description || perm.name}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2 sticky bottom-0 bg-white py-4 border-t">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-1 disabled:opacity-50">
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
