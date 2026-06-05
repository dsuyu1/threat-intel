CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."doc_status" AS ENUM('ok', 'error');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."merge_status" AS ENUM('pending', 'accepted', 'rejected');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."source_type" AS ENUM('rss', 'stix');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "actor_neighbors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text NOT NULL,
	"neighbor_actor_id" text NOT NULL,
	"distance" double precision NOT NULL,
	"why_json" jsonb,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "actor_profiles" (
	"actor_id" text PRIMARY KEY NOT NULL,
	"profile_text" text NOT NULL,
	"embedding" "vector" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "actor_profiles" ADD CONSTRAINT "actor_profiles_embedding_dims_check" CHECK (vector_dims("embedding") = 1536);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "doc_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"chunk_text" text NOT NULL,
	"embedding" "vector" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "doc_chunks" ADD CONSTRAINT "doc_chunks_embedding_dims_check" CHECK (vector_dims("embedding") = 1536);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"published_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_hash" text NOT NULL,
	"clean_text" text,
	"status" "doc_status" DEFAULT 'ok' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kg_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"alias" text NOT NULL,
	"alias_norm" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kg_entities" (
	"kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"name" text NOT NULL,
	"aliases" text[],
	"description" text,
	"attributes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kg_entities_kind_entity_id_pk" PRIMARY KEY("kind","entity_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kg_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"relation_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_id" uuid,
	"excerpt" text NOT NULL,
	"url" text NOT NULL,
	"published_at" timestamp with time zone,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kg_merge_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"from_entity_id" text NOT NULL,
	"to_entity_id" text NOT NULL,
	"method" text NOT NULL,
	"score" double precision DEFAULT 0 NOT NULL,
	"status" "merge_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kg_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"from_kind" text NOT NULL,
	"from_id" text NOT NULL,
	"to_kind" text NOT NULL,
	"to_id" text NOT NULL,
	"support" double precision DEFAULT 0 NOT NULL,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"attributes" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "source_type" NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"reliability" double precision DEFAULT 1 NOT NULL,
	"etag" text,
	"last_modified" text,
	"last_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "doc_chunks" ADD CONSTRAINT "doc_chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kg_evidence" ADD CONSTRAINT "kg_evidence_relation_id_kg_relations_id_fk" FOREIGN KEY ("relation_id") REFERENCES "public"."kg_relations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kg_evidence" ADD CONSTRAINT "kg_evidence_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kg_evidence" ADD CONSTRAINT "kg_evidence_chunk_id_doc_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."doc_chunks"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "actor_neighbors_unique_idx" ON "actor_neighbors" ("actor_id","neighbor_actor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "actor_neighbors_actor_id_idx" ON "actor_neighbors" ("actor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "actor_profiles_actor_id_idx" ON "actor_profiles" ("actor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doc_chunks_document_id_idx" ON "doc_chunks" ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "doc_chunks_doc_chunk_idx" ON "doc_chunks" ("document_id","chunk_index");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "documents_url_idx" ON "documents" ("url");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_hash_idx" ON "documents" ("content_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_published_at_idx" ON "documents" ("published_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kg_aliases_kind_alias_norm_idx" ON "kg_aliases" ("kind","alias_norm");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kg_aliases_kind_entity_idx" ON "kg_aliases" ("kind","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kg_entities_kind_idx" ON "kg_entities" ("kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kg_entities_name_idx" ON "kg_entities" ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kg_evidence_relation_id_idx" ON "kg_evidence" ("relation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kg_evidence_document_id_idx" ON "kg_evidence" ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kg_merge_candidates_status_idx" ON "kg_merge_candidates" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kg_merge_candidates_kind_idx" ON "kg_merge_candidates" ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kg_relations_unique_idx" ON "kg_relations" ("type","from_kind","from_id","to_kind","to_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kg_relations_from_idx" ON "kg_relations" ("from_kind","from_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kg_relations_to_idx" ON "kg_relations" ("to_kind","to_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kg_relations_type_idx" ON "kg_relations" ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kg_relations_last_seen_idx" ON "kg_relations" ("last_seen");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sources_url_idx" ON "sources" ("url");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sources_type_idx" ON "sources" ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sources_enabled_idx" ON "sources" ("enabled");
