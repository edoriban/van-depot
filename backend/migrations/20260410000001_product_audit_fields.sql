-- Add audit fields to track who created/modified products
ALTER TABLE products ADD COLUMN created_by UUID REFERENCES users(id);
ALTER TABLE products ADD COLUMN updated_by UUID REFERENCES users(id);
