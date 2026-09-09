require('dotenv').config();
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { id: 1, email: 'admin@ethiotelecom.et', username: 'vasadmin', role_id: 1, role_name: 'Admin' },
  process.env.JWT_SECRET || 'vas-revenue-tracker-secret-key-2026', { expiresIn: '2h' }
);
const H = { Authorization: 'Bearer ' + token };
const base = 'http://localhost:5000/api/goal-cascade';

(async () => {
  // API has TWO targets: 10B (Jul 2026-Jun 2027) + 2B (May 2027-Apr 2028)
  const list = await (await fetch(`${base}?start_date=2026-07-01&end_date=2027-06-30`, { headers: H })).json();
  const api = list.find(c => (c.service_name || '').toLowerCase().includes('appl'));
  console.log('LIST full-year (Jul 2026-Jun 2027):');
  console.log('  effTarget:', api.effective_target, '(expect 10B + 2B*2/12 = 10.33B)');
  console.log('  window:', api.effective_start, '->', api.effective_end);
  console.log('  yearly:', api.effective_yearly_target, '| semi:', api.effective_semi_target, '| qtr:', api.effective_quarterly_target);

  // Detail — verify quarterly shows the merged months
  const d = await (await fetch(`${base}/${api.id}?start_date=2026-07-01&end_date=2027-06-30`, { headers: H })).json();
  console.log('DETAIL full-year:');
  console.log('  annual:', d.annual_target, '| window:', d.target_start_date, '->', d.target_end_date);
  console.log('  semis:', d.semiAnnual && d.semiAnnual.map(s => `${s.period_label} [${s.period_start}->${s.period_end}] ${s.target_amount}`));
  console.log('  quarters:', d.quarterly && d.quarterly.map(q => `${q.period_label} [${q.period_start}->${q.period_end}] ${q.target_amount}`));

  // 3-month window Aug-Oct 2026: only target 1 covers -> 10B/12*3 = 2.5B
  const d2 = await (await fetch(`${base}/${api.id}?start_date=2026-08-01&end_date=2026-10-31`, { headers: H })).json();
  console.log('DETAIL Aug-Oct 2026: annual:', d2.annual_target, '| Q1:', d2.quarterly && d2.quarterly.map(q => `${q.period_label} ${q.target_amount}`));
})();