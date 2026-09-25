import React, { useState, useEffect } from 'react';
import { channelAPI } from '../services/api';
import { Upload, FileSpreadsheet, CheckCircle, AlertTriangle, XCircle, Loader2, ChevronDown, ChevronUp, RefreshCw, Download, Pencil, Trash2, X, Save, History } from 'lucide-react';
import { formatDate } from '../utils/helpers';
import toast from 'react-hot-toast';

// What the server names each detected sheet layout.
const LEVEL_LABEL = {
  distributor: 'Distributor (L1)',
  sub_distributor: 'Sub-Distributor (L2)',
  retailer: 'Retailer (L3)',
};

export default function ChannelBatchImport() {
  const [meta, setMeta] = useState(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(true);
  // Which detail section is expanded: null | 'successful' | 'warnedRows' | 'warnings' | 'rejected'
  const [expandedSection, setExpandedSection] = useState(null);

  // What to do with the rows that carried warnings: null until the operator
  // picks, otherwise true = import them, false = discard them.
  const [includeWarnings, setIncludeWarnings] = useState(null);

  // Import history
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [clearing, setClearing] = useState(false);

  // Edit batch modal
  const [editingBatch, setEditingBatch] = useState(null);
  const [editForm, setEditForm] = useState({ filename: '' });
  const [savingEdit, setSavingEdit] = useState(false);

  // Level the operator picks before uploading — the file is validated against
  // this level's expected column layout rather than auto-detected.
  const [selectedLevel, setSelectedLevel] = useState(null);

  useEffect(() => {
    loadMeta();
    loadHistory();
  }, []);

  async function loadMeta() {
    try {
      const d = await channelAPI.getMeta();
      setMeta(d);
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const rows = await channelAPI.getImportHistory();
      setHistory(Array.isArray(rows) ? rows : []);
    } catch (err) {
      toast.error('Failed to load import history: ' + err.message);
    }
    setHistoryLoading(false);
  }

  const LEVEL_NAMES = { 1: 'distributor', 2: 'sub_distributor', 3: 'retailer' };

  async function handleDownloadTemplate(level) {
    try {
      const blob = await channelAPI.downloadTemplate(level);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = level
        ? `channel_import_${LEVEL_NAMES[level]}.xlsx`
        : 'channel_import_template.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(level ? `${LEVEL_NAMES[level].replace('_', ' ')} template downloaded` : 'Template downloaded');
    } catch (err) {
      toast.error('Template download failed: ' + err.message);
    }
  }

  // Export the import history currently on screen as CSV.
  function handleExportHistory() {
    if (history.length === 0) {
      toast.error('Nothing to export yet');
      return;
    }
    const columns = [
      { key: 'created_at', label: 'Imported At' },
      { key: 'filename', label: 'File' },
      { key: 'period_month', label: 'Period' },
      { key: 'status', label: 'Status' },
      { key: 'total_rows', label: 'Rows Read' },
      { key: 'valid_rows', label: 'Unique Rows' },
      { key: 'new_entities', label: 'New Entities' },
      { key: 'updated_rows', label: 'Updated Entities' },
      { key: 'hierarchy_created', label: 'Uplines Created' },
      { key: 'duplicate_rows', label: 'Duplicates' },
      { key: 'rejected_rows', label: 'Rejected' },
      { key: 'warning_rows', label: 'Warned' },
      { key: 'discarded_rows', label: 'Discarded' },
      { key: 'detail_balance_total', label: 'Balance' },
      { key: 'imported_by', label: 'Imported By' },
    ];
    const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [
      columns.map((c) => escape(c.label)).join(','),
      ...history.map((b) => columns.map((c) => {
        let v = b[c.key];
        if (c.key === 'period_month' && v) v = String(v).slice(0, 7);
        if (c.key === 'created_at' && v) v = String(v).replace('T', ' ').slice(0, 19);
        return escape(v);
      }).join(',')),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `channel_import_history_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success('Import history exported');
  }

  async function handleDeleteBatch(b) {
    if (!confirm(`Delete import "${b.filename}" (${b.period_month || 'no period'})?\n\nThis removes the balances it wrote and the channel users it brought in. Users a later import also lists, and anyone registered by hand, are kept.`)) return;
    try {
      const res = await channelAPI.deleteImport(b.id);
      toast.success(`Batch deleted — ${res.balances_deleted} balance row(s) and ${res.entities_deleted || 0} user(s) removed`);
      // Refresh both history and meta counts so the page immediately reflects
      // the deletion without requiring a full remount.
      await Promise.all([loadHistory(), loadMeta()]);
    } catch (err) {
      toast.error('Delete failed: ' + err.message);
    }
  }

  async function handleClearImportedData() {
    if (!confirm('Remove every imported channel user and all import history?\n\nUsers registered by hand are kept. This cannot be undone, but re-importing the workbook restores the data.')) return;
    setClearing(true);
    try {
      const res = await channelAPI.clearImportedData();
      toast.success(`Cleared — ${res.entities_deleted} user(s) and ${res.balances_deleted} balance row(s) removed`);
      // Refresh history and meta counts so the page reflects the cleared state
      // immediately, without requiring the user to navigate away and back.
      await Promise.all([loadHistory(), loadMeta()]);
    } catch (err) {
      toast.error('Clear failed: ' + err.message);
    }
    setClearing(false);
  }

  function openEdit(b) {
    setEditingBatch(b);
    setEditForm({ filename: b.filename || '' });
  }

  async function handleSaveEdit() {
    if (!editingBatch) return;
    setSavingEdit(true);
    try {
      await channelAPI.updateImport(editingBatch.id, { filename: editForm.filename });
      toast.success('Batch updated');
      setEditingBatch(null);
      loadHistory();
    } catch (err) {
      toast.error('Update failed: ' + err.message);
    }
    setSavingEdit(false);
  }

  function handleFileChange(e) {
    const f = e.target.files[0];
    if (!f) return;
    if (!f.name.match(/\.(xlsx|xls|csv)$/i)) {
      toast.error('Only .xlsx, .xls or .csv files are accepted');
      return;
    }
    setFile(f);
    setPreview(null);
    setIncludeWarnings(null);
  }

  async function handlePreview() {
    if (!file) {
      toast.error('Please select a file');
      return;
    }
    if (!selectedLevel) {
      toast.error('Pick the level you are importing before uploading');
      return;
    }
    setIncludeWarnings(null);
    setExpandedSection(null);
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('expected_level', String(selectedLevel));
      // No period is sent: the API stamps the batch with the current month,
      // because the workbook itself carries no date column.
      const data = await channelAPI.previewImport(formData);
      setPreview(data);
      const b = data.batch || {};
      toast.success(
        `Preview complete — ${b.valid_rows ?? 0} valid, ${b.duplicate_rows ?? 0} duplicate, ${b.rejected_rows ?? 0} rejected`
      );
    } catch (err) {
      toast.error('Preview failed: ' + err.message);
    }
    setImporting(false);
  }

  async function handleConfirm() {
    if (!preview) return;

    // Warned rows are only written on an explicit approval; without one the
    // operator would never know which rows landed.
    const warned = preview.batch?.warning_rows ?? 0;
    if (warned > 0 && includeWarnings === null) {
      toast.error('Choose whether to include or discard the warned rows first');
      return;
    }

    setImporting(true);
    try {
      // The preview staged the parsed rows server-side, so confirming only
      // needs the batch id — re-posting every row capped the import size.
      const data = await channelAPI.confirmImport({
        batch_id: preview.batch?.id,
        summary_rows: preview.summary_rows || [],
        include_warnings: warned > 0 ? includeWarnings === true : true,
      });
      const written = data.rows_committed ?? data.balances_written ?? 0;
      const discarded = data.discarded_rows ?? 0;
      const created = data.hierarchy_created ?? 0;
      toast.success(
        `Import complete — ${written.toLocaleString()} row(s) committed` +
          (created ? `, ${created.toLocaleString()} upline(s) created` : '') +
          (discarded ? `, ${discarded.toLocaleString()} warned row(s) discarded` : '')
      );
      setPreview(null);
      setFile(null);
      setIncludeWarnings(null);
      // Refresh both history and meta so the newly-imported data is reflected
      // on the page without requiring a remount.
      await Promise.all([loadHistory(), loadMeta()]);
    } catch (err) {
      toast.error('Import failed: ' + err.message);
    }
    setImporting(false);
  }

  // ── Preview summary, shared by the stats, the decision panel and confirm ──
  const batch = preview?.batch || {};
  const warningRows = batch.warning_rows ?? 0;
  const cleanRows = batch.clean_rows ?? Math.max((batch.valid_rows ?? 0) - warningRows, 0);
  const warningMessages = batch.warning_messages ?? 0;
  const needsWarningChoice = warningRows > 0 && includeWarnings === null;
  const rowsToWrite = includeWarnings === false ? cleanRows : (batch.valid_rows ?? 0);
  // The headline figure: the balance of the rows that will actually be written,
  // so discarding the warned rows moves it down accordingly.
  const totalBalance = includeWarnings === false
    ? Math.max((batch.detail_balance_total ?? 0) - (batch.warning_balance_total ?? 0), 0)
    : (batch.detail_balance_total ?? 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Batch Import</h1>
        <p className="text-sm text-gray-500 mt-1">
          Upload an Excel file with channel stock balance data. The system will validate, flag duplicates, and reconcile against the summary sheet.
        </p>
      </div>

      {/* Expected columns reference — one layout per IDC level */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h3 className="text-sm font-semibold text-blue-800">Expected Excel Columns</h3>
          <button
            onClick={() => handleDownloadTemplate(null)}
            className="flex items-center gap-2 px-3 py-1.5 bg-white border border-blue-300 text-blue-700 text-xs font-medium rounded-lg hover:bg-blue-100 transition shrink-0"
          >
            <Download size={14} /> All Levels Template (.xlsx)
          </button>
        </div>
        <p className="text-[11px] text-blue-700 mb-3">
          Each level has its own sheet layout and the <strong>layout identifies the level</strong> — there is no
          Category column to fill in. Upload one, two or all three sheets in the same workbook.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            {
              name: 'Distributor', level: 1, tone: 'text-indigo-800', border: 'border-indigo-200',
              cols: ['Distributor Name', 'Distributor Mobile Number', 'Distributor Status', 'Distributor Region', 'Air Time Type'],
            },
            {
              name: 'Sub-Distributor', level: 2, tone: 'text-cyan-800', border: 'border-cyan-200',
              cols: ['Sub Distributor Name', 'Sub Distributor Mobile Number', 'Sub Distributor Status', 'Distributor Name', 'Distributor Region', 'Distributor Contact', 'Air Time Type'],
            },
            {
              name: 'Retailer', level: 3, tone: 'text-emerald-800', border: 'border-emerald-200',
              cols: ['Retailer Name', 'Retailer Existing Business', 'Retailer Mobile Number', 'Retailer Status', 'Retailer Geographical Domain', 'Sub Distributor Name', 'Sub Distributor Contact', 'Distributor Name', 'Distributor Region', 'Distributor Contact', 'Retailer TIN (optional)', 'Retailer Location', 'Retailer National/Fayda ID', 'Air Time Type'],
            },
          ].map((sheet) => (
            <div key={sheet.name} className={`bg-white/70 rounded-lg border ${sheet.border} p-3`}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className={`text-xs font-semibold ${sheet.tone}`}>{sheet.name} sheet</p>
                <button
                  type="button"
                  onClick={() => handleDownloadTemplate(sheet.level)}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded border border-blue-200 text-blue-700 bg-white hover:bg-blue-50 transition shrink-0"
                >
                  <Download size={10} /> Download
                </button>
              </div>
              <ul className="space-y-1">
                {sheet.cols.map((col) => (
                  <li key={col} className="flex items-start gap-1.5 text-[11px] text-gray-700">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1 shrink-0" />
                    {col}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-blue-600 mt-3">
          Column headings are matched loosely, so the common source spellings (Distributer Region,
          Sub distributer contact) all work. The Retailer sheet also accepts <strong>Retailer TIN</strong>,
          <strong>Retailer Location</strong> and <strong>Retailer National/Fayda ID</strong> — all optional, and the only
          columns that are. The Distributor and Sub-Distributor sheets carry no Existing Business column, and the
          Sub-Distributor sheet no Geographical Domain either — a Sub-Distributor has no territory of its own.
          A Distributor or Sub-Distributor that a row names but the registry has not seen
          yet is created from that row's own name, contact and region, so one retailer file can build the whole chain.
        </p>
      </div>

      {/* ── Level selector ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-800 mb-1">What are you importing?</h3>
        <p className="text-[11px] text-gray-500 mb-4">
          Pick the level first so the system can match your columns against the right format.
          Each level has its own sheet layout — see the reference above.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { level: 1, label: 'Distributor', desc: 'Top of the chain. Has no upline.',
              active: 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-400', labelActive: 'text-indigo-800' },
            { level: 2, label: 'Sub-Distributor', desc: 'Belongs to a Distributor, carries Retailers.',
              active: 'border-cyan-500 bg-cyan-50 ring-1 ring-cyan-400', labelActive: 'text-cyan-800' },
            { level: 3, label: 'Retailer', desc: 'Belongs to a Sub-Distributor under a Distributor.',
              active: 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-400', labelActive: 'text-emerald-800' },
          ].map((opt) => (
            <button
              key={opt.level}
              type="button"
              onClick={() => { setSelectedLevel(opt.level); setPreview(null); }}
              className={
                'flex flex-col items-start p-4 rounded-xl border-2 text-left transition '
                + (selectedLevel === opt.level
                  ? opt.active
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50')
              }
            >
              <span className={
                'text-sm font-semibold '
                + (selectedLevel === opt.level ? opt.labelActive : 'text-gray-800')
              }>
                {opt.label}
              </span>
              <span className="text-[11px] text-gray-500 mt-0.5">{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Upload Section */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Excel File {!selectedLevel && <span className="text-gray-400 font-normal">— pick a level above first</span>}
            </label>
            <label className={
              'flex items-center justify-center w-full h-32 border-2 border-dashed rounded-lg transition '
              + (selectedLevel
                ? 'border-gray-300 cursor-pointer hover:border-blue-400 hover:bg-blue-50/30'
                : 'border-gray-200 bg-gray-50 cursor-not-allowed opacity-60')
            }>
              <div className="text-center">
                {file ? (
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet size={24} className="text-green-500" />
                    <div>
                      <p className="text-sm font-medium text-gray-800">{file.name}</p>
                      <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
                    </div>
                  </div>
                ) : (
                  <div>
                    <Upload size={24} className="text-gray-400 mx-auto mb-2" />
                    <p className="text-sm text-gray-600">Click to select file</p>
                    <p className="text-xs text-gray-400">.xlsx, .xls or .csv</p>
                  </div>
                )}
              </div>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileChange} className="hidden" disabled={!selectedLevel} />
            </label>
          </div>
        </div>
        <div className="flex gap-3 mt-4">
          <button
            onClick={handlePreview}
            disabled={!file || !selectedLevel || importing}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
          >
            {importing ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
            {selectedLevel ? `Preview ${LEVEL_LABEL[{ 1: 'distributor', 2: 'sub_distributor', 3: 'retailer' }[selectedLevel]]?.replace(' (L1)', '').replace(' (L2)', '').replace(' (L3)', '') || 'Import'}` : 'Pick a level first'}
          </button>
        </div>
      </div>

      {/* Preview Results */}
      {preview && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-gray-900">Import Preview</h3>
            {preview.batch?.period_month && (
              <span className="text-xs text-gray-500">
                Snapshot period <strong className="text-gray-700">{preview.batch.period_month.slice(0, 7)}</strong>
              </span>
            )}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Rows Read" value={preview.batch?.total_rows ?? 0} color="gray" />
            <StatCard label="Clean Rows" value={cleanRows} color="green" />
            <StatCard label="Warned Rows" value={warningRows} color="yellow" />
            <StatCard label="Rejected" value={preview.batch?.rejected_rows ?? 0} color="red" />
          </div>

          {/* What the workbook was understood to contain, level by level */}
          {(preview.sheets || []).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {preview.sheets.map((sh) => (
                <div key={sh.name} className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs">
                  <FileSpreadsheet size={13} className="text-gray-400" />
                  <span className="font-medium text-gray-800">{sh.name}</span>
                  <span className="text-gray-500">
                    {sh.kind === 'summary'
                      ? `${sh.rows} summary row(s)`
                      : sh.kind === 'detail'
                        ? `${sh.layout ? (LEVEL_LABEL[sh.layout] || sh.layout) : 'generic'} · ${sh.rows} row(s)`
                        : (sh.reason || 'skipped')}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Include / discard decision — nothing is written until it is made */}
          {warningRows > 0 && (
            <div className="border border-amber-300 bg-amber-50 rounded-lg p-4 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-amber-900">
                    {warningRows.toLocaleString()} row(s) have warnings — include them in the import?
                  </p>
                  <p className="text-xs text-amber-800 mt-0.5">
                    Warned rows are valid rows with missing or unusual optional data (no upline or owner
                    mobile, zero balance, …). They are staged but only written if you approve including them.
                  </p>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <WarningChoice
                  selected={includeWarnings === true}
                  onSelect={() => setIncludeWarnings(true)}
                  tone="emerald"
                  icon={<CheckCircle size={16} />}
                  title={`Include the ${warningRows.toLocaleString()} warned row(s)`}
                  detail="Import them together with the clean rows."
                />
                <WarningChoice
                  selected={includeWarnings === false}
                  onSelect={() => setIncludeWarnings(false)}
                  tone="red"
                  icon={<XCircle size={16} />}
                  title={`Discard the ${warningRows.toLocaleString()} warned row(s)`}
                  detail={`Import only the ${cleanRows.toLocaleString()} clean row(s) — the discards are logged on the batch.`}
                />
              </div>

              {needsWarningChoice && (
                <p className="text-xs font-medium text-amber-900">
                  Pick one of the options above to enable Confirm Import.
                </p>
              )}

              {(preview.warned_rows || []).length > 0 && (
                <ExpandableSection
                  title={`Review the ${warningRows.toLocaleString()} warned row(s)`}
                  icon={<AlertTriangle size={16} className="text-amber-500" />}
                  color="amber"
                  open={expandedSection === 'warnedRows'}
                  onToggle={() => setExpandedSection(expandedSection === 'warnedRows' ? null : 'warnedRows')}
                >
                  <RowTable rows={preview.warned_rows.slice(0, 100)} total={warningRows} />
                  {preview.warned_rows_truncated && (
                    <p className="text-xs text-gray-500 text-center py-2">
                      …listing the first {preview.warned_rows_returned.toLocaleString()} of{' '}
                      {warningRows.toLocaleString()} warned row(s)
                    </p>
                  )}
                </ExpandableSection>
              )}
            </div>
          )}

          {preview.rows_truncated && (
            <p className="text-xs text-gray-500">
              Listing the first {preview.rows_returned} valid row(s) of {preview.batch?.valid_rows ?? 0} for review —
              the whole file is staged on the server and is committed in one go.
            </p>
          )}

          {/* Existing data warning */}
          {preview.batch?.existing_balances_for_period > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-sm text-amber-800">
                <AlertTriangle size={14} className="inline mr-1 -mt-0.5" />
                <strong>{preview.batch.existing_balances_for_period}</strong> balance row(s) already exist for this period.
                Confirming will update them for matching channel users.
              </p>
            </div>
          )}

          {/* Total balance the file carries, for the rows that will be written */}
          {preview.batch && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs text-gray-500">Total Balance</p>
                <p className="text-2xl font-bold text-gray-900">ETB {totalBalance.toLocaleString()}</p>
              </div>
              <p className="text-xs text-gray-500 text-right max-w-[280px]">
                Sum of the {rowsToWrite.toLocaleString()} balance(s) that will be imported for{' '}
                <strong className="text-gray-700">{preview.batch.period_month?.slice(0, 7) || 'this period'}</strong>
                {includeWarnings === false && (
                  <> — the {warningRows.toLocaleString()} warned row(s) are excluded</>
                )}
              </p>
            </div>
          )}

          {/* ── Successful rows ─────────────────────────────────── */}
          {(() => {
            const succeeded = (preview.rows || []).filter((r) => !r.has_warning);
            const rejected  = (preview.errors || []).filter((e) => e.severity === 'reject');
            const warningReasons = (preview.errors || []).filter((e) => e.severity === 'warning');

            // Totals come from the batch header: the row sample above is capped
            // for display, so its length would under-report a large workbook.
            const succeededCount = cleanRows;
            const rejectedCount = batch.rejected_rows ?? rejected.length;

            return (
              <div className="space-y-3">
                {/* Successful */}
                {succeededCount > 0 && (
                  <ExpandableSection
                    title={`${succeededCount.toLocaleString()} successful row(s) — no issues`}
                    icon={<CheckCircle size={16} className="text-emerald-500" />}
                    color="emerald"
                    open={expandedSection === 'successful'}
                    onToggle={() => setExpandedSection(expandedSection === 'successful' ? null : 'successful')}
                  >
                    <RowTable rows={succeeded.slice(0, 100)} total={succeededCount} />
                  </ExpandableSection>
                )}

                {/* Warning reasons — why the rows above were flagged */}
                {warningMessages > 0 && (
                  <ExpandableSection
                    title={`${warningMessages.toLocaleString()} warning(s) across ${warningRows.toLocaleString()} row(s) — reason breakdown`}
                    icon={<AlertTriangle size={16} className="text-amber-500" />}
                    color="amber"
                    open={expandedSection === 'warnings'}
                    onToggle={() => setExpandedSection(expandedSection === 'warnings' ? null : 'warnings')}
                  >
                    <ErrorTable errors={warningReasons} />
                  </ExpandableSection>
                )}

                {/* Rejected */}
                {rejectedCount > 0 && (
                  <ExpandableSection
                    title={`${rejectedCount.toLocaleString()} row(s) rejected — could not be processed`}
                    icon={<XCircle size={16} className="text-red-500" />}
                    color="red"
                    open={expandedSection === 'rejected'}
                    onToggle={() => setExpandedSection(expandedSection === 'rejected' ? null : 'rejected')}
                  >
                    <ErrorTable errors={rejected} />
                  </ExpandableSection>
                )}
              </div>
            );
          })()}

          {/* Confirm */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleConfirm}
              disabled={importing || needsWarningChoice}
              title={needsWarningChoice ? 'Choose whether to include or discard the warned rows first' : undefined}
              className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
              {needsWarningChoice
                ? 'Choose include or discard above'
                : includeWarnings === false
                  ? `Confirm Import — skip ${warningRows.toLocaleString()} warned row(s)`
                  : `Confirm Import — write ${rowsToWrite.toLocaleString()} row(s)`}
            </button>
            <button
              onClick={() => { setPreview(null); setFile(null); setIncludeWarnings(null); }}
              className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Import History ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <History size={16} className="text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-800">Import History</h3>
            {history.length > 0 && (
              <span className="text-xs text-gray-400">{history.length} batch{history.length !== 1 ? 'es' : ''}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleClearImportedData}
              disabled={clearing}
              title="Remove every imported user and all import history"
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition"
            >
              {clearing ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Clear imported data
            </button>
            <button
              onClick={handleExportHistory}
              disabled={historyLoading || history.length === 0}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition"
            >
              <Download size={13} /> Export CSV
            </button>
            <button
              onClick={loadHistory}
              disabled={historyLoading}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition"
            >
              <RefreshCw size={13} className={historyLoading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>

        {historyLoading ? (
          <div className="flex items-center justify-center py-10 text-gray-400">
            <Loader2 size={20} className="animate-spin mr-2" /> Loading history…
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-10 text-gray-400 text-sm">
            No imports yet. Upload a workbook above to get started.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-3 px-4 font-semibold text-gray-600">Import ID</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-600">Imported</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-600">File</th>
                  <th className="text-center py-3 px-4 font-semibold text-gray-600">Period</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-600">Rows</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-600">New / Upd</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-600">Rejected</th>
                  <th className="text-center py-3 px-4 font-semibold text-gray-600">Warned</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-600">Balance</th>
                  <th className="text-center py-3 px-4 font-semibold text-gray-600">Status</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-600">By</th>
                  <th className="text-center py-3 px-4 font-semibold text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {history.map((b) => {
                  return (
                    <tr key={b.id} className="border-t border-gray-50 hover:bg-gray-50">
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="font-mono text-xs font-semibold text-blue-700" title={`Batch ${b.id}`}>
                          {b.import_code || '—'}
                        </span>
                        <span
                          className="block text-[10px] text-gray-400"
                          title="Users this import still owns — what deleting it removes"
                        >
                          {Number(b.owned_entities || 0).toLocaleString()} user{Number(b.owned_entities) === 1 ? '' : 's'} on file
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-600 text-xs whitespace-nowrap">
                        {b.created_at ? formatDate(b.created_at) : '—'}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-gray-700 max-w-[220px] truncate" title={b.filename}>
                        {b.filename}
                      </td>
                      <td className="text-center py-3 px-4 text-gray-700 text-xs whitespace-nowrap">
                        {b.period_month ? String(b.period_month).slice(0, 7) : '—'}
                      </td>
                      <td className="text-right py-3 px-4 text-gray-700">{b.valid_rows ?? '—'}</td>
                      <td className="text-right py-3 px-4 text-xs whitespace-nowrap">
                        <span className="text-emerald-600 font-medium">{b.new_entities ?? 0}</span>
                        <span className="text-gray-300"> / </span>
                        <span className="text-amber-600 font-medium">{b.updated_rows ?? 0}</span>
                      </td>
                      <td className="text-right py-3 px-4 text-red-600">{b.rejected_rows ?? 0}</td>
                      <td className="text-center py-3 px-4 text-xs whitespace-nowrap">
                        {(b.warning_rows ?? 0) === 0 ? (
                          <span className="text-gray-300">—</span>
                        ) : (
                          <>
                            <span
                              className="text-amber-600 font-medium"
                              title={`${b.warning_rows} row(s) had warnings`}
                            >
                              {b.warning_rows}
                            </span>
                            {Number(b.discarded_rows) > 0 && (
                              <span className="text-gray-400" title="Discarded at confirm time">
                                {' '}({b.discarded_rows} dropped)
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="text-right py-3 px-4 text-gray-700 whitespace-nowrap">
                        ETB {Number(b.detail_balance_total || 0).toLocaleString()}
                      </td>
                      <td className="text-center py-3 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          b.status === 'completed' ? 'bg-green-100 text-green-700'
                            : b.status === 'failed' ? 'bg-red-100 text-red-700'
                            : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {b.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-600 text-xs">{b.imported_by || '—'}</td>
                      <td className="text-center py-3 px-4">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openEdit(b)}
                            className="p-1.5 rounded hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition"
                            title="Edit label"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteBatch(b)}
                            className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 transition"
                            title="Delete import and its data"
                          >
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

      {/* ── Edit batch modal ───────────────────────────────────────────── */}
      {editingBatch && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setEditingBatch(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Edit Import</h3>
                <p className="text-xs text-gray-500 mt-0.5 font-mono truncate max-w-[280px]">{editingBatch.filename}</p>
              </div>
              <button onClick={() => setEditingBatch(null)} className="p-1 rounded hover:bg-gray-100">
                <X size={18} className="text-gray-500" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Label / filename</label>
                <input
                  value={editForm.filename}
                  onChange={(e) => setEditForm({ ...editForm, filename: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                This batch wrote <strong>{editingBatch.valid_rows ?? 0}</strong> balance row(s) across{' '}
                <strong>{editingBatch.new_entities ?? 0}</strong> new and{' '}
                <strong>{editingBatch.updated_rows ?? 0}</strong> updated channel user(s).
              </div>

              <div className="flex justify-end gap-3 pt-1">
                <button
                  onClick={() => setEditingBatch(null)}
                  className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={savingEdit}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
                >
                  {savingEdit ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }) {
  const colors = {
    gray: 'bg-gray-50 text-gray-700 border-gray-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    yellow: 'bg-amber-50 text-amber-700 border-amber-200',
    red: 'bg-red-50 text-red-700 border-red-200',
  };
  return (
    <div className={'rounded-lg border p-3 text-center ' + (colors[color] || colors.gray)}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs font-medium mt-0.5">{label}</p>
    </div>
  );
}

/** One of the two include/discard options shown for rows that carry warnings. */
function WarningChoice({ selected, onSelect, tone, icon, title, detail }) {
  const tones = {
    emerald: {
      box: selected ? 'border-emerald-500 ring-2 ring-emerald-200' : 'border-gray-200 hover:border-emerald-300',
      text: 'text-emerald-700',
    },
    red: {
      box: selected ? 'border-red-500 ring-2 ring-red-200' : 'border-gray-200 hover:border-red-300',
      text: 'text-red-700',
    },
  };
  const t = tones[tone] || tones.emerald;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={'text-left bg-white rounded-lg border p-3 transition cursor-pointer ' + t.box}
    >
      <span className={'flex items-center gap-2 text-sm font-semibold ' + t.text}>
        {icon}
        {title}
      </span>
      <span className="block text-xs text-gray-600 mt-1">{detail}</span>
      <span className={'block text-[11px] font-medium mt-2 ' + (selected ? t.text : 'text-gray-400')}>
        {selected ? '✓ Selected' : 'Click to choose'}
      </span>
    </button>
  );
}

function ExpandableSection({ title, icon, color, open, onToggle, children }) {
  const bg = { emerald: 'bg-emerald-50 hover:bg-emerald-100', amber: 'bg-amber-50 hover:bg-amber-100', red: 'bg-red-50 hover:bg-red-100' };
  const text = { emerald: 'text-emerald-800', amber: 'text-amber-800', red: 'text-red-800' };
  const border = { emerald: 'border-emerald-200', amber: 'border-amber-200', red: 'border-red-200' };
  return (
    <div className={'border rounded-lg overflow-hidden ' + (border[color] || 'border-gray-200')}>
      <button
        onClick={onToggle}
        className={'w-full flex items-center justify-between px-4 py-3 text-sm font-medium transition ' + (bg[color] || 'bg-gray-50') + ' ' + (text[color] || 'text-gray-800')}
      >
        <span className="flex items-center gap-2">
          {icon}
          {title}
        </span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && <div className="max-h-72 overflow-y-auto bg-white">{children}</div>}
    </div>
  );
}

function RowTable({ rows, total }) {
  return (
    <div>
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="px-3 py-2 text-left text-gray-600">#</th>
            <th className="px-3 py-2 text-left text-gray-600">Sheet</th>
            <th className="px-3 py-2 text-left text-gray-600">Row</th>
            <th className="px-3 py-2 text-left text-gray-600">Name</th>
            <th className="px-3 py-2 text-left text-gray-600">Mobile</th>
            <th className="px-3 py-2 text-left text-gray-600">Category</th>
            <th className="px-3 py-2 text-right text-gray-600">Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
              <td className="px-3 py-1.5 text-gray-400">{i + 1}</td>
              <td className="px-3 py-1.5 text-gray-600">{r.sheet || '—'}</td>
              <td className="px-3 py-1.5 text-gray-600">{r.row ?? '—'}</td>
              <td className="px-3 py-1.5 text-gray-800 font-medium">{r.name || '—'}</td>
              <td className="px-3 py-1.5 text-gray-600 font-mono">{r.mobile || '—'}</td>
              <td className="px-3 py-1.5 text-gray-600">{r.category_code || '—'}</td>
              <td className="px-3 py-1.5 text-right text-gray-700">{Number(r.balance || 0).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {total > 100 && <p className="text-xs text-gray-500 text-center py-2">…and {total - 100} more rows</p>}
    </div>
  );
}

function ErrorTable({ errors }) {
  return (
    <div>
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="px-3 py-2 text-left text-gray-600">Sheet</th>
            <th className="px-3 py-2 text-left text-gray-600">Row</th>
            <th className="px-3 py-2 text-left text-gray-600">Mobile</th>
            <th className="px-3 py-2 text-left text-gray-600">Name</th>
            <th className="px-3 py-2 text-left text-gray-600">Reason</th>
          </tr>
        </thead>
        <tbody>
          {errors.slice(0, 100).map((e, i) => (
            <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
              <td className="px-3 py-1.5 text-gray-600">{e.sheet_name || '—'}</td>
              <td className="px-3 py-1.5 text-gray-600">{e.row_number ?? e.row ?? '—'}</td>
              <td className="px-3 py-1.5 text-gray-600 font-mono">{e.raw_data?.mobile || '—'}</td>
              <td className="px-3 py-1.5 text-gray-800">{e.raw_data?.name || '—'}</td>
              <td className="px-3 py-1.5 text-gray-700">{e.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {errors.length > 100 && <p className="text-xs text-gray-500 text-center py-2">…and {errors.length - 100} more rows</p>}
    </div>
  );
}
