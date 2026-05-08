use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Supplier {
    pub id: Uuid,
    /// Owning tenant. Added in Phase B batch 3 (multi-tenant-foundation).
    /// Every CRUD path scopes by this column; RLS (Phase C) will enforce it
    /// at the DB layer too.
    pub tenant_id: Uuid,
    pub name: String,
    pub contact_name: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
