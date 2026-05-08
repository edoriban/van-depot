use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub name: String,
    /// Tenant-bypass flag (added in migration A2). When true, the user has
    /// superadmin privileges across all tenants and MUST NOT have membership
    /// rows in `user_tenants`. The legacy global `users.role` column was
    /// removed in A3 — per-tenant authorization now lives in `user_tenants.role`.
    #[serde(default)]
    pub is_superadmin: bool,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing)]
    pub invite_code_hash: Option<String>,
    pub invite_expires_at: Option<DateTime<Utc>>,
    pub must_set_password: bool,
}
