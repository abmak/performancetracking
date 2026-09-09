import { useState, useEffect } from 'react';
import { ClipboardList, Filter } from 'lucide-react';
import { auditAPI } from '../services/api';
import { formatDate } from '../utils/helpers';

const ACTION_COLORS = {
  create: 'bg-green-100 text-green-700',
  update: 'bg-blue-100 text-blue-700',
  delete: 'bg-red-100 text-red-700',
  import: 'bg-purple-100 text-purple-700',
};

const ENTITY_COLORS = {
  service: 'bg-cyan-100 text-cyan-700',
  target: 'bg-amber-100 text-amber-700',
  revenue: 'bg-emerald-100 text-emerald-700',
};

export default function AuditTrail() {
  const [logs, setLogs] = useState({ data: [], pagination: {} });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ entity_type: '', action: '', page: 1 });

  useEffect(() => { loadLogs(); }, [filters]);

  async function loadLogs() {
    setLoading(true);
    try {
      const params = {};
      Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
      setLogs(await auditAPI.getAll(params));
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Audit Trail</h1>
        <p className="text-sm text-gray-500">Track all system activities and changes</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <Filter size={16} className="text-gray-400" />
          <select value={filters.entity_type} onChange={(e) => setFilters({ ...filters, entity_type: e.target.value, page: 1 })} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All Entity Types</option>
            <option value="service">Services</option>
            <option value="target">Targets</option>
            <option value="revenue">Revenue</option>
          </select>
          <select value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value, page: 1 })} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All Actions</option>
            <option value="create">Create</option>
            <option value="update">Update</option>
            <option value="delete">Delete</option>
            <option value="import">Import</option>
          </select>
          <span className="ml-auto text-sm text-gray-500">{logs.pagination?.total || 0} entries</span>
        </div>
      </div>

      {/* Audit Log */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-3 px-4 font-semibold text-gray-600">Timestamp</th>
                <th className="text-center py-3 px-4 font-semibold text-gray-600">Action</th>
                <th className="text-center py-3 px-4 font-semibold text-gray-600">Entity</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-600">Description</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-600">User</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="text-center py-12 text-gray-400">Loading...</td></tr>
              ) : logs.data?.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-12 text-gray-400">
                  <ClipboardList size={40} className="mx-auto mb-3 opacity-50" />
                  No audit entries found
                </td></tr>
              ) : (
                logs.data?.map((log) => (
                  <tr key={log.id} className="border-t border-gray-50 hover:bg-gray-50">
                    <td className="py-3 px-4 text-gray-600 text-xs whitespace-nowrap">{formatDate(log.created_at)}</td>
                    <td className="text-center py-3 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium uppercase ${ACTION_COLORS[log.action] || 'bg-gray-100 text-gray-700'}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="text-center py-3 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${ENTITY_COLORS[log.entity_type] || 'bg-gray-100 text-gray-700'}`}>
                        {log.entity_type}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-700">{log.description}</td>
                    <td className="py-3 px-4 text-gray-600">{log.user_name}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        {logs.pagination?.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <span className="text-sm text-gray-500">Page {logs.pagination.page} of {logs.pagination.pages}</span>
            <div className="flex gap-2">
              <button disabled={filters.page <= 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })} className="px-3 py-1 text-sm border rounded-lg disabled:opacity-50 hover:bg-gray-50">Previous</button>
              <button disabled={filters.page >= logs.pagination.pages} onClick={() => setFilters({ ...filters, page: filters.page + 1 })} className="px-3 py-1 text-sm border rounded-lg disabled:opacity-50 hover:bg-gray-50">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
