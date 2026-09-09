import { useState, useEffect, useRef } from 'react';
import { Upload, FileSpreadsheet, CheckCircle, XCircle, Clock, Download, AlertTriangle, Eye, ArrowLeft, Trash2 } from 'lucide-react';
import { importsAPI } from '../services/api';
import { formatDate, formatCurrency } from '../utils/helpers';
import toast from 'react-hot-toast';

export default function Import() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [template, setTemplate] = useState(null);
  const fileRef = useRef();

  // Preview state
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [view, setView] = useState('upload'); // upload | preview | result
  // Detail modal for row inspection
  const [detailRow, setDetailRow] = useState(null);
  // Revenue month override
  const [revenueMonth, setRevenueMonth] = useState('');
  const [showInvalidRows, setShowInvalidRows] = useState(false);

  useEffect(() => { loadHistory(); loadTemplate(); }, []);

  async function loadHistory() {
    try { setHistory(await importsAPI.getHistory()); } catch { /* ignore */ }
  }

  async function loadTemplate() {
    try { setTemplate(await importsAPI.getTemplate()); } catch { /* ignore */ }
  }

  // Step 1: Preview the file
  async function handlePreview(e) {
    e.preventDefault();
    if (!file) { toast.error('Please select a file'); return; }
    setPreviewLoading(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await importsAPI.preview(formData);
      setPreviewData(res);
      setView('preview');
      if (res.summary.invalid > 0) {
        toast(`${res.summary.valid} valid, ${res.summary.invalid} invalid rows found`, { icon: '⚠️' });
      } else {
        toast.success(`${res.summary.valid} rows ready to import`);
      }
    } catch (err) {
      toast.error(err.message);
    }
    setPreviewLoading(false);
  }

  // Step 2: Confirm and import
  async function handleConfirmImport() {
    if (!previewData || previewData.summary.valid === 0) {
      toast.error('No valid rows to import');
      return;
    }
    setImporting(true);
    try {
      // Only send valid rows
      const validRows = previewData.rows
        .filter(r => r.status === 'valid')
        .map(r => ({
          service_id: r.data.service_id,
          service_name: r.data.service_name,
          partner_name: r.data.partner_name,
          amount: r.data.amount,
          notes: r.data.notes,
          row: r.row
        }));

      const res = await importsAPI.confirm({
        rows: validRows,
        filename: previewData.filename,
        imported_by: 'Admin',
        revenue_month: revenueMonth || undefined
      });
      setResult(res);
      setView('result');
      toast.success(`Successfully imported ${res.successful} records`);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      loadHistory();
    } catch (err) {
      toast.error(err.message);
    }
    setImporting(false);
  }

  // Go back to upload
  function handleBack() {
    setView('upload');
    setPreviewData(null);
    setResult(null);
    setRevenueMonth('');
  }

  // Delete import batch
  async function handleDeleteImport(id) {
    if (!confirm('Delete this import and all its revenue data?')) return;
    try {
      await importsAPI.delete(id);
      toast.success('Import deleted');
      loadHistory();
    } catch (err) { toast.error(err.message); }
  }

  function downloadTemplate() {
    if (!template) return;
    const csvContent = [
      template.columns.map(c => c.name).join(','),
      ...template.example_rows.map(r => template.columns.map(c => r[c.name] || '').join(','))
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'revenue_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Excel Import</h1>
        <p className="text-sm text-gray-500">Import revenue data from Excel or CSV files</p>
      </div>

      {/* Upload Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 p-6">

          {/* View: Upload */}
          {view === 'upload' && (
            <>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Upload Revenue Data</h3>
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
                <p className="text-xs font-semibold text-green-700 mb-1">📄 Your Excel file should have 2 columns:</p>
                <div className="flex gap-4 text-xs text-green-600">
                  <span className="font-mono bg-white px-2 py-0.5 rounded border border-green-300">Partner Name</span>
                  <span className="font-mono bg-white px-2 py-0.5 rounded border border-green-300">Total Revenue</span>
                </div>
                <p className="text-[10px] text-green-600 mt-1">Service name is matched from the sheet name. Revenue month is selected during import.</p>
              </div>
              <form onSubmit={handlePreview} className="space-y-4">
                <div
                  className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-green-400 transition cursor-pointer"
                  onClick={() => fileRef.current?.click()}
                >
                  <FileSpreadsheet className="mx-auto text-gray-400 mb-3" size={40} />
                  {file ? (
                    <div>
                      <p className="text-sm font-medium text-gray-900">{file.name}</p>
                      <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm text-gray-600">Click to select an Excel (.xlsx, .xls) or CSV file</p>
                      <p className="text-xs text-gray-400 mt-1">Max file size: 10MB</p>
                    </div>
                  )}
                </div>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => setFile(e.target.files[0])} />
                <button
                  type="submit"
                  disabled={!file || previewLoading}
                  className="w-full flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-3 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {previewLoading ? (
                    <><Clock size={16} className="animate-spin" /> Parsing file...</>
                  ) : (
                    <><Eye size={16} /> Preview Data</>
                  )}
                </button>
              </form>
            </>
          )}

          {/* View: Preview */}
          {view === 'preview' && previewData && (
            <>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <button onClick={handleBack} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600">
                    <ArrowLeft size={18} />
                  </button>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700">Preview: {previewData.filename}</h3>
                    <p className="text-xs text-gray-500">{previewData.total_rows} rows found</p>
                  </div>
                </div>
              </div>

              {/* Summary Cards */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-blue-600">{previewData.summary.total}</p>
                  <p className="text-xs text-blue-700">Total Rows</p>
                </div>
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-green-600">{previewData.summary.valid}</p>
                  <p className="text-xs text-green-700">Valid (Ready to Import)</p>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-red-600">{previewData.summary.invalid}</p>
                  <p className="text-xs text-red-700">Invalid (Will Skip)</p>
                </div>
              </div>

              {/* Service Breakdown */}
              {Object.keys(previewData.summary.services).length > 0 && (
                <div className="mb-4 bg-gray-50 rounded-lg p-3">
                  <p className="text-xs font-semibold text-gray-600 mb-2">Services Found:</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(previewData.summary.services).map(([svc, count]) => (
                      <span key={svc} className="px-2 py-1 bg-white rounded-full text-xs font-medium text-gray-700 border border-gray-200">
                        {svc} ({count})
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Unmatched Sheets Warning */}
              {previewData.summary.unmatched_sheets?.length > 0 && (
                <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle size={14} className="text-yellow-600" />
                    <p className="text-xs font-semibold text-yellow-700">Sheets with no matching VAS Service (will be skipped):</p>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {previewData.summary.unmatched_sheets.map((sheet) => (
                      <span key={sheet.name || sheet} className="px-2 py-1 bg-white rounded-full text-xs font-medium text-yellow-700 border border-yellow-300">
                        📄 {sheet.name || sheet}
                      </span>
                    ))}
                  </div>
                  <p className="text-[10px] text-yellow-600">To import this data, create a VAS Service with a matching name. Available services: {previewData.summary.unmatched_sheets[0]?.available_services?.join(', ') || 'Check VAS Services page'}</p>
                </div>
              )}

              {/* Invalid Rows Detail */}
              {previewData.summary.invalid > 0 && (
                <div className="mb-4">
                  <button
                    onClick={() => setShowInvalidRows(!showInvalidRows)}
                    className="w-full flex items-center justify-between bg-red-50 border border-red-200 rounded-lg p-3 hover:bg-red-100 transition"
                  >
                    <div className="flex items-center gap-2">
                      <XCircle size={14} className="text-red-500" />
                      <span className="text-xs font-semibold text-red-700">
                        {previewData.summary.invalid} Invalid Rows — Click to view details
                      </span>
                    </div>
                    <span className="text-red-500 text-xs">{showInvalidRows ? '▲ Hide' : '▼ Show'}</span>
                  </button>
                  {showInvalidRows && (
                    <div className="mt-2 border border-red-200 rounded-lg overflow-hidden">
                      {/* Error type breakdown */}
                      <div className="bg-red-50 p-3 border-b border-red-200">
                        <p className="text-xs font-semibold text-red-700 mb-2">Why rows were skipped:</p>
                        <div className="flex flex-wrap gap-2">
                          {(() => {
                            const invalidRows = previewData.rows.filter(r => r.status === 'invalid');
                            const errorGroups = {};
                            invalidRows.forEach(r => {
                              const err = r.errors?.[0] || 'Unknown';
                              errorGroups[err] = (errorGroups[err] || 0) + 1;
                            });
                            return Object.entries(errorGroups).map(([err, count]) => (
                              <span key={err} className="px-2 py-1 bg-white rounded-full text-xs font-medium text-red-700 border border-red-300">
                                {err} ({count})
                              </span>
                            ));
                          })()}
                        </div>
                      </div>
                      {/* Invalid rows table */}
                      <div className="max-h-64 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-red-100 sticky top-0">
                            <tr>
                              <th className="text-left py-2 px-3 font-semibold text-red-700">Row</th>
                              <th className="text-left py-2 px-3 font-semibold text-red-700">Sheet</th>
                              <th className="text-left py-2 px-3 font-semibold text-red-700">Partner</th>
                              <th className="text-right py-2 px-3 font-semibold text-red-700">Revenue</th>
                              <th className="text-left py-2 px-3 font-semibold text-red-700">Reason</th>
                            </tr>
                          </thead>
                          <tbody>
                            {previewData.rows
                              .filter(r => r.status === 'invalid')
                              .map((r) => (
                                <tr
                                  key={r.row}
                                  onClick={() => setDetailRow(r)}
                                  className="border-t border-red-100 bg-red-50 cursor-pointer hover:bg-red-100"
                                >
                                  <td className="py-2 px-3 text-gray-500">{r.row}</td>
                                  <td className="py-2 px-3 text-gray-600">{r.data.sheet || '—'}</td>
                                  <td className="py-2 px-3 text-gray-600 max-w-[150px] truncate" title={r.data.partner_name}>{r.data.partner_name || '—'}</td>
                                  <td className="py-2 px-3 text-right text-gray-600">{r.data.amount > 0 ? formatCurrency(r.data.amount) : '—'}</td>
                                  <td className="py-2 px-3">
                                    <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                                      <XCircle size={10} /> {r.errors?.join('; ') || 'Unknown'}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Preview Table */}
              <div className="max-h-96 overflow-y-auto border border-gray-200 rounded-lg mb-4">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="text-left py-2 px-3 font-semibold text-gray-600">Row</th>
                      <th className="text-left py-2 px-3 font-semibold text-gray-600">Status</th>
                      <th className="text-left py-2 px-3 font-semibold text-gray-600">Service</th>
                      <th className="text-left py-2 px-3 font-semibold text-gray-600">Partner</th>
                      <th className="text-right py-2 px-3 font-semibold text-gray-600">Revenue</th>
                      <th className="text-left py-2 px-3 font-semibold text-gray-600">Sheet</th>
                      <th className="text-left py-2 px-3 font-semibold text-gray-600">Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.rows.map((r) => (
                      <tr key={r.row} onClick={() => r.status === 'invalid' && setDetailRow(r)} className={`border-t border-gray-100 ${r.status === 'invalid' ? 'bg-red-50 cursor-pointer hover:bg-red-100' : 'hover:bg-green-50'}`}>
                        <td className="py-2 px-3 text-gray-500">{r.row}</td>
                        <td className="py-2 px-3">
                          {r.status === 'valid' ? (
                            <span className="inline-flex items-center gap-1 text-green-600 font-medium">
                              <CheckCircle size={12} /> Valid
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                              <XCircle size={12} /> Invalid
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 font-medium text-gray-900">{r.data.service_name || '—'}</td>
                        <td className="py-2 px-3 text-gray-600 max-w-[150px] truncate" title={r.data.partner_name}>{r.data.partner_name || '—'}</td>
                        <td className="py-2 px-3 text-right font-medium text-gray-900">{r.data.amount > 0 ? formatCurrency(r.data.amount) : '—'}</td>
                        <td className="py-2 px-3 text-gray-500 text-[10px]">{r.data.sheet || '—'}</td>
                        <td className="py-2 px-3 text-red-500 text-[10px]">{r.errors?.join('; ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Revenue Month Selector */}
              <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <div>
                    <label className="block text-xs font-semibold text-green-800 mb-1">Revenue Month *</label>
                    <select
                      value={revenueMonth ? revenueMonth.split('-')[1] : ''}
                      onChange={(e) => {
                        const year = revenueMonth ? revenueMonth.split('-')[0] : new Date().getFullYear();
                        if (e.target.value) setRevenueMonth(`${year}-${e.target.value}`);
                      }}
                      className="border border-green-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    >
                      <option value="">Select month</option>
                      <option value="01">January</option>
                      <option value="02">February</option>
                      <option value="03">March</option>
                      <option value="04">April</option>
                      <option value="05">May</option>
                      <option value="06">June</option>
                      <option value="07">July</option>
                      <option value="08">August</option>
                      <option value="09">September</option>
                      <option value="10">October</option>
                      <option value="11">November</option>
                      <option value="12">December</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-green-800 mb-1">Year *</label>
                    <select
                      value={revenueMonth ? revenueMonth.split('-')[0] : ''}
                      onChange={(e) => {
                        const month = revenueMonth ? revenueMonth.split('-')[1] : '';
                        if (e.target.value && month) setRevenueMonth(`${e.target.value}-${month}`);
                        else if (e.target.value) setRevenueMonth(`${e.target.value}-`);
                      }}
                      className="border border-green-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    >
                      <option value="">Select year</option>
                      <option value="2024">2024</option>
                      <option value="2025">2025</option>
                      <option value="2026">2026</option>
                      <option value="2027">2027</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <span className="text-xs text-green-600 pb-2">
                      {revenueMonth && revenueMonth.includes('-') && revenueMonth.split('-')[1]
                        ? `All rows will be imported as ${revenueMonth} revenue`
                        : 'Select month and year for this revenue data'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleBack}
                  className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition"
                >
                  <ArrowLeft size={14} /> Cancel
                </button>
                <button
                  onClick={handleConfirmImport}
                  disabled={previewData.summary.valid === 0 || importing || !revenueMonth || !revenueMonth.match(/^\d{4}-\d{2}$/)}
                  className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {importing ? (
                    <><Clock size={16} className="animate-spin" /> Importing...</>
                  ) : (
                    <><CheckCircle size={16} /> Approve & Import {previewData.summary.valid} Rows</>
                  )}
                </button>
              </div>
            </>
          )}

          {/* View: Result */}
          {view === 'result' && result && (
            <>
              <div className="text-center py-6">
                <CheckCircle className="mx-auto text-green-500 mb-3" size={48} />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Import Complete!</h3>
                <p className="text-sm text-gray-500 mb-6">Your data has been imported successfully</p>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-6">
                <div className="bg-gray-50 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-gray-900">{result.total_records}</p>
                  <p className="text-xs text-gray-500">Total Records</p>
                </div>
                <div className="bg-green-50 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-green-600">{result.successful}</p>
                  <p className="text-xs text-green-700">Imported</p>
                </div>
                {result.failed > 0 && (
                  <div className="bg-red-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-red-600">{result.failed}</p>
                    <p className="text-xs text-red-700">Failed</p>
                  </div>
                )}
              </div>
              {result.errors?.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 max-h-40 overflow-y-auto">
                  {result.errors.map((err, i) => <p key={i} className="text-xs text-red-600">{err}</p>)}
                </div>
              )}
              <button
                onClick={handleBack}
                className="w-full flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-3 rounded-lg text-sm font-medium hover:bg-green-700 transition"
              >
                <Upload size={16} /> Import Another File
              </button>
            </>
          )}
        </div>

        {/* Template Info */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Import Template</h3>
          {template && (
            <div className="space-y-4">
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">How it works</h4>
                <div className="space-y-2 text-xs text-gray-600">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 w-5 h-5 rounded-full bg-green-100 text-green-600 flex items-center justify-center font-bold text-[10px]">1</span>
                    <p>Select your Excel/CSV file</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 w-5 h-5 rounded-full bg-green-100 text-green-600 flex items-center justify-center font-bold text-[10px]">2</span>
                    <p>Preview the parsed data — review valid/invalid rows</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 w-5 h-5 rounded-full bg-green-100 text-green-600 flex items-center justify-center font-bold text-[10px]">3</span>
                    <p>Select <strong>Revenue Month</strong>, then click Approve to import</p>
                  </div>
                </div>
              </div>
              <div className="pt-2 border-t">
                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Required Columns</h4>
                <div className="space-y-2">
                  {template.columns.map((col) => (
                    <div key={col.name} className="flex items-start gap-2">
                      <span className={`mt-0.5 w-2 h-2 rounded-full ${col.required ? 'bg-red-500' : 'bg-gray-300'}`} />
                      <div>
                        <p className="text-sm font-medium text-gray-900 font-mono">{col.name}</p>
                        <p className="text-xs text-gray-500">{col.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="pt-2 border-t">
                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">How Service Names Are Matched</h4>
                <div className="text-xs text-gray-500 space-y-1">
                  <p>The <strong>sheet name</strong> in your Excel file is matched to a registered VAS Service.</p>
                  <p>Service is selected <strong>during import</strong> — not required in the Excel file.</p>
                  <p>Revenue month is also selected <strong>during import</strong> — not in the Excel file.</p>
                </div>
              </div>
              <button
                onClick={downloadTemplate}
                className="w-full flex items-center justify-center gap-2 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition"
              >
                <Download size={14} /> Download Template CSV
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Import History */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Import History</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-3 px-4 font-semibold text-gray-600">Date</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-600">Filename</th>
                <th className="text-center py-3 px-4 font-semibold text-gray-600">Total</th>
                <th className="text-center py-3 px-4 font-semibold text-gray-600">Success</th>
                <th className="text-center py-3 px-4 font-semibold text-gray-600">Failed</th>
                <th className="text-center py-3 px-4 font-semibold text-gray-600">Status</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-600">Imported By</th>
                <th className="text-center py-3 px-4 font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-gray-400">No import history yet</td></tr>
              ) : (
                history.map((h) => (
                  <tr key={h.id} className="border-t border-gray-50 hover:bg-gray-50">
                    <td className="py-3 px-4">{formatDate(h.created_at)}</td>
                    <td className="py-3 px-4 font-mono text-xs">{h.filename}</td>
                    <td className="text-center py-3 px-4">{h.total_records}</td>
                    <td className="text-center py-3 px-4 text-green-600 font-medium">{h.successful_records}</td>
                    <td className="text-center py-3 px-4 text-red-600 font-medium">{h.failed_records}</td>
                    <td className="text-center py-3 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${h.status === 'completed' ? 'bg-green-100 text-green-700' : h.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {h.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-600">{h.imported_by}</td>
                    <td className="text-center py-3 px-4">
                      <button onClick={() => handleDeleteImport(h.id)} className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 transition" title="Delete import">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {/* Row Detail Modal */}
      {detailRow && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setDetailRow(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <div className="flex items-center gap-2">
                <XCircle size={18} className="text-red-500" />
                <h3 className="font-semibold text-gray-900">Row {detailRow.row} — Import Error Details</h3>
              </div>
              <button onClick={() => setDetailRow(null)} className="p-1 rounded hover:bg-gray-100"><X size={18} /></button>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto max-h-[60vh]">
              {/* Errors */}
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-xs font-semibold text-red-700 mb-2">Errors:</p>
                {detailRow.errors.map((err, i) => (
                  <p key={i} className="text-sm text-red-600 flex items-start gap-1">
                    <span className="text-red-400 mt-0.5">•</span> {err}
                  </p>
                ))}
                {detailRow.error_detail && (
                  <p className="text-xs text-red-500 mt-2 italic">{detailRow.error_detail}</p>
                )}
              </div>

              {/* Row Data */}
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">Parsed Data:</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-[10px] text-gray-500 uppercase">Sheet Name</p>
                    <p className="text-sm font-medium text-gray-900">{detailRow.data.sheet || '—'}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-[10px] text-gray-500 uppercase">Matched Service</p>
                    <p className="text-sm font-medium text-gray-900">{detailRow.data.service_name || '—'}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-[10px] text-gray-500 uppercase">Partner Name</p>
                    <p className="text-sm font-medium text-gray-900">{detailRow.data.partner_name || '—'}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-[10px] text-gray-500 uppercase">Revenue Amount</p>
                    <p className="text-sm font-medium text-gray-900">{detailRow.data.amount > 0 ? formatCurrency(detailRow.data.amount) : '—'}</p>
                  </div>
                </div>
              </div>

              {/* Raw Row Data */}
              {detailRow.data.raw && (
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-2">Raw Excel Data:</p>
                  <div className="bg-gray-900 text-green-400 rounded-lg p-3 text-xs font-mono overflow-x-auto">
                    {detailRow.data.raw}
                  </div>
                </div>
              )}

              {/* Available Services (for unmatched sheets) */}
              {previewData.summary.unmatched_sheets?.some(s => (s.name || s) === detailRow.data.sheet) && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <p className="text-xs font-semibold text-green-700 mb-2">💡 How to fix:</p>
                  <p className="text-sm text-green-600">This sheet name doesn't match any VAS Service. Go to <strong>VAS Services</strong> and create a service with a name matching "{detailRow.data.sheet}" to enable importing this data.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
