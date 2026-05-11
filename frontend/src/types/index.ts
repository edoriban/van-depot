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
export type LocationType =
  | 'zone'
  | 'rack'
  | 'shelf'
  | 'position'
  | 'bin'
  | 'reception'
  | 'storage'
  | 'work_center'
  | 'finished_good';
export type CycleCountStatus = 'draft' | 'in_progress' | 'completed' | 'cancelled';
export type ProductClass = 'raw_material' | 'consumable' | 'tool_spare';

export const PRODUCT_CLASS_VALUES: ReadonlyArray<ProductClass> = [
  'raw_material',
  'consumable',
  'tool_spare',
] as const;

export const PRODUCT_CLASS_LABELS: Record<ProductClass, string> = {
  raw_material: 'Materia prima',
  consumable: 'Consumible',
  tool_spare: 'Herramienta / refacción',
};

/**
 * Short labels for compact surfaces like chip rows and table badges.
 * Plural for list/filter contexts, e.g. `[Todos | Materia prima | Consumibles | Herramientas]`.
 */
export const PRODUCT_CLASS_LABELS_SHORT: Record<ProductClass, string> = {
  raw_material: 'Materia prima',
  consumable: 'Consumible',
  tool_spare: 'Herramienta',
};

export const PRODUCT_CLASS_BADGE_CLASSES: Record<ProductClass, string> = {
  raw_material:
    'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  consumable:
    'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  tool_spare:
    'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200',
};

// Entities
export interface User {
  id: string;
  email: string;
  name: string;
  /**
   * Legacy single-role field. Multi-tenant foundation (A16-A19) replaced
   * the global `users.role` column with per-tenant memberships, but the
   * frontend still derives a coarse legacy role for UI gates that have
   * not yet been migrated to consult `useAuthStore.activeTenant.role` or
   * `useAuthStore.isSuperadmin`. Mapping applied in `auth-store.ts`:
   *   superadmin            → 'superadmin'
   *   tenant role 'owner'   → 'owner'
   *   tenant role 'manager' → 'warehouse_manager'
   *   tenant role 'operator'→ 'operator'
   */
  role?: UserRole;
  is_superadmin?: boolean;
  is_active: boolean;
  must_set_password?: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Multi-tenant role enum used in `user_tenants(role)` and surfaced via
 * `LoginResponse.Final.role` and `MembershipDto.role`. See
 * `sdd/multi-tenant-foundation/design` §3.2 / §6.
 */
export type TenantRole = 'owner' | 'manager' | 'operator';

export const TENANT_ROLE_VALUES: ReadonlyArray<TenantRole> = [
  'owner',
  'manager',
  'operator',
] as const;

export const TENANT_ROLE_LABELS: Record<TenantRole, string> = {
  owner: 'Propietario',
  manager: 'Gerente',
  operator: 'Operador',
};

/** Tenant identity surfaced in login + admin endpoints. */
export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Slimmed tenant identity carried in the auth store's `activeTenant` (no
 * timestamps; only what the UI needs to display the active session).
 */
export interface ActiveTenant {
  id: string;
  slug: string;
  name: string;
}

/** Membership entry as returned in `LoginResponse.MultiTenant.memberships`. */
export interface AvailableTenant {
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  role: TenantRole;
}

/**
 * Wire shape for `POST /auth/login` and `POST /auth/select-tenant`.
 * The backend uses `#[serde(untagged)]`, so the discriminator is the
 * presence/absence of `access_token` (Final) vs `intermediate_token`
 * (MultiTenant). See `sdd/multi-tenant-foundation/design` §6.
 */
export type LoginResponse = LoginResponseFinal | LoginResponseMultiTenant;

export interface LoginResponseFinal {
  access_token: string;
  refresh_token: string;
  user: { id: string; email: string; name: string; is_superadmin: boolean };
  tenant: { id: string; slug: string; name: string } | null;
  role: TenantRole | null;
  is_superadmin: boolean;
}

export interface LoginResponseMultiTenant {
  intermediate_token: string;
  memberships: AvailableTenant[];
}

export interface CreateUserResponse extends User {
  invite_code?: string;
  invite_expires_at?: string;
}

