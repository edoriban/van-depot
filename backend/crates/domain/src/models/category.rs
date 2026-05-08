use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Category {
    pub id: Uuid,
    /// Owning tenant. Added in Phase B batch 2 (multi-tenant-foundation).
    /// Every CRUD path scopes by this column; RLS (Phase C) will enforce it
    /// at the DB layer too.
    pub tenant_id: Uuid,
    pub name: String,
    pub parent_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
