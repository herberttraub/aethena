-- Run automatically by docker-compose on first boot.
-- pgvector image already has the extension binary; we just need to enable it.

create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists teams (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    institution text,
    created_at timestamptz default now()
);

create table if not exists queries (
    id uuid primary key default gen_random_uuid(),
    team_id uuid references teams(id) on delete set null,
    question text not null,
    experiment_type text,
    domain text,
    created_at timestamptz default now()
);

create table if not exists plans (
    id uuid primary key default gen_random_uuid(),
    query_id uuid references queries(id) on delete cascade,
    team_id uuid references teams(id) on delete set null,
    depth_mode text default 'standard',
    plan jsonb not null,
    plan_markdown text,
    created_at timestamptz default now()
);

create table if not exists feedback (
    id uuid primary key default gen_random_uuid(),
    plan_id uuid references plans(id) on delete cascade,
    team_id uuid references teams(id) on delete set null,
    experiment_type text,
    section text,
    before text,
    after text,
    freeform_note text,
    accepted boolean default true,
    reason text,
    created_at timestamptz default now()
);

create table if not exists corpus_chunks (
    id uuid primary key default gen_random_uuid(),
    source text,
    source_id text,
    domain text,
    title text,
    authors text,
    year int,
    chunk_index int,
    text text not null,
    embedding vector(768),
    created_at timestamptz default now()
);

create index if not exists corpus_chunks_embedding_idx
    on corpus_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 50);

create index if not exists corpus_chunks_domain_idx on corpus_chunks(domain);

create table if not exists query_uploads (
    id uuid primary key default gen_random_uuid(),
    query_id uuid references queries(id) on delete cascade,
    filename text,
    chunks jsonb,
    created_at timestamptz default now()
);

-- Seed the demo team
insert into teams (id, name, institution)
values ('00000000-0000-0000-0000-000000000001', 'Husky Lab', 'MIT')
on conflict (id) do nothing;
