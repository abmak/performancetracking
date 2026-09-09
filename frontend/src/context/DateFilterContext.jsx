import { createContext, useContext, useState, useCallback } from 'react';
import { getDateFilter, setDateFilter } from '../utils/dateFilter';

const DateFilterContext = createContext(null);

export function DateFilterProvider({ children }) {
  const [startDate, setStartDateState] = useState(() => getDateFilter('global_start'));
  const [endDate, setEndDateState] = useState(() => getDateFilter('global_end'));

  const setStartDate = useCallback((val) => {
    setStartDateState(val);
    setDateFilter('global_start', val);
    // Also update module-specific filters for backward compatibility
    setDateFilter('dashboard_start', val);
    setDateFilter('reports_start', val);
    setDateFilter('alerts_start', val);
    setDateFilter('ai_start', val);
    setDateFilter('partner_start', val);
  }, []);

  const setEndDate = useCallback((val) => {
    setEndDateState(val);
    setDateFilter('global_end', val);
    setDateFilter('dashboard_end', val);
    setDateFilter('reports_end', val);
    setDateFilter('alerts_end', val);
    setDateFilter('ai_end', val);
    setDateFilter('partner_end', val);
  }, []);

  const setDateRange = useCallback((start, end) => {
    setStartDateState(start);
    setEndDateState(end);
    setDateFilter('global_start', start);
    setDateFilter('global_end', end);
    setDateFilter('dashboard_start', start);
    setDateFilter('dashboard_end', end);
    setDateFilter('reports_start', start);
    setDateFilter('reports_end', end);
    setDateFilter('alerts_start', start);
    setDateFilter('alerts_end', end);
    setDateFilter('ai_start', start);
    setDateFilter('ai_end', end);
    setDateFilter('partner_start', start);
    setDateFilter('partner_end', end);
  }, []);

  return (
    <DateFilterContext.Provider value={{ startDate, endDate, setStartDate, setEndDate, setDateRange }}>
      {children}
    </DateFilterContext.Provider>
  );
}

export function useDateFilter() {
  const ctx = useContext(DateFilterContext);
  if (!ctx) throw new Error('useDateFilter must be used within DateFilterProvider');
  return ctx;
}
