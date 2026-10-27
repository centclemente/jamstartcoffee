import api from './axios';

export async function fetchKpiSummary(from, to, category = 'all') {
  const params = { from, to };
  if (category && category !== 'all') params.category = category;

  const response = await api.get('/analytics/kpiSummary', { params });
  return response.data;
}

export async function fetchSalesTrend(from, to, category = 'all') {
  const params = { from, to };
  if (category && category !== 'all') params.category = category;

  const response = await api.get('/analytics/salesTrend', { params });
  return response.data;
}

export async function fetchTopItems(from, to, limit = 10, category = 'all', order = 'desc') {
  const params = { from, to, limit, order };
  if (category && category !== 'all') params.category = category;

  const response = await api.get('/analytics/topItems', { params });
  return response.data;
}

export async function fetchCategoryBreakdown(from, to) {
  const response = await api.get('/analytics/categoryBreakdown', { params: { from, to } });
  return response.data;
}

export async function fetchSalesTable(from, to, page, pageSize, sortBy, sortOrder, item, category) {
  const params = { from, to, page, pageSize, sortBy, sortOrder };

  if (item) params.item = item;
  if (category && category !== 'all') params.category = category;

  const response = await api.get('/analytics/sales', { params });
  return response.data;
}