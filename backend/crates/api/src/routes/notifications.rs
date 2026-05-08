use axum::extract::{Path, Query, State};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_domain::error::DomainError;
use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::auth::tenant_context::TenantRole;
use vandepot_infra::repositories::notifications_repo;

use crate::error::ApiError;
use crate::extractors::claims::tenant_context_from_claims;
use crate::extractors::tenant::Tenant;
use crate::state::AppState;

// ── DTOs ────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct NotificationResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub notification_type: String,
    pub title: String,
    pub body: String,
    pub is_read: bool,
    pub reference_id: Option<Uuid>,
    pub reference_type: Option<String>,
    pub metadata: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub read_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
pub struct PaginatedNotifications {
    pub items: Vec<NotificationResponse>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Serialize)]
pub struct UnreadCountResponse {
    pub unread_count: i64,
}

#[derive(Serialize)]
pub struct ReadAllResponse {
    pub marked_count: i64,
}

#[derive(Serialize)]
pub struct DailySummaryByType {
    pub stock_critical: i64,
    pub stock_low: i64,
    pub stock_warning: i64,
    pub cycle_count_due: i64,
    pub system: i64,
}

#[derive(Serialize)]
pub struct DailySummaryResponse {
    pub total_today: i64,
    pub unread_today: i64,
    pub by_type: DailySummaryByType,
}

#[derive(Serialize)]
pub struct GenerateResponse {
    pub created: i64,
    pub skipped: i64,
}

#[derive(Deserialize)]
pub struct ListNotificationsParams {
    pub is_read: Option<bool>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

// ── Routes ──────────────────────────────────────────────────────────

pub fn notification_routes() -> Router<AppState> {
    Router::new()
        .route("/notifications", get(list_notifications))
        .route("/notifications/unread-count", get(unread_count))
        .route("/notifications/{id}/read", put(mark_read))
        .route("/notifications/read-all", put(mark_all_read))
        .route("/notifications/daily-summary", get(daily_summary))
        .route("/notifications/generate", post(generate_notifications))
}

// ── Helpers ─────────────────────────────────────────────────────────

/// Resolves the active tenant_id from the caller's claims, or returns a
/// 422 for superadmin tokens that haven't selected a tenant. Mirrors the
/// B1..B6 per-route helper convention.
///
/// Notifications scope to (tenant_id, user_id): a multi-tenant user only
/// sees notifications relevant to the active tenant.
fn require_tenant_for_notifications(claims: &Claims) -> Result<Uuid, ApiError> {
    let ctx = tenant_context_from_claims(claims);
    ctx.require_tenant().map_err(|_| {
        ApiError(DomainError::Validation(
            "tenant_id required for notification operations (superadmin must select a tenant)"
                .to_string(),
        ))
    })
}

/// Returns `None` for superadmin (sees all warehouses in the active
/// tenant), `Some(ids)` for scoped users.
///
/// Resolves the user's warehouses via tenant-scoped
/// `user_warehouse_repo::list_for_user` (B8.4).
async fn warehouse_scope(
    conn: &mut sqlx::PgConnection,
    claims: &Claims,
    tenant_id: Uuid,
) -> Result<Option<Vec<Uuid>>, ApiError> {
    if claims.is_superadmin {
        return Ok(None);
    }
    let ids =
        vandepot_infra::repositories::user_warehouse_repo::list_for_user(
            &mut *conn, tenant_id, claims.sub,
        )
        .await?;
    Ok(Some(ids))
}

fn to_response(r: notifications_repo::NotificationRow) -> NotificationResponse {
    NotificationResponse {
        id: r.id,
        user_id: r.user_id,
        notification_type: r.notification_type,
        title: r.title,
        body: r.body,
        is_read: r.is_read,
        reference_id: r.reference_id,
        reference_type: r.reference_type,
        metadata: r.metadata,
        created_at: r.created_at,
        read_at: r.read_at,
    }
}

// ── Handlers ────────────────────────────────────────────────────────

async fn list_notifications(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Query(params): Query<ListNotificationsParams>,
) -> Result<Json<PaginatedNotifications>, ApiError> {
    let tenant_id = require_tenant_for_notifications(&claims)?;
    let limit = params.limit.unwrap_or(20).min(100);
    let offset = params.offset.unwrap_or(0);

    let (rows, total) = notifications_repo::list_notifications(
        &mut *tt.tx,
        tenant_id,
        claims.sub,
        params.is_read,
        limit,
        offset,
    )
    .await?;

    let items = rows.into_iter().map(to_response).collect();

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(PaginatedNotifications {
        items,
        total,
        limit,
        offset,
    }))
}

async fn unread_count(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
) -> Result<Json<UnreadCountResponse>, ApiError> {
    let tenant_id = require_tenant_for_notifications(&claims)?;
    let count =
        notifications_repo::get_unread_count(&mut *tt.tx, tenant_id, claims.sub).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(UnreadCountResponse {
        unread_count: count,
    }))
}

async fn mark_read(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<NotificationResponse>, ApiError> {
    let tenant_id = require_tenant_for_notifications(&claims)?;
    let row =
        notifications_repo::mark_as_read(&mut *tt.tx, tenant_id, id, claims.sub).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(to_response(row)))
}

async fn mark_all_read(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
) -> Result<Json<ReadAllResponse>, ApiError> {
    let tenant_id = require_tenant_for_notifications(&claims)?;
    let count =
        notifications_repo::mark_all_as_read(&mut *tt.tx, tenant_id, claims.sub).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(ReadAllResponse {
        marked_count: count,
    }))
}

async fn daily_summary(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
) -> Result<Json<DailySummaryResponse>, ApiError> {
    let tenant_id = require_tenant_for_notifications(&claims)?;
    let row =
        notifications_repo::get_daily_summary(&mut *tt.tx, tenant_id, claims.sub).await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(DailySummaryResponse {
        total_today: row.total_today,
        unread_today: row.unread_today,
        by_type: DailySummaryByType {
            stock_critical: row.stock_critical,
            stock_low: row.stock_low,
            stock_warning: row.stock_warning,
            cycle_count_due: row.cycle_count_due,
            system: row.system,
        },
    }))
}

async fn generate_notifications(
    State(_state): State<AppState>,
    Tenant(mut tt): Tenant,
    claims: Claims,
) -> Result<Json<GenerateResponse>, ApiError> {
    let tenant_id = require_tenant_for_notifications(&claims)?;

    // Only superadmin or owner can generate notifications.
    if !claims.is_superadmin
        && !matches!(claims.role, Some(TenantRole::Owner))
    {
        return Err(ApiError(DomainError::Forbidden(
            "Only superadmin or owner can generate notifications".to_string(),
        )));
    }

    let scope = warehouse_scope(&mut *tt.tx, &claims, tenant_id).await?;
    let (created, skipped) = notifications_repo::generate_from_stock_alerts(
        &mut *tt.tx,
        tenant_id,
        claims.sub,
        scope.as_deref(),
    )
    .await?;

    tt.commit().await.map_err(|e| ApiError(DomainError::Internal(e.to_string())))?;
    Ok(Json(GenerateResponse { created, skipped }))
}
