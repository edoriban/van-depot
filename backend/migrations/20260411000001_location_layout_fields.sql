-- Add layout positioning fields to locations for 2D warehouse map
ALTER TABLE locations ADD COLUMN pos_x REAL;
ALTER TABLE locations ADD COLUMN pos_y REAL;
ALTER TABLE locations ADD COLUMN width REAL;
ALTER TABLE locations ADD COLUMN height REAL;

-- Add canvas dimensions to warehouses
ALTER TABLE warehouses ADD COLUMN canvas_width REAL DEFAULT 1200;
ALTER TABLE warehouses ADD COLUMN canvas_height REAL DEFAULT 800;
