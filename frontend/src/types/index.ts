// Auth
export interface TokenResponse {
  access_token: string;
  refresh_token: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

// Enums
export type UserRole = 'superadmin' | 'owner' | 'warehouse_manager' | 'operator';
export type UnitType = 'piece' | 'kg' | 'gram' | 'liter' | 'ml' | 'meter' | 'cm' | 'box' | 'pack';
export type MovementType = 'entry' | 'exit' | 'transfer' | 'adjustment';
export type LocationType = 'zone' | 'rack' | 'shelf' | 'position' | 'bin';
export type CycleCountStatus = 'draft' | 'in_progress' | 'completed' | 'cancelled';

// Entities
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Warehouse {
  id: string;
  name: string;
  address?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Location {
  id: string;
  warehouse_id: string;
  parent_id?: string;
  location_type: LocationType;
  name: string;
  label?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  parent_id?: string;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  description?: string;
  category_id?: string;
  unit_of_measure: UnitType;
  min_stock: number;
  max_stock?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Movement {
  id: string;
  product_id: string;
  from_location_id?: string;
  to_location_id?: string;
  quantity: number;
  movement_type: MovementType;
  user_id: string;
  reference?: string;
  notes?: string;
  supplier_id?: string;
  created_at: string;
}

export interface InventoryItem {
  id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  location_id: string;
  location_name: string;
  warehouse_id: string;
  quantity: number;
  min_stock: number;
}

// Pagination
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
}

// Alerts
export interface StockAlert {
  product_id: string;
  product_name: string;
  product_sku: string;
  location_id: string;
  location_name: string;
  warehouse_id: string;
  warehouse_name: string;
  current_quantity: number;
  min_stock: number;
  deficit: number;
  severity: 'critical' | 'low' | 'warning';
}

export interface AlertSummary {
  critical_count: number;
  low_count: number;
  warning_count: number;
  total_alerts: number;
}

// ABC Classification
export interface AbcItem {
  product_id: string;
  product_name: string;
  product_sku: string;
  movement_count: number;
  total_quantity: number;
  classification: 'A' | 'B' | 'C';
  cumulative_percentage: number;
}

export interface AbcSummary {
  a_count: number;
  b_count: number;
  c_count: number;
  a_movement_percentage: number;
  b_movement_percentage: number;
  c_movement_percentage: number;
}

export interface AbcReport {
  items: AbcItem[];
  summary: AbcSummary;
  period_days: number;
}

// Dashboard
export interface DashboardStats {
  total_products: number;
  total_warehouses: number;
  total_locations: number;
  total_stock_items: number;
  low_stock_count: number;
  movements_today: number;
  movements_this_week: number;
}