export interface Warehouse {
  id: string;
  name: string;
  address?: string;
  is_active: boolean;
  canvas_width?: number | null;
  canvas_height?: number | null;
  created_at: string;
  updated_at: string;
}

export interface WarehouseWithStats extends Warehouse {
  locations_count: number;
  products_count: number;
  total_quantity: number;
  low_stock_count: number;
  critical_count: number;
  last_movement_at?: string | null;
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
  product_class: ProductClass;
  has_expiry: boolean;
  /**
   * Marks the product as internally-manufactured: it can be the finished-good
   * target of a work order. Backend invariant: only products with
   * `product_class === 'raw_material'` can carry `is_manufactured = true`.
   */
  is_manufactured: boolean;
  min_stock: number;
  max_stock?: number;
  is_active: boolean;
  created_by?: string | null;
  updated_by?: string | null;
  updated_by_email?: string | null;
  created_by_email?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClassLockStatus {
  locked: boolean;
  movements: number;
  lots: number;
  tool_instances: number;
}

export interface CreateProductInput {
  name: string;
  sku: string;
  description?: string;
  category_id?: string;
  unit_of_measure: UnitType;
  product_class: ProductClass;
  has_expiry: boolean;
  is_manufactured?: boolean;
  min_stock: number;
  max_stock?: number;
}

export interface UpdateProductInput {
  name?: string;
  sku?: string;
  description?: string;
  category_id?: string;
  unit_of_measure?: UnitType;
  has_expiry?: boolean;
  is_manufactured?: boolean;
  min_stock?: number;
  max_stock?: number;
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

export type MovementReason =
  | 'purchase_receive'
  | 'purchase_return'
  | 'quality_reject'
  | 'scrap'
  | 'loss_theft'
  | 'loss_damage'
  | 'production_input'
  | 'production_output'
  | 'manual_adjustment'
  | 'cycle_count'
  | 'wo_issue'
  | 'back_flush'
  | 'wo_cancel_reversal';

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
  purchase_order_id?: string | null;
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
  pos_x?: number | null;
  pos_y?: number | null;
  width?: number | null;
  height?: number | null;
}

export interface ZoneHealthWithLayout extends ZoneHealth {
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
}

export interface WarehouseMapResponse {
  zones: ZoneHealth[];
  canvas_width?: number;
  canvas_height?: number;
  summary: {
    total_zones: number;
    critical_zones: number;
    low_zones: number;
    warning_zones: number;
    ok_zones: number;
    empty_zones: number;
  };
}

export interface LocationPosition {
  id: string;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
}

// Map search result (T21)
export interface MapSearchResult {
  zone_id: string;
  zone_name: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  quantity: number;
  location_name: string;
}

// Sub-location data for semantic zoom (racks inside zones)
export interface SubLocation {
  id: string;
  name: string;
  location_type: LocationType;
  parent_id: string;
  is_active: boolean;
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
  /**
   * TRUE when the lot was produced by a Work Order completion (FG carve-out
   * for the consumability predicate). Set only by `work_orders_repo`'s FG
   * INSERT; defaults FALSE for all received / manually-created lots.
   * Optional in the type because pre-`receiving-preventive-block` rows did
   * not carry the field; backends running migration `20260511000001` always
   * return it.
   */
  is_finished_good?: boolean;
  notes: string | null;
  total_quantity: number;
  purchase_order_line_id?: string | null;
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
  /**
   * Warehouse whose Recepción system-location will receive the lot. The
   * server resolves the destination internally — clients MUST NOT pick a
   * location.
   */
  warehouse_id: string;
  good_quantity: number;
  defect_quantity?: number;
  supplier_id?: string;
  batch_date?: string;
  expiration_date?: string;
  notes?: string;
  purchase_order_line_id?: string;
  purchase_order_id?: string;
}

/**
 * Response shape for `POST /lots/receive`. The backend uses `kind` as the
 * discriminator so the frontend can distinguish lot-backed receives
 * (raw_material, consumable+has_expiry) from direct-inventory receives
 * (tool_spare, consumable without expiry).
 */
export type ReceiveLotResponse =
  | {
      kind: 'lot';
      lot: ProductLot;
    }
  | {
      kind: 'direct_inventory';
      inventory_id: string;
      movement_id: string;
      product_id: string;
      location_id: string;
      quantity: number;
    };

// Lot Movements
export interface LotMovement {
  id: string;
  product_id: string;
  movement_type: MovementType;
  from_location_id: string | null;
  from_location_name: string | null;
  to_location_id: string | null;
  to_location_name: string | null;
  quantity: number;
  reference: string | null;
  notes: string | null;
  user_id: string;
  created_at: string;
}

// Purchase Orders
export type PurchaseOrderStatus =
  | 'draft'
  | 'sent'
  | 'partially_received'
  | 'completed'
  | 'cancelled';

export interface PurchaseOrderLine {
  id: string;
  purchase_order_id: string;
  product_id: string;
  product_name?: string;
  product_sku?: string;
  quantity_ordered: number;
  quantity_received: number;
  unit_price: number;
  notes?: string | null;
}

export interface PurchaseOrder {
  id: string;
  supplier_id: string;
  supplier_name?: string;
  order_number: string;
  status: PurchaseOrderStatus;
  total_amount?: number | null;
  expected_delivery_date?: string | null;
  notes?: string | null;
  lines?: PurchaseOrderLine[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

// Purchase Returns
export type PurchaseReturnStatus = 'pending' | 'shipped_to_supplier' | 'refunded' | 'rejected';
export type PurchaseReturnReason = 'damaged' | 'defective' | 'wrong_product' | 'expired' | 'excess_inventory' | 'other';

export interface PurchaseReturnItem {
  id: string;
  purchase_return_id: string;
  product_id: string;
  quantity_returned: number;
  quantity_original: number;
  unit_price: number;
  subtotal: number;
}

export interface PurchaseReturn {
  id: string;
  purchase_order_id: string;
  return_number: string;
  status: PurchaseReturnStatus;
  reason: PurchaseReturnReason;
  reason_notes: string | null;
  subtotal: number;
  total: number;
  refund_amount: number | null;
  decrease_inventory: boolean;
  requested_by_id: string;
  shipped_at: string | null;
  refunded_at: string | null;
  rejected_at: string | null;
  created_at: string;
  updated_at: string;
  items?: PurchaseReturnItem[];
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

// ──────────────────────────────────────────────────────────────────────
// Work Orders (work-orders-and-bom)
// ──────────────────────────────────────────────────────────────────────

export type WorkOrderStatus = 'draft' | 'in_progress' | 'completed' | 'cancelled';

export const WORK_ORDER_STATUS_VALUES: ReadonlyArray<WorkOrderStatus> = [
  'draft',
  'in_progress',
  'completed',
  'cancelled',
] as const;

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  draft: 'Borrador',
  in_progress: 'En proceso',
  completed: 'Completada',
  cancelled: 'Cancelada',
};

/**
 * Status → Tailwind class mapping for badges. Matches the design §8 color
 * guidance: draft neutral, in_progress blue, completed emerald, cancelled
 * slate (distinct from draft via darker shade).
 */
export const WORK_ORDER_STATUS_BADGE_CLASSES: Record<WorkOrderStatus, string> = {
  draft:
    'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200',
  in_progress:
    'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  completed:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  cancelled:
    'bg-slate-200 text-slate-600 line-through dark:bg-slate-700 dark:text-slate-300',
};

export interface WorkOrderMaterial {
  id: string;
  work_order_id: string;
  product_id: string;
  /** Populated via JOIN on `list_materials` — not a snapshot column. */
  product_name?: string;
  /** Populated via JOIN on `list_materials` — not a snapshot column. */
  product_sku?: string;
  quantity_expected: number;
  quantity_consumed: number;
  notes?: string | null;
}

export interface WorkOrder {
  id: string;
  code: string;
  recipe_id: string;
  fg_product_id: string;
  fg_quantity: number;
  status: WorkOrderStatus;
  warehouse_id: string;
  work_center_location_id: string;
  notes?: string | null;
  created_by: string;
  created_at: string;
  issued_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  updated_at: string;
  /** Only populated on the detail endpoint. */
  materials?: WorkOrderMaterial[];
}

export interface MissingMaterial {
  product_id: string;
  expected: number;
  available: number;
  shortfall: number;
}

export interface CreateWorkOrderInput {
  recipe_id: string;
  fg_product_id: string;
  fg_quantity: number;
  warehouse_id: string;
  work_center_location_id: string;
  notes?: string;
}

export interface MaterialSourceOverride {
  product_id: string;
  location_id: string;
}

export interface IssueWorkOrderInput {
  material_sources?: MaterialSourceOverride[];
}

export interface CompleteWorkOrderInput {
  fg_expiration_date?: string;
  notes?: string;
}

export interface WorkOrderDetail extends WorkOrder {
  materials: WorkOrderMaterial[];
  /**
   * Optional lot info populated by the backend for completed WOs. Shape may
   * vary; we keep this as a loose object until the backend finalizes the
   * response envelope (current backend returns only `WorkOrderResponse`, so
   * the FG lot is fetched via `/lots` filtered by product + lot_number).
   */
  fg_lot?: {
    id: string;
    lot_number: string;
    quality_status: QualityStatus;
    expiration_date: string | null;
  } | null;
}

/**
 * Labels for movement reasons that belong to the work-order chain. Merged
 * into the movements page's existing `REASON_LABELS` map so the history
 * table can render `wo_issue`, `back_flush`, `wo_cancel_reversal` rows with
 * Spanish copy when filtering by `work_order_id`.
 */
export const WORK_ORDER_MOVEMENT_REASON_LABELS: Partial<
  Record<MovementReason, string>
> = {
  wo_issue: 'OT — Entrega de material',
  back_flush: 'OT — Consumo (back-flush)',
  wo_cancel_reversal: 'Reversa por cancelación',
};

// ──────────────────────────────────────────────────────────────────────
// Picking (Sem 2 #509 + Sem 3 #525 — wire contract locked)
// ──────────────────────────────────────────────────────────────────────

/** Six canonical statuses for a picking list. Matches Rust enum `PickingListStatus`. */
export type PickingListStatus =
  | 'draft'
  | 'released'
  | 'assigned'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

/** Three line statuses tracked while a list is in_progress. */
export type PickingLineStatus = 'pending' | 'picked' | 'skipped';

/**
 * Forward-compat — backend Sem 3 #525 emits `'fefo'` today. `'lifo'`/`'manual'`
 * are reserved for future allocation strategies modeled in the domain layer
 * but not yet surfaced via the wire DTO.
 */
export type AllocationStrategy = 'fefo' | 'lifo' | 'manual';

/** Lifecycle of a `reservations` row created at /release. */
export type ReservationStatus = 'active' | 'pending' | 'fulfilled' | 'released' | 'consumed';

/**
 * Structured reason emitted by the backend inside `body.reason` for the
 * `lot_override_invalid` error code. See `lib/picking-error-codes.ts`.
 */
export type LotOverrideInvalidReason =
  | 'unknown_lot'
  | 'product_mismatch'
  | 'not_in_warehouse'
  | 'not_consumable'
  | 'insufficient_quantity';

export const PICKING_LIST_STATUS_VALUES: ReadonlyArray<PickingListStatus> = [
  'draft',
  'released',
  'assigned',
  'in_progress',
  'completed',
  'cancelled',
] as const;

export const PICKING_LIST_STATUS_LABELS: Record<PickingListStatus, string> = {
  draft: 'Borrador',
  released: 'Liberado',
  assigned: 'Asignado',
  in_progress: 'En proceso',
  completed: 'Completado',
  cancelled: 'Cancelado',
};

export const PICKING_LIST_STATUS_BADGE_CLASSES: Record<PickingListStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  released: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  assigned: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400',
  in_progress: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  completed: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  cancelled: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
};

export const PICKING_LINE_STATUS_VALUES: ReadonlyArray<PickingLineStatus> = [
  'pending',
  'picked',
  'skipped',
] as const;

export const PICKING_LINE_STATUS_LABELS: Record<PickingLineStatus, string> = {
  pending: 'Pendiente',
  picked: 'Recolectado',
  skipped: 'Omitido',
};

export const PICKING_LINE_STATUS_BADGE_CLASSES: Record<PickingLineStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  picked: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  skipped: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
};

/**
 * Picking list aggregate root. Mirrors Rust `PickingListResponse` DTO
 * surface (Sem 2 #509 + Sem 3 #525 audit timestamps + Sem 3 `assigned_to_user_id`).
 * Optional fields use `?` because rows materialized before the Sem 3
 * migration may not carry the audit timestamps.
 */
export interface PickingList {
  id: string;
  tenant_id: string;
  /** Tenant-scoped human number, e.g. `PL-2026-0001`. */
  picking_number: string;
  customer_reference?: string;
  customer_id?: string | null;
  warehouse_id: string;
  status: PickingListStatus;
  /** Forward-compat — modeled, not surfaced via wire today. */
  allocation_strategy?: AllocationStrategy;
  /** Forward-compat — picking-wave grouping; emitted as `null` until Sem 5+. */
  wave_id?: string | null;
  notes?: string | null;
  /** Sem 3 — set by /assign and cleared on /cancel. */
  assigned_to_user_id?: string | null;
  released_at?: string | null;
  assigned_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Picking line — one row per requested product. JOIN fields (`product_name`,
 * `product_sku`) are populated by the detail endpoint.
 */
export interface PickingLine {
  id: string;
  picking_list_id: string;
  /** 1-based ordinal stable per list. */
  line_number?: number;
  product_id: string;
  /** JOIN field — present on detail responses. */
  product_name?: string;
  /** JOIN field — present on detail responses. */
  product_sku?: string;
  warehouse_id: string;
  requested_quantity: number;
  /** Pre-allocation result of /release (FEFO). */
  assigned_lot_id?: string | null;
  /** Actual lot consumed on /pick — may equal or differ from `assigned_lot_id`. */
  picked_lot_id?: string | null;
  picked_quantity?: number | null;
  status: PickingLineStatus;
  /** Sem 3 audit — populated by /skip. */
  skip_reason?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Reservation {
  id: string;
  picking_line_id: string;
  product_id?: string;
  warehouse_id?: string;
  lot_id?: string;
  reserved_quantity?: number;
  quantity?: number;
  status: ReservationStatus;
  expires_at?: string | null;
  released_at?: string | null;
  created_at: string;
  updated_at?: string;
}

/** Envelope returned by every CRUD + transition endpoint (Sem 2 #509 + Sem 3 #525). */
export interface PickingListDetailResponse {
  list: PickingList;
  lines: PickingLine[];
}

/** Slim row for the `/picking-lists` index. No audit timestamps. */
export interface PickingListSummary {
  id: string;
  picking_number: string;
  customer_reference?: string;
  customer_id?: string | null;
  warehouse_id: string;
  status: PickingListStatus;
  assigned_to_user_id?: string | null;
  released_at?: string | null;
  line_count: number;
  created_at: string;
  updated_at?: string;
}

// Request DTOs — match Rust DTOs in `routes/picking_lists.rs`.

export interface CreatePickingLineRequest {
  product_id: string;
  warehouse_id?: string;
  requested_quantity: number;
}

export interface CreatePickingListRequest {
  customer_reference?: string;
  customer_id?: string;
  warehouse_id: string;
  notes?: string;
  lines: CreatePickingLineRequest[];
}

export interface UpdatePickingListRequest {
  customer_reference?: string | null;
  customer_id?: string | null;
  notes?: string | null;
  lines_to_add?: CreatePickingLineRequest[];
  line_ids_to_remove?: string[];
}

export interface AssignRequest {
  user_id: string;
}

export interface RecordPickRequest {
  picked_lot_id: string;
  picked_quantity: number;
  notes?: string;
}

export interface SkipLineRequest {
  reason?: string | null;
}

export interface CancelRequest {
  reason?: string | null;
}

/**
 * Membership row — mirrors backend `MembershipResponse` DTO at
 * `crates/api/src/routes/admin/memberships.rs`. Re-used for the tenant-scoped
 * `GET /memberships?role=operator` endpoint that feeds `AssignPickerDialog`.
 */
export interface Membership {
  user_id: string;
  tenant_id: string;
  role: TenantRole;
  user_email?: string | null;
  /** Display name — backend may add this column at some point; tolerated absent. */
  user_name?: string | null;
  /** Backend-side `is_active` for the user_tenant; defaults true. */
  is_active?: boolean;
  /** Backend emits `created_at` (membership row); `joined_at` is an alias for UI clarity. */
  created_at: string;
  joined_at?: string;
}
