use redis::aio::ConnectionManager;
use sqlx::PgPool;
use vandepot_infra::auth::jwt::JwtConfig;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub redis: ConnectionManager,
    pub jwt_config: JwtConfig,
}
