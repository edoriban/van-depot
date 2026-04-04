use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;
use vandepot_domain::error::DomainError;

pub struct ApiError(pub DomainError);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match &self.0 {
            DomainError::NotFound(msg) => (StatusCode::NOT_FOUND, msg.clone()),
            DomainError::Duplicate(msg) => (StatusCode::CONFLICT, msg.clone()),
            DomainError::Validation(msg) => (StatusCode::UNPROCESSABLE_ENTITY, msg.clone()),
            DomainError::AuthError(msg) => (StatusCode::UNAUTHORIZED, msg.clone()),
            DomainError::Forbidden(msg) => (StatusCode::FORBIDDEN, msg.clone()),
            DomainError::Conflict(msg) => (StatusCode::CONFLICT, msg.clone()),
            DomainError::Internal(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg.clone()),
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}

impl From<DomainError> for ApiError {
    fn from(err: DomainError) -> Self {
        ApiError(err)
    }
}
