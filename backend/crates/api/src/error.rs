use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;
use vandepot_domain::error::{
    DomainError, PRODUCT_CLASS_DOES_NOT_SUPPORT_LOTS, PRODUCT_CLASS_LOCKED,
    SYSTEM_LOCATION_PROTECTED,
};

pub struct ApiError(pub DomainError);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        // Typed class-related variants emit their own structured 409 bodies
        // (design §5e / §8c). Everything else falls through to the generic
        // status/message mapper below.
        match self.0 {
            DomainError::ClassLocked {
                movements,
                lots,
                tool_instances,
            } => {
                let body = json!({
                    "code": PRODUCT_CLASS_LOCKED,
                    "error": "El producto no puede cambiar de clase porque tiene movimientos/lotes/herramientas asociados",
                    "blocked_by": {
                        "movements": movements,
                        "lots": lots,
                        "tool_instances": tool_instances,
                    }
                });
                return (StatusCode::CONFLICT, Json(body)).into_response();
            }
            DomainError::ProductClassDoesNotSupportLots => {
                let body = json!({
                    "code": PRODUCT_CLASS_DOES_NOT_SUPPORT_LOTS,
                    "error": "Lots are not supported for this product class",
                });
                return (StatusCode::CONFLICT, Json(body)).into_response();
            }
            ref other => {
                let (status, message) = match other {
                    DomainError::NotFound(msg) => (StatusCode::NOT_FOUND, msg.clone()),
                    DomainError::Duplicate(msg) => (StatusCode::CONFLICT, msg.clone()),
                    DomainError::Validation(msg) => {
                        (StatusCode::UNPROCESSABLE_ENTITY, msg.clone())
                    }
                    DomainError::AuthError(msg) => (StatusCode::UNAUTHORIZED, msg.clone()),
                    DomainError::Forbidden(msg) => (StatusCode::FORBIDDEN, msg.clone()),
                    DomainError::Conflict(msg) => (StatusCode::CONFLICT, msg.clone()),
                    DomainError::Internal(msg) => {
                        (StatusCode::INTERNAL_SERVER_ERROR, msg.clone())
                    }
                    DomainError::ClassLocked { .. }
                    | DomainError::ProductClassDoesNotSupportLots => {
                        unreachable!("handled by typed branches above")
                    }
                };

                // If the message carries a structured marker prefix (e.g.
                // `SYSTEM_LOCATION_PROTECTED: cannot delete ...`), strip it
                // out and surface the code as a dedicated JSON field so
                // clients can branch without substring-matching the
                // localized message.
                let prefix = format!("{SYSTEM_LOCATION_PROTECTED}:");
                let body = if let Some(rest) = message.strip_prefix(&prefix) {
                    json!({
                        "code": SYSTEM_LOCATION_PROTECTED,
                        "error": rest.trim(),
                    })
                } else {
                    json!({ "error": message })
                };

                (status, Json(body)).into_response()
            }
        }
    }
}

impl From<DomainError> for ApiError {
    fn from(err: DomainError) -> Self {
        ApiError(err)
    }
}
