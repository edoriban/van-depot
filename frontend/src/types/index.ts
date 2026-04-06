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

export type MovementReason = 'purchase_receive' | 'purchase_return' | 'quality_reject' | 'scrap' | 'loss_theft' | 'loss_damage' | 'production_input' | 'production_output' | 'manual_adjustment' | 'cycle_count';

export interface Movement {
  id: string;
  product_id: string;
  from_location_id?: string;
  to_location_id?: string;
  quantity: number;
  movement_type: MovementType;
  movement_reason: MovementReason | null;
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

// Warehouse Map
export type ZoneSeverity = 'critical' | 'low' | 'warning' | 'ok' | 'empty';

export interface ZoneHealth {
  zone_id: string;
  zone_name: string;
  severity: ZoneSeverity;
  critical_count: number;
  low_count: number;
  warning_count: number;
  ok_count: number;
  total_items: number;
  child_location_count: number;
}

export interface WarehouseMapResponse {
  zones: ZoneHealth[];
  summary: {
    total_zones: number;
    critical_zones: number;
    low_zones: number;
    warning_zones: number;
    ok_zones: number;
    empty_zones: number;
  };
}

// Notifications
export type NotificationType = 'stock_critical' | 'stock_low' | 'stock_warning' | 'cycle_count_due' | 'system';

export interface Notification {
  id: string;
  notification_type: NotificationType;
  title: string;
  body: string;
  is_read: boolean;
  reference_id: string | null;
  reference_type: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
}

export interface PaginatedNotifications {
  data: Notification[];
  total: number;
  page: number;
  per_page: number;
}

export interface UnreadCount {
  count: number;
}

export interface ReadAllResponse {
  updated: number;
}

export interface DailySummary {
  total_today: number;
  unread_today: number;
  by_type: {
    stock_critical: number;
    stock_low: number;
    stock_warning: number;
    cycle_count_due: number;
    system: number;
  };
}

export interface GenerateResponse {
  created: number;
  skipped: number;
}

// Recipes
export interface Recipe {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  is_active: boolean;
  item_count: number;
  created_at: string;
  updated_at: string;
}

export interface RecipeItem {
  id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  unit_of_measure: string;
  quantity: number;
  notes: string | null;
}

export interface RecipeDetail {
  recipe: Recipe;
  items: RecipeItem[];
}

export interface RecipeItemInput {
  product_id: string;
  quantity: number;
  notes?: string;
}

export interface ItemAvailability {
  product_id: string;
  product_name: string;
  product_sku: string;
  required_quantity: number;
  available_quantity: number;
  status: 'available' | 'insufficient' | 'out_of_stock';
}

export interface AvailabilityResponse {
  items: ItemAvailability[];
  all_available: boolean;
}

export interface DispatchResponse {
  movements_created: number;
}

// Supplier Products
export interface SupplierProduct {
  id: string;
  supplier_id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  supplier_sku: string | null;
  unit_cost: number;
  lead_time_days: number;
  minimum_order_qty: number;
  is_preferred: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SupplierProductWithSupplier extends SupplierProduct {
  supplier_name: string;
}

// Product Lots
export type QualityStatus = 'pending' | 'approved' | 'rejected' | 'quarantine';

export interface ProductLot {
  id: string;
  product_id: string;
  lot_number: string;
  batch_date: string | null;
  expiration_date: string | null;
  supplier_id: string | null;
  received_quantity: number;
  quality_status: QualityStatus;
  notes: string | null;
  total_quantity: number;
  created_at: string;
  updated_at: string;
}

export interface InventoryLot {
  id: string;
  product_lot_id: string;
  location_id: string;
  location_name: string;
  quantity: number;
  created_at: string;
  updated_at: string;
}

export interface ReceiveLotRequest {
  product_id: string;
  lot_number: string;
  location_id: string;
  good_quantity: number;
  defect_quantity?: number;
  supplier_id?: string;
  batch_date?: string;
  expiration_date?: string;
  notes?: string;
}

// Stock Configuration
export interface StockConfig {
  id: string;
  warehouse_id: string | null;
  product_id: string | null;
  default_min_stock: number;
  critical_stock_multiplier: number;
  low_stock_multiplier: number;
  created_at: string;
  updated_at: string;
}
