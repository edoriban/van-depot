CREATE TABLE recipes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    created_by  UUID NOT NULL REFERENCES users(id),
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ
);

CREATE INDEX idx_recipes_active ON recipes (is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_recipes_created_by ON recipes (created_by);

CREATE TABLE recipe_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id   UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    product_id  UUID NOT NULL REFERENCES products(id),
    quantity    DECIMAL(12,4) NOT NULL CHECK (quantity > 0),
    notes       VARCHAR(255),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(recipe_id, product_id)
);

CREATE INDEX idx_recipe_items_recipe ON recipe_items (recipe_id);
CREATE INDEX idx_recipe_items_product ON recipe_items (product_id);
