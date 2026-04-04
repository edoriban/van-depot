use anyhow::{Context, Result};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: Uuid,
    pub email: String,
    pub role: String,
    pub warehouse_ids: Vec<Uuid>,
    pub exp: i64,
    pub iat: i64,
}

#[derive(Clone)]
pub struct JwtConfig {
    pub secret: String,
    pub access_expiration: i64,
    pub refresh_expiration: i64,
}

impl JwtConfig {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            secret: std::env::var("JWT_SECRET").context("JWT_SECRET must be set")?,
            access_expiration: std::env::var("JWT_ACCESS_EXPIRATION")
                .unwrap_or_else(|_| "900".to_string())
                .parse()
                .context("JWT_ACCESS_EXPIRATION must be a number")?,
            refresh_expiration: std::env::var("JWT_REFRESH_EXPIRATION")
                .unwrap_or_else(|_| "604800".to_string())
                .parse()
                .context("JWT_REFRESH_EXPIRATION must be a number")?,
        })
    }
}

pub fn create_access_token(
    config: &JwtConfig,
    user_id: Uuid,
    email: &str,
    role: &str,
    warehouse_ids: Vec<Uuid>,
) -> Result<String> {
    let now = Utc::now();
    let claims = Claims {
        sub: user_id,
        email: email.to_string(),
        role: role.to_string(),
        warehouse_ids,
        exp: (now + Duration::seconds(config.access_expiration)).timestamp(),
        iat: now.timestamp(),
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(config.secret.as_bytes()),
    )
    .context("Failed to create access token")
}

pub fn create_refresh_token(config: &JwtConfig, user_id: Uuid) -> Result<String> {
    let now = Utc::now();
    let claims = Claims {
        sub: user_id,
        email: String::new(),
        role: String::new(),
        warehouse_ids: vec![],
        exp: (now + Duration::seconds(config.refresh_expiration)).timestamp(),
        iat: now.timestamp(),
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(config.secret.as_bytes()),
    )
    .context("Failed to create refresh token")
}

pub fn validate_token(config: &JwtConfig, token: &str) -> Result<Claims> {
    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(config.secret.as_bytes()),
        &Validation::default(),
    )
    .context("Invalid or expired token")?;
    Ok(token_data.claims)
}
