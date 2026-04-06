use axum::extract::{Path, Query, State};
use axum::routing::{get, put, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use vandepot_infra::auth::jwt::Claims;
use vandepot_infra::repositories::notifications_repo;

use crate::error::ApiError;
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

/// Returns `None` for superadmin (sees all), `Some(ids)` for scoped users.
fn warehouse_scope(claims: &Claims) -> Option<Vec<Uuid>> {
    if claims.role.eq_ignore_ascii_case("superadmin") {
        None
    } else {
        Some(claims.warehouse_ids.clone())
    }
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
    State(state): State<AppState>,
    claims: Claims,
    Query(params): Query<ListNotificationsParams>,
) -> Result<Json<PaginatedNotifications>, ApiError> {
    let limit = params.limit.unwrap_or(20).min(100);
    let offset = params.offset.unwrap_or(0);

    let (rows, total) = notifications_repo::list_notifications(
        &state.pool,
        claims.sub,
        params.is_read,
        limit,
        offset,
    )
    .await?;

    let items = rows.into_iter().map(to_response).collect();

    Ok(Json(PaginatedNotifications {
        items,
        total,
        limit,
        offset,
    }))
}

async fn unread_count(
    State(state): State<AppState>,
    claims: Claims,
) -> Result<Json<UnreadCountResponse>, ApiError> {
    let count =
        notifications_repo::get_unread_count(&state.pool, claims.sub).await?;

    Ok(Json(UnreadCountResponse {
        unread_count: count,
    }))
}

async fn mark_read(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<NotificationResponse>, ApiError> {
    let row =
        notifications_repo::mark_as_read(&state.pool, id, claims.sub).await?;

    Ok(Json(to_response(row)))
}

async fn mark_all_read(
    State(state): State<AppState>,
    claims: Claims,
) -> Result<Json<ReadAllResponse>, ApiError> {
    let count =
        notifications_repo::mark_all_as_read(&state.pool, claims.sub).await?;

    Ok(Json(ReadAllResponse {
        marked_count: count,
    }))
}

async fn daily_summary(
    State(state): State<AppState>,
    claims: Claims,
) -> Result<Json<DailySummaryResponse>, ApiError> {
    let row =
        notifications_repo::get_daily_summary(&state.pool, claims.sub).await?;

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
    State(state): State<AppState>,
    claims: Claims,
) -> Result<Json<GenerateResponse>, ApiError> {
    // Only superadmin or owner can generate notifications
    if !claims.role.eq_ignore_ascii_case("superadmin")
        && !claims.role.eq_ignore_ascii_case("owner")
    {
        return Err(ApiError(vandepot_domain::error::DomainError::Forbidden(
            "Only superadmin or owner can generate notifications".to_string(),
        )));
    }

    let scope = warehouse_scope(&claims);
    let (created, skipped) = notifications_repo::generate_from_stock_alerts(
        &state.pool,
        claims.sub,
        scope.as_deref(),
    )
    .await?;

    Ok(Json(GenerateResponse { created, skipped }))
}
