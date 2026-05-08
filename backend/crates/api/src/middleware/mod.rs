//! Tower middleware for cross-cutting concerns.
//!
//! Currently exposes only [`superadmin_guard`] (A9), which gates the `/admin`
//! sub-router to callers whose `Claims.is_superadmin == true`. The per-request
//! tenant transaction middleware (`tenant_tx`) lands in Phase C.

pub mod superadmin_guard;
pub mod tenant_tx;
