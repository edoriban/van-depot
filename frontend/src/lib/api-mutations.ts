import { useAuthStore } from '@/stores/auth-store';
import type {
  ClassLockStatus,
  CompleteWorkOrderInput,
  CreateWorkOrderInput,
  IssueWorkOrderInput,
  PaginatedResponse,
  Product,
  ProductClass,
  WorkOrder,
  WorkOrderDetail,
  WorkOrderStatus,
} from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100';

/**
 * Rich API error that preserves the HTTP status, the parsed JSON body, and
 * the typed error `code` emitted by the backend (e.g.
 * `INSUFFICIENT_WORK_ORDER_STOCK`, `WORK_ORDER_INVALID_TRANSITION`). UI code
 * can branch on `err.code` to render field-level toasts vs. per-row error
 * surfaces (design §4 / §8 of work-orders-and-bom).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    const message =
      (typeof body.error === 'string' && body.error) ||
      (typeof body.message === 'string' && body.message) ||
      `HTTP ${status}`;
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = typeof body.code === 'string' ? body.code : undefined;
    this.body = body;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

async function refreshAndRetry<T>(path: string, options?: RequestInit): Promise<T> {
  // Attempt token refresh
  const refreshRes = await fetch('/api/auth/refresh', { method: 'POST' });
  if (!refreshRes.ok) {
    // Refresh failed — logout and redirect
    useAuthStore.getState().logout();
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new Error('Session expired');
  }

  // Get new in-memory token from /api/auth/me
  const meRes = await fetch('/api/auth/me');
  if (meRes.ok) {
    const meData: { token: string } = await meRes.json();
    useAuthStore.getState().setAccessToken(meData.token);
  }

  // Retry original request with new token
  return request<T>(path, options, /* retry */ false);
}

async function request<T>(
  path: string,
  options?: RequestInit,
  allowRetry = true,
): Promise<T> {
  const token = useAuthStore.getState().accessToken;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (res.status === 401 && allowRetry) {
    return refreshAndRetry<T>(path, options);
  }

  if (!res.ok) {
    const body = (await res
      .json()
      .catch(() => ({ error: 'Request failed' }))) as Record<string, unknown>;
    throw new ApiError(res.status, body);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) =>
    request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) =>
    request<T>(path, { method: 'DELETE' }),
};

// ──────────────────────────────────────────────────────────────────────
// Product-classification endpoints
// ──────────────────────────────────────────────────────────────────────

export function getProductClassLock(id: string): Promise<ClassLockStatus> {
  return api.get<ClassLockStatus>(`/products/${id}/class-lock`);
}

export function reclassifyProduct(
  id: string,
  product_class: ProductClass,
): Promise<Product> {
  return api.patch<Product>(`/products/${id}/class`, { product_class });
}

// ──────────────────────────────────────────────────────────────────────
// Work order endpoints (work-orders-and-bom)
// ──────────────────────────────────────────────────────────────────────

export interface ListWorkOrdersParams {
  status?: WorkOrderStatus;
  warehouse_id?: string;
  work_center_location_id?: string;
  search?: string;
  page?: number;
  per_page?: number;
}

export function listWorkOrders(
  params: ListWorkOrdersParams = {},
): Promise<PaginatedResponse<WorkOrder>> {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.warehouse_id) qs.set('warehouse_id', params.warehouse_id);
  if (params.work_center_location_id)
    qs.set('work_center_location_id', params.work_center_location_id);
  if (params.search) qs.set('search', params.search);
  qs.set('page', String(params.page ?? 1));
  qs.set('per_page', String(params.per_page ?? 20));
  return api.get<PaginatedResponse<WorkOrder>>(`/work-orders?${qs}`);
}

export function getWorkOrder(id: string): Promise<WorkOrderDetail> {
  return api.get<WorkOrderDetail>(`/work-orders/${id}`);
}

export function createWorkOrder(
  body: CreateWorkOrderInput,
): Promise<WorkOrder> {
  return api.post<WorkOrder>('/work-orders', body);
}

export function issueWorkOrder(
  id: string,
  body: IssueWorkOrderInput = {},
): Promise<WorkOrder> {
  return api.post<WorkOrder>(`/work-orders/${id}/issue`, body);
}

export function completeWorkOrder(
  id: string,
  body: CompleteWorkOrderInput = {},
): Promise<WorkOrder> {
  return api.post<WorkOrder>(`/work-orders/${id}/complete`, body);
}

export function cancelWorkOrder(id: string): Promise<WorkOrder> {
  return api.post<WorkOrder>(`/work-orders/${id}/cancel`, {});
}
