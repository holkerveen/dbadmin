-- dbadmin pet-store test schema (OpenAPI Petstore-like)
-- Idempotent: safe to re-run against a live database.

DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS pet_tags CASCADE;
DROP TABLE IF EXISTS pets CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS tags CASCADE;
DROP TABLE IF EXISTS categories CASCADE;

CREATE TABLE categories (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE tags (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE users (
  id         SERIAL PRIMARY KEY,
  username   TEXT NOT NULL UNIQUE,
  email      TEXT NOT NULL UNIQUE,
  first_name TEXT,
  last_name  TEXT,
  phone      TEXT,
  user_status SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pets (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  status      TEXT NOT NULL CHECK (status IN ('available', 'pending', 'sold')),
  photo_urls  TEXT[] NOT NULL DEFAULT '{}',
  price       NUMERIC(10, 2),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pet_tags (
  pet_id INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (pet_id, tag_id)
);

CREATE TABLE orders (
  id         SERIAL PRIMARY KEY,
  pet_id     INTEGER REFERENCES pets(id),
  user_id    INTEGER REFERENCES users(id),
  quantity   INTEGER NOT NULL DEFAULT 1,
  ship_date  TIMESTAMPTZ,
  status     TEXT NOT NULL CHECK (status IN ('placed', 'approved', 'delivered')),
  complete   BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pets_category_id ON pets(category_id);
CREATE INDEX idx_pets_status ON pets(status);
CREATE INDEX idx_pet_tags_tag_id ON pet_tags(tag_id);
CREATE INDEX idx_orders_pet_id ON orders(pet_id);
CREATE INDEX idx_orders_user_id ON orders(user_id);
