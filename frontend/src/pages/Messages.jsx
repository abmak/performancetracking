import { useState, useEffect, useRef } from 'react';
import { Send, Upload, Users, MessageSquare, Trash2, Eye, CheckCircle, XCircle, Clock, FileSpreadsheet, Search, X, UserCheck } from 'lucide-react';
import { smsAPI } from '../services/api';
import { formatCurrency, formatNumber } from '../utils/helpers';

const STATUS_CONFIG = {
  draft: { label: 'Draft', color: 'bg-gray-100 text-gray-700' },
  sending: { label: 'Sending', color: 'bg-blue-100 text-blue-700' },
  sent: { label: 'Sent', color: 'bg-green-100 text-green-700' },
  partial: { label: 'Partial', color: 'bg-amber-100 text-amber-700' },
  failed: { label: 'Failed', color: 'bg-red-100 text-red-700' },
};

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function Messages() {
  const [stats, setStats] = useState(null);
  const [messages, setMessages] = useState({ data: [], pagination: {} });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('compose');
  const [detail, setDetail] = useState(null);

  // Users list for selection
  const [users, setUsers] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [userSearch, setUserSearch] = useState('');

  // Compose state
  const [messageText, setMessageText] = useState('');
  const [senderName, setSenderName] = useState('VAS System');
  const [phoneNumbers, setPhoneNumbers] = useState('');
  const [sending, setSending] = useState(false);

  // Import state
  const [importMessage, setImportMessage] = useState('');
  const [importFile, setImportFile] = useState(null);
  const [importData, setImportData] = useState([]);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => { loadStats(); loadMessages(); loadUsers(); }, []);

  async function loadStats() {
    try { setStats(await smsAPI.getStats()); } catch { /* ignore */ }
  }

  async function loadMessages(status) {
    setLoading(true);
    try {
      const params = {};
      if (status) params.status = status;
      setMessages(await smsAPI.getAll(params));
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function loadUsers() {
    try { setUsers(await smsAPI.getUsers()); } catch { /* ignore */ }
  }

  function toggleUser(user) {
    setSelectedUsers(prev => {
      const exists = prev.find(u => u.id === user.id);
      if (exists) return prev.filter(u => u.id !== user.id);
      return [...prev, user];
    });
  }

  function toggleAllUsers() {
    const filtered = getFilteredUsers();
    if (selectedUsers.length === filtered.length) {
      setSelectedUsers([]);
    } else {
      setSelectedUsers([...filtered]);
    }
  }

  function getFilteredUsers() {
    if (!userSearch) return users;
    const q = userSearch.toLowerCase();
    return users.filter(u =>
      u.full_name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q) ||
      u.department?.toLowerCase().includes(q) ||
      u.phone?.includes(q)
    );
  }

  // Get all phone numbers (from selected users + manual input)
  function getAllPhones() {
    const userPhones = selectedUsers.filter(u => u.phone).map(u => ({
      phone: u.phone,
      name: u.full_name,
      type: 'internal'
    }));
    const manualPhones = phoneNumbers.split(/[\n,;]+/).map(p => p.trim()).filter(p => p);
    const manualEntries = manualPhones.map(p => ({ phone: p, name: '', type: 'external' }));
    return [...userPhones, ...manualEntries];
  }

  async function handleSendSingle() {
    if (!messageText.trim()) return alert('Please enter message text');
    const allPhones = getAllPhones();
    if (allPhones.length === 0) return alert('Please select users or enter phone numbers');

    setSending(true);
    try {
      const result = await smsAPI.send({
        message_text: messageText,
        phone_numbers: allPhones,
        sender_name: senderName,
      });
      alert(`✅ ${result.message}`);
      setMessageText('');
      setPhoneNumbers('');
      setSelectedUsers([]);
      loadStats();
      loadMessages();
      setTab('history');
    } catch (err) {
      alert(`❌ Error: ${err.message}`);
    }
    setSending(false);
  }

  async function handleSendBulk() {
    if (!messageText.trim()) return alert('Please enter message text');
    const allPhones = getAllPhones();
    if (allPhones.length === 0) return alert('Please select users or enter phone numbers');

    setSending(true);
    try {
      const result = await smsAPI.send({
        message_text: messageText,
        phone_numbers: allPhones,
        sender_name: senderName,
      });
      alert(`✅ ${result.message}`);
      setMessageText('');
      setPhoneNumbers('');
      setSelectedUsers([]);
      loadStats();
      loadMessages();
      setTab('history');
    } catch (err) {
      alert(`❌ Error: ${err.message}`);
    }
    setSending(false);
  }

  function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImportFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target.result;
        const lines = text.split('\n').filter(l => l.trim());
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
        const data = [];
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
          const row = {};
          headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
          const phone = row.phone_number || row.phone || row.msisdn || row.mobile || row.cellphone || row.telephone || '';
          const name = row.name || row.recipient_name || row.full_name || row.customer_name || '';
          if (phone) data.push({ phone_number: phone, name });
        }
        setImportData(data);
      } catch {
        alert('Error parsing file. Ensure valid CSV with phone_number and name columns.');
      }
    };
    reader.readAsText(file);
  }

  async function handleImportSend() {
    if (!importMessage.trim()) return alert('Please enter message text');
    if (importData.length === 0) return alert('No valid recipients found in file');

    setImporting(true);
    try {
      const result = await smsAPI.importAndSend({
        message_text: importMessage,
        recipients: importData,
        sender_name: senderName,
      });
      alert(`✅ ${result.message}`);
      setImportMessage('');
      setImportData([]);
      setImportFile(null);
      if (fileRef.current) fileRef.current.value = '';
      loadStats();
      loadMessages();
      setTab('history');
    } catch (err) {
      alert(`❌ Error: ${err.message}`);
    }
    setImporting(false);
  }

  async function handleDelete(id) {
    if (!confirm('Delete this message?')) return;
    try {
      await smsAPI.delete(id);
      loadStats();
      loadMessages();
      setDetail(null);
    } catch (err) { alert(err.message); }
  }

  async function handleMessageDetail(id) {
    try { setDetail(await smsAPI.getOne(id)); } catch (err) { alert(err.message); }
  }

  const filteredUsers = getFilteredUsers();
  const totalRecipients = getAllPhones().length;

  // User Selection Panel (shared between Single and Bulk)
  function UserSelectionPanel() {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <UserCheck size={16} className="text-blue-500" />
            <h4 className="text-sm font-semibold text-gray-700">Select Users ({users.length} with phone numbers)</h4>
          </div>
          <button onClick={toggleAllUsers}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium">
            {selectedUsers.length === filteredUsers.length ? 'Deselect All' : 'Select All'}
          </button>
        </div>
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search by name, email, department, or phone..."
            value={userSearch} onChange={e => setUserSearch(e.target.value)}
            className="w-full border border-gray-300 rounded-lg pl-8 pr-3 py-1.5 text-sm" />
        </div>
        <div className="max-h-[200px] overflow-y-auto border border-gray-200 rounded-lg bg-white">
          {filteredUsers.length === 0 ? (
            <div className="py-4 text-center text-sm text-gray-400">No users with phone numbers found</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="w-10 py-2 px-3"><input type="checkbox" checked={selectedUsers.length === filteredUsers.length && filteredUsers.length > 0} onChange={toggleAllUsers} className="rounded" /></th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-600">Name</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-600">Phone</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-600">Department</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(u => (
                  <tr key={u.id}
                    className={`border-t border-gray-100 cursor-pointer transition ${selectedUsers.find(s => s.id === u.id) ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                    onClick={() => toggleUser(u)}>
                    <td className="py-2 px-3">
                      <input type="checkbox" checked={!!selectedUsers.find(s => s.id === u.id)}
                        onChange={() => toggleUser(u)} className="rounded" onClick={e => e.stopPropagation()} />
                    </td>
                    <td className="py-2 px-3">
                      <div className="font-medium text-gray-900">{u.full_name}</div>
                      <div className="text-xs text-gray-500">{u.email}</div>
                    </td>
                    <td className="py-2 px-3 font-mono text-xs">{u.phone}</td>
                    <td className="py-2 px-3 text-xs text-gray-500">{u.department || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {selectedUsers.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {selectedUsers.map(u => (
              <span key={u.id} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs">
                {u.full_name}
                <button onClick={(e) => { e.stopPropagation(); toggleUser(u); }} className="hover:text-blue-900">
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Messages</h1>
          <p className="text-sm text-gray-500">Send SMS to internal users and external recipients</p>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: 'Total Messages', value: stats.total_messages, color: 'bg-blue-50 text-blue-600' },
            { label: 'Sent', value: stats.sent_messages, color: 'bg-green-50 text-green-600' },
            { label: 'Recipients Reached', value: formatNumber(stats.total_recipients), color: 'bg-purple-50 text-purple-600' },
            { label: 'Failed', value: stats.failed_recipients, color: 'bg-red-50 text-red-600' },
            { label: 'Today', value: stats.today_messages, color: 'bg-amber-50 text-amber-600' },
          ].map((s, i) => (
            <div key={i} className={`rounded-xl p-4 ${s.color}`}>
              <div className="text-xs font-medium opacity-75 uppercase">{s.label}</div>
              <div className="text-xl font-bold mt-1">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        {[
          { id: 'compose', label: 'Single SMS', icon: Send },
          { id: 'bulk', label: 'Bulk SMS', icon: Users },
          { id: 'import', label: 'Import & Send', icon: FileSpreadsheet },
          { id: 'history', label: 'History', icon: MessageSquare },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${tab === t.id ? 'bg-white shadow text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}>
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Compose Single SMS */}
      {tab === 'compose' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Send SMS</h3>
          <div className="space-y-4 max-w-3xl">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sender Name</label>
              <input type="text" value={senderName} onChange={e => setSenderName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>

            <UserSelectionPanel />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Additional Phone Numbers (external)</label>
              <textarea value={phoneNumbers} onChange={e => setPhoneNumbers(e.target.value)} rows={3}
                placeholder="Enter external phone numbers, one per line or comma-separated&#10;e.g., +251911234567, +251922345678"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
              <textarea value={messageText} onChange={e => setMessageText(e.target.value)} rows={4}
                placeholder="Type your SMS message here..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              <p className="text-xs text-gray-400 mt-1">{messageText.length} characters</p>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">
                <strong className="text-gray-900">{totalRecipients}</strong> recipient{totalRecipients !== 1 ? 's' : ''} selected
              </span>
              <button onClick={handleSendSingle} disabled={sending || totalRecipients === 0}
                className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                <Send size={16} />
                {sending ? 'Sending...' : `Send to ${totalRecipients} recipient${totalRecipients !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk SMS */}
      {tab === 'bulk' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Bulk SMS</h3>
          <div className="space-y-4 max-w-3xl">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sender Name</label>
              <input type="text" value={senderName} onChange={e => setSenderName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>

            <UserSelectionPanel />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Additional Phone Numbers (external)</label>
              <textarea value={phoneNumbers} onChange={e => setPhoneNumbers(e.target.value)} rows={4}
                placeholder="+251911234567&#10;+251922345678&#10;+251933456789"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" />
              <p className="text-xs text-gray-400 mt-1">
                {phoneNumbers.split(/[\n,;]+/).filter(p => p.trim()).length} manual numbers entered
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
              <textarea value={messageText} onChange={e => setMessageText(e.target.value)} rows={4}
                placeholder="Type your bulk SMS message here..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              <p className="text-xs text-gray-400 mt-1">{messageText.length} characters</p>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">
                <strong className="text-gray-900">{totalRecipients}</strong> recipient{totalRecipients !== 1 ? 's' : ''} selected
              </span>
              <button onClick={handleSendBulk} disabled={sending || totalRecipients === 0}
                className="flex items-center gap-2 px-6 py-2.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
                <Users size={16} />
                {sending ? 'Sending...' : `Send Bulk to ${totalRecipients} recipient${totalRecipients !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import & Send */}
      {tab === 'import' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Import from Excel & Send SMS</h3>
          <div className="space-y-4 max-w-3xl">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800 font-medium">Excel File Format</p>
              <p className="text-xs text-blue-600 mt-1">Your CSV/Excel file should have columns: <code>phone_number</code> (required), <code>name</code> (optional)</p>
              <p className="text-xs text-blue-600 mt-1">Supported column names: phone_number, phone, msisdn, mobile, cellphone, telephone</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sender Name</label>
              <input type="text" value={senderName} onChange={e => setSenderName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Upload CSV/Excel File</label>
              <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls" onChange={handleFileUpload}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 file:text-sm file:font-medium hover:file:bg-blue-100" />
            </div>
            {importData.length > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-sm text-green-800 font-medium">✅ {importData.length} recipients loaded from file</p>
                <div className="mt-2 max-h-40 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-green-200">
                      <th className="text-left py-1">Name</th><th className="text-left py-1">Phone</th>
                    </tr></thead>
                    <tbody>
                      {importData.slice(0, 20).map((r, i) => (
                        <tr key={i} className="border-b border-green-100">
                          <td className="py-1">{r.name || '-'}</td>
                          <td className="py-1 font-mono">{r.phone_number}</td>
                        </tr>
                      ))}
                      {importData.length > 20 && (
                        <tr><td colSpan={2} className="py-1 text-center text-green-600">...and {importData.length - 20} more</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
              <textarea value={importMessage} onChange={e => setImportMessage(e.target.value)} rows={4}
                placeholder="Type your SMS message to send to imported recipients..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              <p className="text-xs text-gray-400 mt-1">{importMessage.length} characters</p>
            </div>
            <button onClick={handleImportSend} disabled={importing || importData.length === 0}
              className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
              <Upload size={16} />
              {importing ? 'Sending...' : `Send to ${importData.length} Recipients`}
            </button>
          </div>
        </div>
      )}

      {/* History */}
      {tab === 'history' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Message History</h3>
          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : messages.data?.length === 0 ? (
            <div className="text-center py-8 text-gray-400">No messages sent yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-3 font-semibold text-gray-600">ID</th>
                    <th className="text-left py-3 px-3 font-semibold text-gray-600">Message</th>
                    <th className="text-center py-3 px-3 font-semibold text-gray-600">Recipients</th>
                    <th className="text-center py-3 px-3 font-semibold text-gray-600">Sent</th>
                    <th className="text-center py-3 px-3 font-semibold text-gray-600">Failed</th>
                    <th className="text-center py-3 px-3 font-semibold text-gray-600">Status</th>
                    <th className="text-left py-3 px-3 font-semibold text-gray-600">Date</th>
                    <th className="text-center py-3 px-3 font-semibold text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.data?.map(m => {
                    const st = STATUS_CONFIG[m.status] || STATUS_CONFIG.draft;
                    return (
                      <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-3 px-3 text-gray-500">#{m.id}</td>
                        <td className="py-3 px-3 text-gray-900 max-w-[250px] truncate">{m.message_text}</td>
                        <td className="text-center py-3 px-3">{m.total_recipients}</td>
                        <td className="text-center py-3 px-3 text-green-600 font-medium">{m.sent_count}</td>
                        <td className="text-center py-3 px-3 text-red-600">{m.failed_count > 0 ? m.failed_count : '—'}</td>
                        <td className="text-center py-3 px-3">
                          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${st.color}`}>{st.label}</span>
                        </td>
                        <td className="py-3 px-3 text-xs text-gray-500">{formatDate(m.created_at)}</td>
                        <td className="text-center py-3 px-3">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => handleMessageDetail(m.id)} className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-500" title="View details">
                              <Eye size={14} />
                            </button>
                            <button onClick={() => handleDelete(m.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500" title="Delete">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Message Detail Modal */}
      {detail && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-gray-900">Message #{detail.id} — {STATUS_CONFIG[detail.status]?.label}</h3>
              <button onClick={() => setDetail(null)} className="p-1 rounded hover:bg-gray-100"><X size={18} /></button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <p className="text-xs text-gray-500 uppercase font-medium">Message</p>
                <p className="text-sm text-gray-900 mt-1 whitespace-pre-wrap">{detail.message_text}</p>
              </div>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="bg-blue-50 rounded-lg p-3">
                  <div className="text-xs text-blue-600">Total</div>
                  <div className="text-lg font-bold text-blue-800">{detail.total_recipients}</div>
                </div>
                <div className="bg-green-50 rounded-lg p-3">
                  <div className="text-xs text-green-600">Sent</div>
                  <div className="text-lg font-bold text-green-800">{detail.sent_count}</div>
                </div>
                <div className="bg-red-50 rounded-lg p-3">
                  <div className="text-xs text-red-600">Failed</div>
                  <div className="text-lg font-bold text-red-800">{detail.failed_count}</div>
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase font-medium mb-2">Recipients ({detail.recipients?.length || 0})</p>
                <div className="max-h-60 overflow-y-auto border rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="text-left py-2 px-3">Name</th>
                        <th className="text-left py-2 px-3">Phone</th>
                        <th className="text-center py-2 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.recipients?.map((r, i) => (
                        <tr key={i} className="border-t">
                          <td className="py-2 px-3">{r.recipient_name || '-'}</td>
                          <td className="py-2 px-3 font-mono">{r.phone_number}</td>
                          <td className="text-center py-2 px-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs ${r.status === 'sent' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              {r.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
