use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Discrete tool/spare instance tracked by serial number.
///
/// `status` is a free-form text field backed by a DB `CHECK` constraint
/// admitting `available | in_use | maintenance | retired`. A stricter
/// domain enum is intentionally deferred to the future
/// `tools-and-spares-flow` change which will own the full state machine
/// (see design §5c / D8).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolInstance {
    pub id: Uuid,
    pub product_id: Uuid,
    pub serial: String,
    pub status: String,
    pub location_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
