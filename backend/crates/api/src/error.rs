use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;
use vandepot_domain::error::{
    DomainError, INSUFFICIENT_WORK_ORDER_STOCK, PRODUCT_CLASS_DOES_NOT_SUPPORT_LOTS,
    PRODUCT_CLASS_LOCKED, PRODUCT_MANUFACTURED_REQUIRES_RAW_MATERIAL,
    RECIPE_ITEM_REJECTS_TOOL_SPARE, SYSTEM_LOCATION_PROTECTED,
    WORK_ORDER_BOM_INCLUDES_TOOL_SPARE, WORK_ORDER_FG_PRODUCT_NOT_MANUFACTURED,
    WORK_ORDER_INVALID_TRANSITION, WORK_ORDER_WAREHOUSE_HAS_NO_WORK_CENTER,
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
            // ── Work-orders-and-bom typed branches (design §5e) ───────────
            DomainError::InsufficientWorkOrderStock { missing } => {
                let body = json!({
                    "code": INSUFFICIENT_WORK_ORDER_STOCK,
                    "error": "No hay inventario suficiente en el centro de trabajo para completar la orden",
                    "missing": missing,
                });
                return (StatusCode::CONFLICT, Json(body)).into_response();
            }
            DomainError::WorkOrderInvalidTransition { from, to } => {
                let body = json!({
                    "code": WORK_ORDER_INVALID_TRANSITION,
                    "error": format!("Transición inválida: {:?} → {:?}", from, to),
                    "from": from,
                    "to": to,
                });
                return (StatusCode::CONFLICT, Json(body)).into_response();
            }
            DomainError::WorkOrderBomIncludesToolSpare {
                offending_product_ids,
            } => {
                let body = json!({
                    "code": WORK_ORDER_BOM_INCLUDES_TOOL_SPARE,
                    "error": "La receta contiene herramientas; no se puede crear la orden",
                    "offending_product_ids": offending_product_ids,
                });
                return (StatusCode::UNPROCESSABLE_ENTITY, Json(body)).into_response();
            }
            DomainError::WorkOrderWarehouseHasNoWorkCenter { warehouse_id } => {
                let body = json!({
                    "code": WORK_ORDER_WAREHOUSE_HAS_NO_WORK_CENTER,
                    "error": "El almacén no tiene ningún centro de trabajo configurado",
                    "warehouse_id": warehouse_id,
                });
                return (StatusCode::UNPROCESSABLE_ENTITY, Json(body)).into_response();
            }
            DomainError::WorkOrderFgProductNotManufactured { product_id } => {
                let body = json!({
                    "code": WORK_ORDER_FG_PRODUCT_NOT_MANUFACTURED,
                    "error": "El producto terminado no está marcado como manufacturable",
                    "product_id": product_id,
                });
                return (StatusCode::UNPROCESSABLE_ENTITY, Json(body)).into_response();
            }
            DomainError::RecipeItemRejectsToolSpare { product_id } => {
                let body = json!({
                    "code": RECIPE_ITEM_REJECTS_TOOL_SPARE,
                    "error": "Los items de receta no pueden ser herramientas (tool_spare)",
                    "product_id": product_id,
                });
                return (StatusCode::UNPROCESSABLE_ENTITY, Json(body)).into_response();
            }
            DomainError::ProductIsManufacturedRequiresRawMaterial { product_id } => {
                let body = json!({
                    "code": PRODUCT_MANUFACTURED_REQUIRES_RAW_MATERIAL,
                    "error": "is_manufactured=true requiere product_class=raw_material",
                    "product_id": product_id,
                });
                return (StatusCode::UNPROCESSABLE_ENTITY, Json(body)).into_response();
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
                    | DomainError::ProductClassDoesNotSupportLots
                    | DomainError::InsufficientWorkOrderStock { .. }
                    | DomainError::WorkOrderInvalidTransition { .. }
                    | DomainError::WorkOrderBomIncludesToolSpare { .. }
                    | DomainError::WorkOrderWarehouseHasNoWorkCenter { .. }
                    | DomainError::WorkOrderFgProductNotManufactured { .. }
                    | DomainError::RecipeItemRejectsToolSpare { .. }
                    | DomainError::ProductIsManufacturedRequiresRawMaterial { .. } => {
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

#[cfg(test)]
mod tests {
    //! Surface tests for the DomainError → HTTP status mapping.
    //!
    //! Only the load-bearing variants used by the multi-tenant foundation
    //! are checked here. The work-orders typed branches above have their
    //! own integration coverage in `crates/api/tests/work_orders.rs`.

    use super::*;
    use axum::body::to_bytes;
    use axum::response::IntoResponse;

    fn status_of(err: ApiError) -> StatusCode {
        err.into_response().status()
    }

    #[test]
    fn forbidden_maps_to_403() {
        // C8: an RLS WITH CHECK violation (SQLSTATE 42501) is mapped to
        // `DomainError::Forbidden` by `map_sqlx_error`. Confirm that
        // `Forbidden` surfaces as HTTP 403 here at the API boundary.
        let api = ApiError(DomainError::Forbidden("rls denied".into()));
        assert_eq!(status_of(api), StatusCode::FORBIDDEN);
    }

    #[test]
    fn not_found_maps_to_404() {
        let api = ApiError(DomainError::NotFound("missing".into()));
        assert_eq!(status_of(api), StatusCode::NOT_FOUND);
    }

    #[test]
    fn validation_maps_to_422() {
        let api = ApiError(DomainError::Validation("bad input".into()));
        assert_eq!(status_of(api), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[test]
    fn duplicate_maps_to_409() {
        let api = ApiError(DomainError::Duplicate("dupe".into()));
        assert_eq!(status_of(api), StatusCode::CONFLICT);
    }

    #[test]
    fn conflict_maps_to_409() {
        // C8: SQLSTATE 23503 (FK violation, including cross-tenant FK
        // rejection from RLS-bound parent rows) maps to Conflict → 409.
        let api = ApiError(DomainError::Conflict("fk".into()));
        assert_eq!(status_of(api), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn forbidden_body_carries_message() {
        // Smoke check that the JSON body actually contains the message —
        // useful for confirming the payload shape used by frontend banner.
        let api = ApiError(DomainError::Forbidden("rls denied".into()));
        let resp = api.into_response();
        let bytes = to_bytes(resp.into_body(), 1024).await.unwrap();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v["error"], "rls denied");
    }
}
